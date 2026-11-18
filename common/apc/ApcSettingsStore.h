// ApcSettingsStore.h - machine-wide settings.json store (apc-settings/1.0).
// C++17, std only, NO JUCE. Header-only. Brand-agnostic.
//
// File: <AppDataRoot>/<Manufacturer>/<PluginName>/settings.json  (schemas/apc-settings.schema.json)
//
// WHAT LIVES HERE vs. IN THE DAW PROJECT
//   * ui.*, presets.*, update.*, license.* : machine-wide preferences. Never in the DAW chunk.
//   * engine.* (oversampling, voices, quality): by default (standards option
//     `engine.state_scope` = "chunk") the AUTHORITATIVE value is stored in the DAW
//     project chunk so a project recalls identically on any machine. settings.json
//     `engine` then only supplies the DEFAULT FOR NEW INSTANCES. With
//     state_scope = "machine" settings.json is authoritative (and the UI should
//     warn "affects all instances"). See resolveEngineValue() below.
//
// CONCURRENCY MODEL (several DAW processes / several instances share one file)
//   Every write is   lock -> read the file AS IT IS NOW -> apply ONLY the keys this
//   caller changes -> write temp file -> atomic rename -> unlock.
//   * Per-key last-writer-wins; keys nobody touched (including keys this version
//     does not know) are carried over from the fresh read, so concurrent writers
//     lose nothing. There is no long-lived in-memory authoritative copy.
//   * Lock = a lock DIRECTORY "<settings.json>.lock" created with create_directory
//     (atomic on every platform and file system we care about). A lock older than
//     staleLockMs is considered abandoned (crashed holder) and broken. Residual
//     risk, documented: a holder stalled for longer than staleLockMs can have its
//     lock broken, which can lose ONE update but can never corrupt the file
//     (the rename is still atomic). If the lock cannot be taken within
//     lockTimeoutMs the write FAILS with a visible error (stone rule 1).
//   * Readers never lock: they read a complete file (atomic rename) and retry
//     briefly if a rename is in flight. refreshIfChanged() is a cheap stat poll for
//     "apply when a window is (re)opened" (decision U-06 as amended).
//   * The shared once-per-day update timestamp uses claimTimeSlot(): the
//     check-and-set happens inside the lock, so exactly one instance per interval
//     wins - across threads and across processes.
//
// ROBUSTNESS
//   * Unknown keys / unknown sections are preserved on every write.
//   * A corrupt settings.json is moved to settings.json.corrupt-<unix> (not
//     deleted), a fresh document is started, and a warning is queued for the UI
//     (takeWarnings()). Preferences are never lost silently.
//   * A file whose "schema" major is higher than 1 is READ but never written
//     (it was produced by a newer version): writes fail with a visible error.
//   * Dotted keys ("ui.theme") address nested objects; keys that themselves
//     contain '.' are not addressable. Arrays are replaced wholesale.
//   * Written pretty-printed, keys sorted (deterministic diffs). Floats allowed here
//     (unlike signed documents).
//   * Not durable against power loss (no fsync); atomic against crashes.
#pragma once

#include "ApcCanonicalJson.h"

#include <chrono>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace apc {

class SettingsStore {
public:
    struct Options {
        std::filesystem::path filePath;
        int lockTimeoutMs = 5000;
        int staleLockMs = 3000;
    };

    explicit SettingsStore(Options o) : opt_(std::move(o)) {
        cache_ = freshDocument();
    }

    static constexpr const char* kSchema = "apc-settings/1.0";

    // ------------------------------------------------------------------ reads
    /** (Re)loads the file into the cache. A missing file is fine (empty settings). */
    bool load(std::string& err) {
        JsonValue doc; std::string warn;
        if (!readDisk(doc, err, warn)) return false;
        std::lock_guard<std::mutex> g(cacheMutex_);
        cache_ = std::move(doc);
        stamp_ = currentStamp();
        if (!warn.empty()) warnings_.push_back(warn);
        return true;
    }

    /** Cheap poll: reloads only when the file's size/mtime changed. Returns true if it reloaded. */
    bool refreshIfChanged() {
        const Stamp s = currentStamp();
        { std::lock_guard<std::mutex> g(cacheMutex_); if (s == stamp_) return false; }
        std::string err;
        return load(err);
    }

    JsonValue snapshot() const { std::lock_guard<std::mutex> g(cacheMutex_); return cache_; }
    bool has(const std::string& key) const { std::lock_guard<std::mutex> g(cacheMutex_); return cache_.getPath(key) != nullptr; }
    JsonValue get(const std::string& key, const JsonValue& def = JsonValue()) const {
        std::lock_guard<std::mutex> g(cacheMutex_);
        const JsonValue* v = cache_.getPath(key);
        return v ? *v : def;
    }
    bool getBool(const std::string& key, bool def) const {
        std::lock_guard<std::mutex> g(cacheMutex_);
        const JsonValue* v = cache_.getPath(key);
        return (v && v->isBool()) ? v->asBool() : def;
    }
    int64_t getInt(const std::string& key, int64_t def) const {
        std::lock_guard<std::mutex> g(cacheMutex_);
        const JsonValue* v = cache_.getPath(key);
        return (v && v->isInt()) ? v->asInt() : def;
    }
    double getDouble(const std::string& key, double def) const {
        std::lock_guard<std::mutex> g(cacheMutex_);
        const JsonValue* v = cache_.getPath(key);
        return (v && v->isNumber()) ? v->asDouble() : def;
    }
    std::string getString(const std::string& key, const std::string& def) const {
        std::lock_guard<std::mutex> g(cacheMutex_);
        const JsonValue* v = cache_.getPath(key);
        return (v && v->isString()) ? v->asString() : def;
    }

    /** Warnings accumulated since the last call (corrupt file quarantined, write failures...). Show them. */
    std::vector<std::string> takeWarnings() {
        std::lock_guard<std::mutex> g(cacheMutex_);
        std::vector<std::string> w; w.swap(warnings_); return w;
    }

    // ----------------------------------------------------------------- writes
    /** Core primitive: under the lock, re-read the file, let `mutate` change the fresh document,
     *  write it back atomically. `mutate` returns false to say "nothing changed - do not write".
     *  `mutate` runs while the cross-process lock is held: keep it tiny, no I/O. */
    bool update(const std::function<bool(JsonValue& root)>& mutate, std::string& err) {
        std::lock_guard<std::mutex> w(writeMutex_);
        DirLock lock(lockPath(), opt_.lockTimeoutMs, opt_.staleLockMs);
        if (!lock.held()) {
            err = "settings.json is locked by another process (waited " + std::to_string(opt_.lockTimeoutMs) + " ms); your change was not saved.";
            return false;
        }
        JsonValue doc; std::string warn;
        if (!readDisk(doc, err, warn)) return false;
        if (!warn.empty()) { std::lock_guard<std::mutex> g(cacheMutex_); warnings_.push_back(warn); }
        if (schemaMajor(doc) > 1) {
            err = "settings.json was written by a newer version of this plugin (" + doc.find("schema")->asString() + "); it is left untouched and your change was not saved.";
            return false;
        }
        if (!mutate(doc)) { std::lock_guard<std::mutex> g(cacheMutex_); cache_ = std::move(doc); return true; }
        if (!doc.find("schema")) doc.set("schema", kSchema);
        if (!sysutil::writeFileAtomic(opt_.filePath, toJson(doc), err)) { err = "settings.json could not be saved: " + err; return false; }
        std::lock_guard<std::mutex> g(cacheMutex_);
        cache_ = std::move(doc);
        stamp_ = currentStamp();
        return true;
    }

    bool set(const std::string& key, JsonValue v, std::string& err) {
        return setMany({ { key, std::move(v) } }, err);
    }
    bool setMany(const std::vector<std::pair<std::string, JsonValue>>& kv, std::string& err) {
        std::string badKey;
        for (const auto& p : kv) if (!validKey(p.first)) badKey = p.first;
        if (!badKey.empty()) { err = "invalid settings key \"" + badKey + "\" (use dotted names like ui.theme)"; return false; }
        return update([&](JsonValue& d) { for (const auto& p : kv) d.setPath(p.first, p.second); return !kv.empty(); }, err);
    }
    bool erase(const std::string& key, std::string& err) {
        return update([&](JsonValue& d) { return d.erasePath(key); }, err);
    }

    /** Atomic "may I run the periodic job now?" across threads and processes. Returns true for exactly one
     *  caller per `intervalSeconds` and records `nowUnix` under `key`. A clock that moved backwards
     *  (now < stored) counts as due. A failed write returns false and queues a warning. */
    bool claimTimeSlot(const std::string& key, int64_t nowUnix, int64_t intervalSeconds) {
        bool won = false;
        std::string err;
        const bool ok = update([&](JsonValue& d) {
            const JsonValue* last = d.getPath(key);
            const bool due = !last || !last->isInt() || nowUnix < last->asInt() || nowUnix - last->asInt() >= intervalSeconds;
            if (!due) return false;
            won = d.setPath(key, nowUnix);
            return won;
        }, err);
        if (!ok) { won = false; std::lock_guard<std::mutex> g(cacheMutex_); warnings_.push_back(err); }
        return won;
    }

private:
    struct Stamp {
        bool exists = false; uintmax_t size = 0; long long mtime = 0;
        bool operator==(const Stamp& o) const { return exists == o.exists && size == o.size && mtime == o.mtime; }
    };
    Stamp currentStamp() const {
        Stamp s; std::error_code ec;
        s.exists = std::filesystem::exists(opt_.filePath, ec);
        if (!s.exists) return s;
        s.size = std::filesystem::file_size(opt_.filePath, ec);
        s.mtime = (long long) std::filesystem::last_write_time(opt_.filePath, ec).time_since_epoch().count();
        return s;
    }

    static bool validKey(const std::string& k) {
        return !k.empty() && k.front() != '.' && k.back() != '.' && k.find("..") == std::string::npos;
    }

    static JsonValue freshDocument() { JsonValue d = JsonValue::object(); d.set("schema", kSchema); return d; }

    static int schemaMajor(const JsonValue& d) {
        const JsonValue* s = d.find("schema");
        if (!s || !s->isString()) return 0;
        const std::string& v = s->asString();
        const std::string prefix = "apc-settings/";
        if (v.compare(0, prefix.size(), prefix) != 0) return 0;
        int major = 0;
        for (size_t i = prefix.size(); i < v.size() && v[i] >= '0' && v[i] <= '9'; ++i) major = major * 10 + (v[i] - '0');
        return major;
    }

    std::filesystem::path lockPath() const { std::filesystem::path p = opt_.filePath; p += ".lock"; return p; }

    /** Reads + parses the file. Missing => fresh doc. Corrupt => quarantined + fresh doc + warning. */
    bool readDisk(JsonValue& doc, std::string& err, std::string& warning) {
        std::string raw, rerr;
        sysutil::ReadStatus st = sysutil::ReadStatus::Error;
        for (int attempt = 0; attempt < 20; ++attempt) {     // a rename may be in flight on Windows
            st = sysutil::readWholeFile(opt_.filePath, raw, rerr, 8u * 1024u * 1024u);
            if (st != sysutil::ReadStatus::Error) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        if (st == sysutil::ReadStatus::NotFound) { doc = freshDocument(); return true; }
        if (st == sysutil::ReadStatus::Error) { err = "settings.json could not be read: " + rerr; return false; }
        JsonParseOptions po; po.allowFloats = true; po.maxBytes = 8u * 1024u * 1024u;
        JsonParseResult pr = parseJson(stripUtf8Bom(raw), po);
        if (pr.ok && pr.value.isObject()) { doc = std::move(pr.value); return true; }
        // quarantine, never delete
        std::error_code ec;
        const std::string stamp = std::to_string((long long) std::chrono::duration_cast<std::chrono::seconds>(
                                                     std::chrono::system_clock::now().time_since_epoch()).count());
        std::filesystem::path q = opt_.filePath;
        q += ".corrupt-" + stamp;
        for (int n = 1; std::filesystem::exists(q, ec) && n < 1000; ++n) {      // never overwrite an earlier quarantine
            q = opt_.filePath;
            q += ".corrupt-" + stamp + "-" + std::to_string(n);
        }
        std::filesystem::rename(opt_.filePath, q, ec);
        warning = "settings.json was damaged (" + (pr.ok ? std::string("not an object") : pr.error) + "). " +
                  (ec ? "It could not be moved aside (" + ec.message() + ")." : "A copy was kept as " + q.filename().string() + ".") +
                  " Preferences were reset to defaults.";
        doc = freshDocument();
        return true;
    }

    /** Cross-process lock based on atomic directory creation. */
    class DirLock {
    public:
        DirLock(std::filesystem::path p, int timeoutMs, int staleMs) : path_(std::move(p)) {
            std::error_code ec;
            if (path_.has_parent_path()) std::filesystem::create_directories(path_.parent_path(), ec);
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
            unsigned jitter = (unsigned) (std::hash<std::thread::id>()(std::this_thread::get_id()) % 7u);
            while (true) {
                ec.clear();
                if (std::filesystem::create_directory(path_, ec) && !ec) { held_ = true; return; }
                if (!ec && std::filesystem::exists(path_, ec)) {
                    // someone holds it: abandoned?
                    const auto mt = std::filesystem::last_write_time(path_, ec);
                    if (!ec) {
                        const auto age = std::filesystem::file_time_type::clock::now() - mt;
                        if (age > std::chrono::milliseconds(staleMs)) {
                            const auto mt2 = std::filesystem::last_write_time(path_, ec);      // re-check right before breaking
                            if (!ec && mt2 == mt) { std::filesystem::remove(path_, ec); continue; }
                        }
                    }
                }
                if (std::chrono::steady_clock::now() >= deadline) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(2 + jitter));
            }
        }
        ~DirLock() { if (held_) { std::error_code ec; std::filesystem::remove(path_, ec); } }
        DirLock(const DirLock&) = delete;
        DirLock& operator=(const DirLock&) = delete;
        bool held() const { return held_; }
    private:
        std::filesystem::path path_;
        bool held_ = false;
    };

    Options opt_;
    mutable std::mutex cacheMutex_;
    std::mutex writeMutex_;
    JsonValue cache_;
    Stamp stamp_;
    std::vector<std::string> warnings_;
};

// ---------------------------------------------------------------------------
//  Engine settings: chunk vs machine scope (standards option engine.state_scope)
// ---------------------------------------------------------------------------

enum class EngineStateScope { Chunk, Machine };

inline EngineStateScope parseEngineStateScope(const std::string& s) {
    return s == "machine" ? EngineStateScope::Machine : EngineStateScope::Chunk;   // default: chunk
}

/** The value an instance should use for settings.json `engine.<key>`.
 *  Chunk   : `chunkValue` (restored from the DAW project) wins; when the instance is NEW (no chunk value),
 *            the machine default from settings.json, then the plugin's built-in default.
 *  Machine : settings.json value, else the plugin's built-in default (a chunk value is ignored).
 *  Latency-affecting keys: the caller must still report setLatencySamples() after applying. */
inline JsonValue resolveEngineValue(const SettingsStore& store, const std::string& key, EngineStateScope scope,
                                    const JsonValue* chunkValue, const JsonValue& pluginDefault) {
    const std::string path = "engine." + key;
    if (scope == EngineStateScope::Chunk && chunkValue && !chunkValue->isNull()) return *chunkValue;
    return store.get(path, pluginDefault);
}

/** User ticked "use as default for new instances" (chunk scope) or changed the value (machine scope). */
inline bool setEngineMachineDefault(SettingsStore& store, const std::string& key, JsonValue v, std::string& err) {
    return store.set("engine." + key, std::move(v), err);
}

} // namespace apc
