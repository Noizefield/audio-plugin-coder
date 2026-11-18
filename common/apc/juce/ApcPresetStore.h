// ApcPresetStore.h - JUCE-based preset store for the `apc-preset/1.0` standard.
//
// Needs: juce_core ONLY (juce::var / juce::JSON / juce::File / juce::ZipFile) + the std-only APC headers
// ApcAtomicFile.h, ApcPaths.h, ApcDefaultsFirst.h, ApcCanonicalJson.h (SHA-256). Header-only, C++17/20.
// Namespace apc::presets. Brand-agnostic: every folder/extension/manufacturer comes from StoreConfig.
//
// WHAT IT DOES (decisions P-01..P-16, X-08, U-10, U-13, L-02)
//   * scans the app-data preset tree (typed `sounds/ kits/ sequences/ patches/` or flat), builds the
//     disposable `cache/_index.json` (mtime+size invalidation). Index rows are IDENTICAL to
//     `apc presets index` (scripts/apc-presets.js): id kind name pack path meta mtime size hash rating
//     favorite [uses]; sorted by path. The C++ rows add `author` (needed by the search haystack).
//   * list() with scope / filters / search / sort - semantics of plans/01-presets/tagging-filtering.md section 7.
//   * load / save / revert / init with defaults-first apply (ApcDefaultsFirst.h), atomic writes
//     (ApcAtomicFile.h, one .bak), dirty tracking, A/B slots, copy-on-write for read-only (factory) assets,
//     import without clobber, pack export/import (zip), Restore Factory Layout hook.
//   * reference resolution (relative-to-file, then pack root, id rebind via the index, [Missing] placeholder).
//   * user-data.json sidecar (ratings / favorites / uses / last_loaded keyed by asset id), merge-on-write under a
//     cross-process lock directory, never by name.
//   * the host state chunk: the SAME document shape as a patch/preset file plus state_version, app_version and
//     (engine.state_scope = chunk) the `engine` section; defaults-first restore.
//   * EVERY failure is a structured apc::presets::Error { code, message, path } - nothing fails silently.
//
// THREADING
//   * Message thread: everything that touches LiveState (load/save/revert/init/ab/chunk/notifyParamChanged).
//   * Any thread: rescan(), index(), list(), setRating/setFavorite (internally locked).
//   * Audio thread: NOTHING here. Parse and validate on the message thread, hand an immutable object to the
//     audio thread with apc::PendingSwap<T> (ApcPendingSwap.h) from `LiveState::applyExtras`.
//
// Error codes (snake_case, the spellings the UI kit and apc-mock.js use): no_layout io bad_json bad_schema not_found
//   readonly exists name_required no_extension bad_kind invalid unsafe_path bad_chunk bad_pack no_live_state
//   empty (A/B slot) no_factory_source too_large gated busy
#pragma once

#include <juce_core/juce_core.h>

#include "../ApcAtomicFile.h"
#include "../ApcCanonicalJson.h"
#include "../ApcDefaultsFirst.h"
#include "../ApcPaths.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <cstdio>
#include <ctime>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace apc::presets
{
namespace fsys = std::filesystem;

// =============================================================================================
//  Errors / results
// =============================================================================================
struct Error
{
    std::string code;      // stable machine-readable code (see the list above)
    std::string message;   // user-presentable text, already contains the failing path where there is one
    std::string path;      // failing file / folder, "" if none

    bool empty() const { return code.empty(); }
    juce::var toVar() const;
};

struct Unit {};

template <class T>
struct Result
{
    bool ok = false;
    T value {};
    Error error;

    explicit operator bool() const { return ok; }
    static Result success (T v = T {}) { Result r; r.ok = true; r.value = std::move (v); return r; }
    static Result fail (Error e) { Result r; r.error = std::move (e); return r; }
    static Result fail (std::string code, std::string message, std::string path = {})
    {
        return fail (Error { std::move (code), std::move (message), std::move (path) });
    }
};
using Status = Result<Unit>;

// =============================================================================================
//  Small JUCE/std helpers (also used by the bridge)
// =============================================================================================
namespace util
{
inline juce::String js (const std::string& s) { return juce::String::fromUTF8 (s.c_str(), (int) s.size()); }
inline std::string ss (const juce::String& s) { return s.toStdString(); }

inline std::string pathToUtf8 (const fsys::path& p)
{
    const auto u = p.u8string();
    return std::string (reinterpret_cast<const char*> (u.data()), u.size());
}
inline fsys::path pathOf (const std::string& utf8) { return apc::pathFromUtf8 (utf8); }
inline std::string genericUtf8 (const fsys::path& p)
{
    const auto u = p.generic_u8string();
    return std::string (reinterpret_cast<const char*> (u.data()), u.size());
}
inline std::string posixRel (const fsys::path& base, const fsys::path& p)
{
    std::error_code ec;
    auto rel = fsys::relative (p, base, ec);
    if (ec) rel = p.lexically_relative (base);
    return genericUtf8 (rel);
}
inline juce::File fileOf (const fsys::path& p) { return juce::File (js (pathToUtf8 (p))); }

inline juce::var newObject() { return juce::var (new juce::DynamicObject()); }
inline juce::var newArray() { return juce::var (juce::Array<juce::var>()); }
inline bool isObject (const juce::var& v) { return v.getDynamicObject() != nullptr; }
inline bool isArray (const juce::var& v) { return v.isArray(); }
inline void set (const juce::var& o, const char* key, const juce::var& v)
{
    if (auto* d = o.getDynamicObject()) d->setProperty (juce::Identifier (key), v);
}
inline void push (const juce::var& a, const juce::var& v) { if (auto* arr = a.getArray()) arr->add (v); }
inline bool has (const juce::var& o, const char* key)
{
    auto* d = o.getDynamicObject();
    return d != nullptr && d->hasProperty (juce::Identifier (key));
}
inline juce::var get (const juce::var& o, const char* key)
{
    auto* d = o.getDynamicObject();
    return d != nullptr ? d->getProperty (juce::Identifier (key)) : juce::var();
}
inline std::string getStr (const juce::var& o, const char* key, const std::string& def = {})
{
    const auto v = get (o, key);
    return v.isString() ? ss (v.toString()) : def;
}
inline double getNum (const juce::var& o, const char* key, double def = 0.0)
{
    const auto v = get (o, key);
    return (v.isDouble() || v.isInt() || v.isInt64()) ? (double) v : def;
}
inline bool getBool (const juce::var& o, const char* key, bool def = false)
{
    const auto v = get (o, key);
    return v.isBool() ? (bool) v : def;
}
inline bool isNumber (const juce::var& v) { return v.isDouble() || v.isInt() || v.isInt64(); }

inline std::string toJsonText (const juce::var& v, bool compact = false)
{
    return ss (juce::JSON::toString (v, compact, 15));
}

// parse; strips a UTF-8 BOM
inline bool parseJson (const std::string& text, juce::var& out, std::string& err)
{
    std::string t = text;
    if (t.size() >= 3 && (unsigned char) t[0] == 0xEF && (unsigned char) t[1] == 0xBB && (unsigned char) t[2] == 0xBF) t.erase (0, 3);
    auto r = juce::JSON::parse (js (t), out);
    if (r.failed()) { err = ss (r.getErrorMessage()); return false; }
    return true;
}

inline std::string nowIsoUtc()
{
    const std::time_t t = std::time (nullptr);
    std::tm tmv {};
#if defined(_WIN32)
    gmtime_s (&tmv, &t);
#else
    gmtime_r (&t, &tmv);
#endif
    char buf[32];
    std::strftime (buf, sizeof (buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
    return buf;
}

inline std::string newUuid() { return ss (juce::Uuid().toDashedString().toLowerCase()); }

// canonical slug used for vocabulary comparisons: lower-case, `&` -> " and ", `/` -> " ", runs of space/_ -> "-"
inline std::string norm (const std::string& in)
{
    std::string s;
    for (char c : in)
    {
        if (c == '&') s += " and ";
        else if (c == '/') s += ' ';
        else s += (char) std::tolower ((unsigned char) c);
    }
    std::string out;
    bool pend = false;
    for (char c : s)
    {
        if (c == ' ' || c == '\t' || c == '_' || c == '\n' || c == '\r') { pend = true; continue; }
        if (pend && ! out.empty()) out += '-';
        pend = false;
        out += c;
    }
    return out;
}

inline double roundSignificant (double v, int digits = 9)
{
    if (! std::isfinite (v) || v == 0.0) return v;
    char buf[64];
    std::snprintf (buf, sizeof (buf), "%.*g", digits, v);
    return std::strtod (buf, nullptr);
}
} // namespace util

inline juce::var Error::toVar() const
{
    auto o = util::newObject();
    util::set (o, "error", util::js (code));
    util::set (o, "code", util::js (code));
    util::set (o, "message", util::js (message));
    if (! path.empty()) util::set (o, "path", util::js (path));
    return o;
}

inline Error makeError (std::string code, std::string message, std::string path = {})
{
    return Error { std::move (code), std::move (message), std::move (path) };
}

// =============================================================================================
//  PMX/1 vocabulary subset needed for filtering (kept in sync with schemas/pmx1-vocabulary.json by a test)
// =============================================================================================
struct AxisDef { const char* key; std::vector<const char*> words; };
struct GenreDef { const char* slug; const char* label; std::vector<const char*> aliases; };

inline const std::vector<AxisDef>& axisTable()
{
    static const std::vector<AxisDef> t = {
        { "bri", { "dark", "muted", "neutral", "bright", "brilliant" } },
        { "war", { "cold", "cool", "neutral", "warm", "hot" } },
        { "agg", { "gentle", "firm", "hard", "brutal" } },
        { "wid", { "mono", "narrow", "wide", "ultra" } },
        { "dep", { "thin", "mid", "deep", "sub-heavy" } },
        { "mov", { "static", "breathing", "evolving", "chaotic" } },
        { "rou", { "smooth", "textured", "gritty", "destroyed" } },
        { "spa", { "dry", "room", "hall", "infinite" } },
        { "met", { "harmonic", "inharmonic", "atonal" } },
        { "den", { "sparse", "layered", "massive" } } };
    return t;
}

inline const std::vector<GenreDef>& genreTable()
{
    static const std::vector<GenreDef> t = {
        { "ambient", "Ambient", {} }, { "cinematic", "Cinematic", {} }, { "cyberpunk", "Cyberpunk", {} },
        { "drum-and-bass", "Drum & Bass", { "drum&bass", "drum & bass", "dnb", "d&b" } },
        { "dubstep", "Dubstep", {} }, { "edm", "EDM", {} }, { "electro", "Electro", {} }, { "house", "House", {} },
        { "industrial", "Industrial", {} }, { "lo-fi", "Lo-Fi", { "lofi" } }, { "synthwave", "Synthwave", {} },
        { "techno", "Techno", {} }, { "trance", "Trance", {} }, { "trap", "Trap", {} },
        { "world-tribal", "World / Tribal", { "world / tribal", "world/tribal" } } };
    return t;
}

inline std::string canonicalGenre (const std::string& value)
{
    const std::string want = util::norm (value);
    for (const auto& g : genreTable())
    {
        if (want == util::norm (g.slug) || want == util::norm (g.label)) return g.slug;
        for (const char* a : g.aliases) if (want == util::norm (a)) return g.slug;
    }
    return want;
}

// =============================================================================================
//  Configuration
// =============================================================================================
enum class Gate { Save, PackInstall, PackExport };

struct StoreConfig
{
    apc::PresetLayout layout;               // apc::makeHostLayout (...) - the single source of every path
    bool flat = false;                      // preset.hierarchy = flat
    std::string soundExt, kitExt, seqExt, patchExt, presetExt;   // WITH dot, from the standards options preset.*_ext
    std::string userPack = "User";          // default target of user saves
    std::string pluginName;                 // informational (pack.json of the User pack)
    std::string appVersion = "0.0.0";       // JucePlugin_VersionString
    std::string chunkKind;                  // asset kind written in the chunk; default flat ? "preset" : "patch"
    int stateVersion = 1;                   // bump on a BREAKING chunk layout change only
    bool engineInChunk = true;              // engine.state_scope == "chunk"
    bool keepBackup = true;                 // one <file>.bak on overwrite
    bool devWritableFactory = false;        // dev roots: factory packs are writable (edits land in git)
    std::vector<std::string> readOnlyPacks; // besides pack.json "license":"factory"
    std::string devRoot;                    // preset_dev_roots in a debug build (display only: "Development root active")
    std::string factoryInstall = "user-folder";   // preset.factory_install (display only)
    std::int64_t maxImportBytes = 2LL * 1024 * 1024 * 1024;
    apc::AtomicWriteOptions atomic;         // tests: fault injection
    std::function<bool (Gate)> gate;        // license gate (L-02): false => error `gated`. null = always allowed
    // Restore Factory Layout. Receives the presets folder; must re-create the factory pack(s) from the embedded
    // archive / installer seed. Null => the shared seed folder (layout.factorySeed) is used when it exists.
    std::function<Status (const fsys::path& presetsDir)> restoreFactory;
};

// What the plugin connects (all callbacks run on the MESSAGE thread).
struct LiveState
{
    std::vector<apc::ParamDecl> decls;      // derive from the parameter tree, do not hand-maintain
    std::function<std::map<std::string, apc::Value>()> snapshotParams;            // FULL snapshot, every declared param
    std::function<void (const apc::ParamDecl&, const apc::Value&)> setParam;      // real-world value -> host (+notify)
    std::function<juce::var()> snapshotExtras;                                    // optional: {modulation, chunks, macros, samples, ...}
    std::function<void (const juce::var& docOrExtras, const juce::var& resolvedRefs)> applyExtras;   // optional; {} = reset to defaults
    std::function<juce::var()> getEngine;                                         // optional: oversampling/quality/voices
    std::function<void (const juce::var&)> setEngine;                             // optional
    std::function<void()> beginBatch, endBatch;                                   // optional: wrap an apply (e.g. suspend)
};

// =============================================================================================
//  Index
// =============================================================================================
struct IndexRow
{
    std::string id, kind, name, pack, path;   // path: posix, relative to the presets folder
    juce::var meta;
    std::int64_t mtime = 0, size = 0;
    std::string hash;                         // sha256 of the file bytes
    std::string author;
    bool hasAuthor = false;
    int rating = 0;
    bool favorite = false;
    bool hasUses = false;
    int uses = 0;
};

struct IndexStats { int scanned = 0, reused = 0, reparsed = 0, removed = 0, orphanUserData = 0; };
struct IndexIssue { std::string code, path, message; };

struct Index
{
    std::vector<IndexRow> rows;               // sorted by path (byte order)
    std::vector<IndexIssue> errors;           // unreadable files
    std::vector<IndexIssue> warnings;
    IndexStats stats;
    std::unordered_map<std::string, std::size_t> byId;   // first non-_wip occurrence wins

    const IndexRow* find (const std::string& id) const
    {
        const auto it = byId.find (id);
        return it == byId.end() ? nullptr : &rows[it->second];
    }
};

struct UserEntry
{
    int rating = 0;
    bool favorite = false;
    bool hasUses = false;
    int uses = 0;
    std::int64_t lastLoaded = 0;   // unix ms; used by sort "recent"
};

// =============================================================================================
//  References
// =============================================================================================
struct RefInfo
{
    std::string where;       // "kits[0]", "slots[3]"
    std::string kind;        // expected kind of the target
    std::string status;      // found | rebound | embedded | missing | absolute | escape | case | wrong-kind | empty
    std::string ref, id;     // as written
    std::string file;        // resolved absolute path (found/rebound)
    std::string name;        // display name (target doc name or file stem)
    std::string placeholder; // "[Missing: <name>]" when the target cannot be used
    std::string problem;     // non-fatal remark (backslashes, id mismatch)
    int depth = 0;
    bool usable = false;
    juce::var toVar() const;
};

inline juce::var RefInfo::toVar() const
{
    auto o = util::newObject();
    util::set (o, "where", util::js (where));
    util::set (o, "kind", util::js (kind));
    util::set (o, "status", util::js (status));
    util::set (o, "ref", util::js (ref));
    util::set (o, "id", util::js (id));
    util::set (o, "file", util::js (file));
    util::set (o, "name", util::js (name));
    util::set (o, "usable", usable);
    util::set (o, "depth", depth);
    if (! placeholder.empty()) util::set (o, "placeholder", util::js (placeholder));
    if (! problem.empty()) util::set (o, "problem", util::js (problem));
    return o;
}

struct SampleResolution
{
    std::string status;   // found | rebound-by-hash | embedded | missing | hash-mismatch
    std::string path;     // resolved file (found / rebound-by-hash)
    std::string message;
    bool usable() const { return status == "found" || status == "rebound-by-hash" || status == "embedded"; }
};

// =============================================================================================
//  Reports
// =============================================================================================
struct LoadReport
{
    std::string id, name, pack, kind, path;
    bool readOnly = false;
    std::vector<std::string> applied, defaulted, clamped;
    std::vector<std::pair<std::string, std::string>> invalid;   // id, reason
    std::vector<std::string> unknown;                           // preserved for the next save
    std::vector<RefInfo> refs;
    std::vector<std::string> warnings;
};

struct SaveRequest
{
    std::string name, pack, kind;
    juce::var meta;                 // shallow-merged over the existing meta
    bool saveAs = false;            // never overwrite the loaded file
    bool overwrite = false;         // Save As may replace an existing OTHER file of that name (explicit user confirmation)
};

struct SaveReport
{
    std::string id, name, pack, kind, path;
    bool copiedFromReadOnly = false, overwrote = false;
    std::vector<std::string> warnings;
};

struct ImportedItem { std::string id, name, kind, pack, path; bool idChanged = false; };
struct ImportReport
{
    std::vector<ImportedItem> items;
    std::string skipped;      // "already-installed" for an unchanged pack
    std::string packFolder;
    std::vector<std::string> warnings;
};

struct ChunkReport
{
    bool engineApplied = false;
    int stateVersionFound = 0;
    LoadReport load;
    std::vector<std::string> warnings;
};

struct StateEvent
{
    enum class Kind { Preset, Index, UserData } kind = Kind::Preset;
};

// =============================================================================================
//  The store
// =============================================================================================
class Store
{
public:
    explicit Store (StoreConfig cfg) : cfg_ (std::move (cfg))
    {
        if (cfg_.chunkKind.empty()) cfg_.chunkKind = cfg_.flat ? "preset" : "patch";
        index_ = std::make_shared<Index>();
    }

    const StoreConfig& config() const { return cfg_; }
    void setLiveState (LiveState ls) { live_ = std::move (ls); }
    const LiveState& liveState() const { return live_; }
    void setLoadBehavior (std::string v) { loadBehavior_ = std::move (v); }

    int addListener (std::function<void (const StateEvent&)> fn)
    {
        std::lock_guard<std::mutex> g (listenerMutex_);
        const int id = ++nextListener_;
        listeners_.emplace_back (id, std::move (fn));
        return id;
    }
    void removeListener (int id)
    {
        std::lock_guard<std::mutex> g (listenerMutex_);
        listeners_.erase (std::remove_if (listeners_.begin(), listeners_.end(), [id] (const auto& p) { return p.first == id; }), listeners_.end());
    }

    // ------------------------------------------------------------------------------ index
    std::shared_ptr<const Index> index() const { std::lock_guard<std::mutex> g (indexMutex_); return index_; }

    // Full scan (thread-safe, may take a while on big trees: call from a worker). force=true ignores the cache.
    Result<IndexStats> rescan (bool force = false)
    {
        if (! cfg_.layout.valid) return Result<IndexStats>::fail ("no_layout", "The preset folder could not be determined: " + cfg_.layout.error);
        std::lock_guard<std::mutex> scanGuard (scanMutex_);
        refreshUserData (true);
        auto idx = std::make_shared<Index>();
        std::map<std::string, juce::var> oldRows;
        if (! force) readCache (oldRows);
        std::set<std::string> seen;

        std::error_code ec;
        const fsys::path presets = cfg_.layout.presets;
        if (fsys::is_directory (presets, ec))
        {
            for (const auto& packDir : findPacks (presets))
            {
                const std::string packName = util::pathToUtf8 (packDir.filename());
                std::vector<fsys::path> files;
                collectAssetFiles (packDir, files);
                for (const auto& f : files)
                {
                    ++idx->stats.scanned;
                    const std::string rel = util::posixRel (presets, f);
                    seen.insert (rel);
                    const auto jf = util::fileOf (f);
                    const std::int64_t mtime = jf.getLastModificationTime().toMilliseconds();
                    const std::int64_t size = jf.getSize();
                    IndexRow row;
                    const auto prev = oldRows.find (rel);
                    if (prev != oldRows.end() && rowFromVar (prev->second, row) && row.mtime == mtime && row.size == size && row.hasAuthor)
                    {
                        row.pack = packName;
                        ++idx->stats.reused;
                    }
                    else
                    {
                        std::string raw, err;
                        if (! apc::readFileToString (f, raw).ok) { idx->errors.push_back ({ "unreadable", rel, "cannot read file" }); continue; }
                        juce::var doc;
                        if (! util::parseJson (raw, doc, err)) { idx->errors.push_back ({ "bad_json", rel, err }); continue; }
                        if (! isAssetDoc (doc)) { idx->errors.push_back ({ "not-asset", rel, "not an apc-preset asset (missing schema/id)" }); continue; }
                        row = IndexRow {};
                        fillRowFromDoc (row, doc);
                        row.pack = packName;
                        row.path = rel;
                        row.mtime = mtime;
                        row.size = size;
                        row.hash = apc::sha256Hex (raw);
                        ++idx->stats.reparsed;
                    }
                    row.path = rel;
                    idx->rows.push_back (std::move (row));
                }
            }
        }
        for (const auto& kv : oldRows) if (seen.find (kv.first) == seen.end()) ++idx->stats.removed;

        std::sort (idx->rows.begin(), idx->rows.end(), [] (const IndexRow& a, const IndexRow& b) { return a.path < b.path; });
        finishIndex (*idx);
        const auto w = writeCache (*idx);
        if (! w.ok) idx->warnings.push_back ({ "cache-write", w.error.path, w.error.message });   // disposable: warn only
        const std::string stamp = computeTreeStamp();
        {
            std::lock_guard<std::mutex> g (indexMutex_);
            index_ = idx;
            treeStamp_ = stamp;
            builtAt_ = util::nowIsoUtc();
            missingCache_.clear();
        }
        scanned_ = true;
        fire (StateEvent::Kind::Index);
        return Result<IndexStats>::success (idx->stats);
    }

    std::string builtAt() const { std::lock_guard<std::mutex> g (indexMutex_); return builtAt_; }

    // Cheap check for "the tree changed since the last scan" (window open -> automatic rescan).
    bool treeChanged() const
    {
        const std::string now = computeTreeStamp();
        std::lock_guard<std::mutex> g (indexMutex_);
        return now != treeStamp_;
    }

    // ------------------------------------------------------------------------------ user data
    Result<UserEntry> setRating (const std::string& id, int stars)
    {
        if (stars < 0 || stars > 5) return Result<UserEntry>::fail ("invalid", "Rating must be 0..5 stars.");
        return updateUser (id, [stars] (juce::var& e) { util::set (e, "rating", stars); });
    }
    Result<UserEntry> setFavorite (const std::string& id, bool on)
    {
        return updateUser (id, [on] (juce::var& e) { util::set (e, "favorite", on); });
    }
    UserEntry userEntry (const std::string& id) const
    {
        std::lock_guard<std::mutex> g (userMutex_);
        const auto it = user_.find (id);
        return it == user_.end() ? UserEntry {} : it->second;
    }
    std::vector<std::string> takeWarnings()
    {
        std::lock_guard<std::mutex> g (userMutex_);
        std::vector<std::string> w;
        w.swap (warnings_);
        return w;
    }

    // ------------------------------------------------------------------------------ list
    // query = { scope, filters, search, sort, limit?, offset? } -> { items:[{id,kind,name,pack,meta,rating,favorite,mtime}], total }
    Result<juce::var> list (const juce::var& query)
    {
        if (! scanned_.load()) rescan (false);
        refreshUserData (false);
        const auto idx = index();
        const std::string scope = scopeOf (util::get (query, "scope"));
        const juce::var filters = util::get (query, "filters");
        FilterSet flt;
        if (auto e = parseFilters (filters, scope, flt); ! e.empty()) return Result<juce::var>::fail (e);
        std::string search = util::getStr (query, "search");
        search = util::ss (util::js (search).trim().substring (0, 64).toLowerCase());

        struct Item { const IndexRow* row; UserEntry user; std::string nameKey; };
        std::vector<Item> items;
        {
            std::lock_guard<std::mutex> g (userMutex_);
            for (const auto& r : idx->rows)
            {
                UserEntry u;
                const auto it = user_.find (r.id);
                if (it != user_.end()) u = it->second;
                if (! flt.matches (r, u)) continue;
                if (! search.empty() && haystack (r).find (search) == std::string::npos) continue;
                items.push_back ({ &r, u, util::ss (util::js (r.name).toLowerCase()) });
            }
        }
        std::string key = "name", dir;
        const auto sortV = util::get (query, "sort");
        if (sortV.isString()) key = util::ss (sortV.toString());
        else if (util::isObject (sortV)) { key = util::getStr (sortV, "key", util::getStr (sortV, "by", "name")); dir = util::getStr (sortV, "dir"); }
        key = util::norm (key);
        if (key == "most-used" || key == "mostused" || key == "used" || key == "uses") key = "used";
        if (key == "type" || key == "category") key = "type";
        if (key != "name" && key != "type" && key != "rating" && key != "recent" && key != "bpm" && key != "used" && key != "path")
            return Result<juce::var>::fail ("invalid", "Unknown sort key \"" + key + "\" (name, type, rating, recent, bpm, used, path).");

        auto cmpName = [] (const Item& a, const Item& b) -> int
        {
            const int c = util::js (a.row->name).compareIgnoreCase (util::js (b.row->name));
            if (c != 0) return c;
            return a.row->path < b.row->path ? -1 : (a.row->path > b.row->path ? 1 : 0);
        };
        auto categoryOf = [] (const IndexRow& r) { return util::getStr (r.meta, "category"); };
        auto bpmOf = [] (const IndexRow& r) { const auto v = util::get (r.meta, "tempo_bpm"); return util::isNumber (v) ? (double) v : std::nan (""); };
        std::stable_sort (items.begin(), items.end(), [&] (const Item& a, const Item& b)
        {
            int c = 0;
            if (key == "name") c = cmpName (a, b);
            else if (key == "path") c = a.row->path < b.row->path ? -1 : (a.row->path > b.row->path ? 1 : 0);
            else if (key == "type")
            {
                const auto ca = categoryOf (*a.row), cb = categoryOf (*b.row);
                if (ca.empty() != cb.empty()) c = ca.empty() ? 1 : -1;   // uncategorised last
                else c = ca < cb ? -1 : (ca > cb ? 1 : 0);
                if (c == 0) c = cmpName (a, b);
            }
            else if (key == "rating") { c = b.user.rating - a.user.rating; if (c == 0) c = cmpName (a, b); }
            else if (key == "used") { c = (b.user.hasUses ? b.user.uses : 0) - (a.user.hasUses ? a.user.uses : 0); if (c == 0) c = cmpName (a, b); }
            else if (key == "recent")
            {
                const auto ta = a.user.lastLoaded > 0 ? a.user.lastLoaded : a.row->mtime;
                const auto tb = b.user.lastLoaded > 0 ? b.user.lastLoaded : b.row->mtime;
                c = ta > tb ? -1 : (ta < tb ? 1 : 0);
                if (c == 0) c = cmpName (a, b);
            }
            else if (key == "bpm")
            {
                const double x = bpmOf (*a.row), y = bpmOf (*b.row);
                if (std::isnan (x) != std::isnan (y)) c = std::isnan (x) ? 1 : -1;
                else if (! std::isnan (x)) c = x < y ? -1 : (x > y ? 1 : 0);
                if (c == 0) c = cmpName (a, b);
            }
            if (dir == "desc" && key != "rating" && key != "used" && key != "recent") c = -c;
            if (dir == "asc" && (key == "rating" || key == "used" || key == "recent")) c = -c;
            return c < 0;
        });

        const int total = (int) items.size();
        std::map<std::string, bool> roCache;
        int offset = (int) util::getNum (query, "offset", 0), limit = (int) util::getNum (query, "limit", -1);
        offset = std::max (0, offset);
        auto arr = util::newArray();
        for (int i = offset; i < total && (limit < 0 || i < offset + limit); ++i)
        {
            const auto& it = items[(std::size_t) i];
            auto o = util::newObject();
            util::set (o, "id", util::js (it.row->id));
            util::set (o, "kind", util::js (it.row->kind));
            util::set (o, "name", util::js (it.row->name));
            util::set (o, "pack", util::js (it.row->pack));
            util::set (o, "meta", metaWithAuthor (*it.row));
            auto miss = util::newArray();
            for (const auto& m : missingNames (*it.row)) util::push (miss, juce::var (util::js (m)));
            util::set (o, "missing", miss);
            auto roIt = roCache.find (it.row->pack);
            if (roIt == roCache.end()) roIt = roCache.emplace (it.row->pack, isPackReadOnly (it.row->pack)).first;
            util::set (o, "readOnly", roIt->second);
            util::set (o, "rating", it.user.rating);
            util::set (o, "favorite", it.user.favorite);
            util::set (o, "mtime", (juce::int64) it.row->mtime);
            util::push (arr, o);
        }
        auto res = util::newObject();
        util::set (res, "items", arr);
        util::set (res, "total", total);
        util::set (res, "totalAll", (int) idx->rows.size());
        return Result<juce::var>::success (res);
    }

    // ------------------------------------------------------------------------------ state
    struct Current
    {
        std::string id, name, pack, kind, path;   // path: absolute, "" when the state has no file (INIT / chunk without file)
        bool hasFile = false, readOnly = false;
        std::vector<std::string> missing;         // display names of referenced assets that could not be resolved ([Missing: <name>])
        juce::var doc;                            // last loaded / saved document (unknown keys survive the next save)
    };
    const Current& current() const { return cur_; }
    bool isDirty() const { return dirty_.load(); }
    std::uint64_t generation() const { return generation_.load(); }

    juce::var stateVar() const
    {
        auto s = util::newObject();
        auto c = util::newObject();
        util::set (c, "id", util::js (cur_.id));
        util::set (c, "name", util::js (cur_.name));
        util::set (c, "dirty", dirty_.load());
        util::set (c, "readOnly", cur_.readOnly);
        util::set (c, "pack", util::js (cur_.pack));
        util::set (c, "kind", util::js (cur_.kind));
        auto miss = util::newArray();
        for (const auto& m : cur_.missing) util::push (miss, juce::var (util::js (m)));
        util::set (c, "missing", miss);
        util::set (s, "current", c);
        auto ab = util::newObject();
        util::set (ab, "active", util::js (std::string (1, active_ == 0 ? 'A' : 'B')));
        util::set (ab, "hasB", slot_[1].valid);
        util::set (s, "ab", ab);
        util::set (s, "loadBehavior", util::js (loadBehavior_));
        return s;
    }

    // A parameter changed after a load (UI or host). Ignored while we are applying a state ourselves.
    void notifyParamChanged()
    {
        if (applying_.load()) return;
        if (! dirty_.exchange (true)) fire (StateEvent::Kind::Preset);
    }

    // Recompute dirty by comparing the live state with what the last load/save applied.
    bool recomputeDirty()
    {
        const bool d = baselineStale_ || ! sameAsBaseline();
        if (dirty_.exchange (d) != d) fire (StateEvent::Kind::Preset);
        return d;
    }

    // ------------------------------------------------------------------------------ load / init / revert
    Result<LoadReport> load (const std::string& id)
    {
        if (auto e = needLive(); ! e.empty()) return Result<LoadReport>::fail (e);
        const auto idx = index();
        const IndexRow* row = idx->find (id);
        if (row == nullptr) return Result<LoadReport>::fail ("not_found", "No preset with id " + id + " in the preset folder (try a rescan).");
        auto r = loadFile (cfg_.layout.presets / util::pathOf (row->path), *row);
        if (r.ok) bumpUses (id);
        return r;
    }

    Result<LoadReport> revert()
    {
        if (! cur_.hasFile)
        {
            if (cur_.id.empty() || cur_.id == "init") return init();
            return Result<LoadReport>::fail ("not_found", "The current state is not backed by a file, so there is nothing to revert to.");
        }
        const auto idx = index();
        const IndexRow* row = idx->find (cur_.id);
        IndexRow tmp;
        if (row == nullptr)
        {
            tmp.id = cur_.id; tmp.name = cur_.name; tmp.pack = cur_.pack; tmp.kind = cur_.kind;
            row = &tmp;
        }
        return loadFile (fsys::path (cur_.path), *row);
    }

    // Declared defaults: never "random" (lifecycle section 2.1). Always available (compiled-in INIT, P-08).
    Result<LoadReport> init()
    {
        if (auto e = needLive(); ! e.empty()) return Result<LoadReport>::fail (e);
        LoadReport rep;
        auto doc = util::newObject();
        util::set (doc, "schema", "apc-preset/1.0");
        util::set (doc, "kind", util::js (cfg_.flat ? "preset" : "sound"));
        util::set (doc, "name", "Init");
        util::set (doc, "params", util::newObject());
        applyDocument (doc, {}, rep);
        cur_ = Current {};
        cur_.id = "init";                 // the compiled-in INIT: not a file, read-only, "Save" opens Save As
        cur_.name = "INIT";
        cur_.pack = "Factory";
        cur_.kind = cfg_.flat ? "preset" : "sound";
        cur_.readOnly = true;
        cur_.doc = doc;
        rep.name = cur_.name;
        rebaseline();
        slot_[active_] = captureSlot();
        ++generation_;
        fire (StateEvent::Kind::Preset);
        return Result<LoadReport>::success (rep);
    }

    // ------------------------------------------------------------------------------ save
    Result<SaveReport> save (const SaveRequest& req)
    {
        if (auto e = needLive(); ! e.empty()) return Result<SaveReport>::fail (e);
        if (cfg_.gate && ! cfg_.gate (Gate::Save)) return Result<SaveReport>::fail ("gated", "Saving presets is locked in this license state.");
        if (! cfg_.layout.valid) return Result<SaveReport>::fail ("no_layout", "The preset folder could not be determined: " + cfg_.layout.error);

        SaveReport rep;
        std::string kind = req.kind.empty() ? cur_.kind : req.kind;
        if (cfg_.flat)
        {
            if (! req.kind.empty() && req.kind != "preset") return Result<SaveReport>::fail ("bad_kind", "Asset kind \"" + req.kind + "\" is not valid for a flat plugin (only \"preset\").");
            kind = "preset";
        }
        if (kind.empty()) kind = "sound";
        apc::AssetKind ak;
        if (! kindFromString (kind, ak) || (cfg_.flat && ak != apc::AssetKind::Preset) || (! cfg_.flat && ak == apc::AssetKind::Preset))
            return Result<SaveReport>::fail ("bad_kind", "Asset kind \"" + kind + "\" is not valid for a " + (cfg_.flat ? "flat" : "typed") + " plugin.");
        const std::string ext = extensionFor (ak);
        if (ext.empty()) return Result<SaveReport>::fail ("no_extension", std::string ("The file extension option ") + extOptionName (ak) + " is not configured; refusing to invent one.");

        if (req.name.empty() && ! cur_.hasFile) return Result<SaveReport>::fail ("name_required", "This state is not saved in a file yet. Give it a name (Save As).");
        std::string name = req.name.empty() ? cur_.name : req.name;
        if (juce::String (util::js (name)).trim().isEmpty()) return Result<SaveReport>::fail ("name_required", "Give the preset a name.");
        std::string pack = req.pack;

        // Quick Save = no name given: overwrite the loaded file. Any explicit name is a Save As (collision -> `exists`).
        const bool quick = req.name.empty() && ! req.saveAs;
        const bool inPlace = quick && cur_.hasFile && ! cur_.readOnly && (pack.empty() || pack == cur_.pack) && (kind == cur_.kind);
        fsys::path target;
        juce::var doc;
        if (inPlace)
        {
            target = fsys::path (cur_.path);
            pack = cur_.pack;
            doc = cur_.doc.clone();
        }
        else
        {
            bool cow = false;
            if (pack.empty()) pack = (cur_.hasFile && ! cur_.readOnly) ? cur_.pack : cfg_.userPack;
            if (cur_.readOnly) { cow = true; if (isPackReadOnly (pack)) pack = cfg_.userPack; }
            if (isPackReadOnly (pack)) return Result<SaveReport>::fail ("readonly", "The pack \"" + pack + "\" is read-only (factory content). Save into another pack.", util::pathToUtf8 (cfg_.layout.packDir (pack)));
            target = cfg_.layout.assetFile (pack, ak, cfg_.flat, name, ext);
            std::error_code ec;
            std::string reuseId;
            if (fsys::exists (target, ec))
            {
                if (cow && quick) { target = apc::uniquePath (target.parent_path(), apc::sanitizeFilename (name), ext, 2); }
                else if (! req.overwrite) return Result<SaveReport>::fail ("exists", "A file named \"" + util::pathToUtf8 (target.filename()) + "\" already exists in " + pack + ". Choose another name or confirm the overwrite.", util::pathToUtf8 (target));
                else { reuseId = idOfFile (target); rep.overwrote = true; }
            }
            doc = util::newObject();
            util::set (doc, "schema", "apc-preset/1.0");
            util::set (doc, "kind", util::js (kind));
            util::set (doc, "id", util::js (reuseId.empty() ? newId (ak) : reuseId));
            util::set (doc, "created", util::js (util::nowIsoUtc()));
            if (cur_.doc.isObject() || util::isObject (cur_.doc))
            {
                // carry over descriptive fields and unknown keys of what the user was editing (not identity)
                if (auto* d = cur_.doc.getDynamicObject())
                    for (const auto& p : d->getProperties())
                    {
                        const auto k = util::ss (p.name.toString());
                        if (isIdentityKey (k)) continue;
                        util::set (doc, k.c_str(), p.value);
                    }
                doc = doc.clone();
            }
            if (cow && cur_.hasFile) util::set (doc, "derived_from", util::js (cur_.id));
            rep.copiedFromReadOnly = cow;
        }

        // ---- fill the document from the LIVE state ----
        util::set (doc, "schema", "apc-preset/1.0");
        util::set (doc, "kind", util::js (kind));
        util::set (doc, "name", util::js (name));
        util::set (doc, "app_version", util::js (cfg_.appVersion));
        if (util::isObject (req.meta))
        {
            auto meta = util::isObject (util::get (doc, "meta")) ? util::get (doc, "meta") : util::newObject();
            for (const auto& p : req.meta.getDynamicObject()->getProperties())
            {
                if (p.value.isVoid()) meta.getDynamicObject()->removeProperty (p.name);
                else util::set (meta, util::ss (p.name.toString()).c_str(), p.value);
            }
            util::set (doc, "meta", meta);
        }
        util::set (doc, "params", paramsVarFromLive (util::get (doc, "params")));
        if (live_.snapshotExtras)
        {
            const auto ex = live_.snapshotExtras();
            if (auto* d = ex.getDynamicObject())
                for (const auto& p : d->getProperties())
                {
                    const auto k = util::ss (p.name.toString());
                    if (isIdentityKey (k) || k == "params" || k == "meta" || k == "engine" || k == "state_version") continue;
                    util::set (doc, k.c_str(), p.value);
                }
        }
        if (auto* d = doc.getDynamicObject()) { d->removeProperty ("engine"); d->removeProperty ("state_version"); d->removeProperty ("session"); }
        rewriteReboundRefs (doc, target, pack);

        const std::string text = util::toJsonText (doc) + "\n";
        apc::AtomicWriteOptions wopt = cfg_.atomic;
        wopt.keepBackup = cfg_.keepBackup;
        const auto w = apc::atomicWrite (target, text, wopt);
        if (! w.ok) return Result<SaveReport>::fail ("io", w.error, util::pathToUtf8 (w.path));

        ensurePackManifest (pack, rep.warnings);

        rep.id = util::getStr (doc, "id");
        rep.name = name; rep.pack = pack; rep.kind = kind; rep.path = util::pathToUtf8 (target);
        indexOneFile (target, rep.warnings);

        cur_ = Current {};
        cur_.id = rep.id; cur_.name = name; cur_.pack = pack; cur_.kind = kind;
        cur_.path = rep.path; cur_.hasFile = true; cur_.readOnly = false;
        cur_.doc = doc;
        rebaseline();
        ++generation_;
        fire (StateEvent::Kind::Preset);
        return Result<SaveReport>::success (rep);
    }

    // ------------------------------------------------------------------------------ A/B
    Status ab (const std::string& action)
    {
        if (auto e = needLive(); ! e.empty()) return Status::fail (e);
        const int other = 1 - active_;
        if (action == "toggle")
        {
            slot_[active_] = captureSlot();
            if (! slot_[other].valid) slot_[other] = slot_[active_];
            active_ = other;
            applySlot (slot_[active_]);
        }
        else if (action == "copyAtoB")
        {
            if (active_ == 0) { slot_[0] = captureSlot(); slot_[1] = slot_[0]; }
            else { slot_[1] = captureSlot(); if (! slot_[0].valid) slot_[0] = slot_[1]; slot_[1] = slot_[0]; applySlot (slot_[1]); }
        }
        else if (action == "copyBtoA")
        {
            if (active_ == 1) slot_[1] = captureSlot();
            if (! slot_[1].valid) return Status::fail ("empty", "Slot B is empty. Use \"Copy A to B\" or toggle first.");
            slot_[0] = slot_[1];
            if (active_ == 0) applySlot (slot_[0]);
        }
        else return Status::fail ("invalid", "Unknown A/B action \"" + action + "\" (toggle, copyAtoB, copyBtoA).");
        recomputeDirty();
        fire (StateEvent::Kind::Preset);
        return Status::success();
    }

    // ------------------------------------------------------------------------------ read-only / packs
    bool isPackReadOnly (const std::string& pack) const
    {
        for (const auto& p : cfg_.readOnlyPacks) if (p == pack) return true;
        std::string text, err;
        juce::var m;
        const auto mf = cfg_.layout.manifestFile (pack);
        if (apc::readFileToString (mf, text).ok && util::parseJson (text, m, err))
            if (util::getStr (m, "license") == "factory" && ! cfg_.devWritableFactory) return true;
        std::error_code ec;
        const auto dir = cfg_.layout.packDir (pack);
        if (fsys::exists (dir, ec) && ! util::fileOf (dir).hasWriteAccess()) return true;
        return false;
    }

    // ------------------------------------------------------------------------------ references
    // Resolve every kit/sequence/sound reference of `doc` (transitively). `fileAbs` = where `doc` lives.
    std::vector<RefInfo> resolveReferences (const juce::var& doc, const fsys::path& fileAbs, const std::string& pack) const
    {
        std::vector<RefInfo> out;
        std::set<std::string> visiting;
        resolveRefsRec (doc, fileAbs, cfg_.layout.packDir (pack), pack, 0, out, visiting);
        return out;
    }

    // Sample resolution order (P-16): relative ref (sha256 verified) -> hash lookup -> embedded_b64 -> [Missing].
    SampleResolution resolveSample (const juce::var& entry, const std::string& packName) const
    {
        SampleResolution r;
        const std::string ref = util::getStr (entry, "ref");
        const std::string want = util::getStr (entry, "sha256");
        const std::string pk = util::getStr (entry, "pack", packName);
        bool sawMismatch = false;
        if (! ref.empty() && ref.find("..") == std::string::npos && ref.front() != '/' && ref.find (':') == std::string::npos)
        {
            const auto p = cfg_.layout.packDir (pk.empty() ? packName : pk) / util::pathOf (ref);
            std::error_code ec;
            if (fsys::is_regular_file (p, ec))
            {
                std::string hex, err;
                std::int64_t sz = 0;
                if (apc::sysutil::sha256File (p, hex, sz, err) && (want.empty() || hex == want)) { r.status = "found"; r.path = util::pathToUtf8 (p); return r; }
                sawMismatch = true;
            }
        }
        if (! want.empty())
        {
            std::string found = findSampleByHash (want, (std::int64_t) util::getNum (entry, "bytes", -1));
            if (! found.empty()) { r.status = "rebound-by-hash"; r.path = found; return r; }
        }
        if (! util::getStr (entry, "embedded_b64").empty()) { r.status = "embedded"; return r; }
        r.status = sawMismatch ? "hash-mismatch" : "missing";
        r.message = "[Missing: " + (ref.empty() ? want : ref) + "]";
        return r;
    }

    static juce::var makeSampleEntry (const fsys::path& packDir, const std::string& packName, const std::string& relRef)
    {
        auto o = util::newObject();
        util::set (o, "ref", util::js (relRef));
        std::string hex, err; std::int64_t sz = 0;
        if (apc::sysutil::sha256File (packDir / util::pathOf (relRef), hex, sz, err))
        {
            util::set (o, "sha256", util::js (hex));
            util::set (o, "bytes", (juce::int64) sz);
        }
        util::set (o, "pack", util::js (packName));
        return o;
    }

    // ------------------------------------------------------------------------------ host chunk
    static bool looksLikeChunk (const void* data, std::size_t size)
    {
        const auto* p = static_cast<const unsigned char*> (data);
        while (size > 0 && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) { ++p; --size; }
        return size > 0 && *p == '{';
    }

    // getStateInformation(): the full state as one apc-preset/1.0 document (UTF-8 JSON, no BOM).
    Result<std::string> serializeChunk()
    {
        if (auto e = needLive(); ! e.empty()) return Result<std::string>::fail (e);
        auto doc = cur_.doc.isVoid() ? util::newObject() : cur_.doc.clone();
        util::set (doc, "schema", "apc-preset/1.0");
        util::set (doc, "kind", util::js (cfg_.chunkKind));
        {
            apc::AssetKind ak = apc::AssetKind::Preset;
            kindFromString (cfg_.chunkKind, ak);
            util::set (doc, "id", util::js ((cur_.hasFile && cur_.kind == cfg_.chunkKind && ! cur_.id.empty()) ? cur_.id : newId (ak)));
        }
        if (util::getStr (doc, "name").empty()) util::set (doc, "name", util::js (cur_.name.empty() ? "Init" : cur_.name));
        util::set (doc, "state_version", cfg_.stateVersion);
        util::set (doc, "app_version", util::js (cfg_.appVersion));
        util::set (doc, "params", paramsVarFromLive (util::get (doc, "params")));
        if (live_.snapshotExtras)
        {
            const auto ex = live_.snapshotExtras();
            if (auto* d = ex.getDynamicObject())
                for (const auto& p : d->getProperties())
                {
                    const auto k = util::ss (p.name.toString());
                    if (isIdentityKey (k) || k == "params" || k == "engine" || k == "state_version") continue;
                    util::set (doc, k.c_str(), p.value);
                }
        }
        if (auto* d = doc.getDynamicObject()) d->removeProperty ("engine");
        if (cfg_.engineInChunk && live_.getEngine) { const auto en = live_.getEngine(); if (util::isObject (en)) util::set (doc, "engine", en.clone()); }

        auto session = util::newObject();
        util::set (session, "dirty", dirty_.load());
        auto pr = util::newObject();
        util::set (pr, "id", util::js (cur_.id));
        util::set (pr, "name", util::js (cur_.name));
        util::set (pr, "pack", util::js (cur_.pack));
        util::set (pr, "kind", util::js (cur_.kind));
        util::set (pr, "hasFile", cur_.hasFile);
        util::set (session, "preset", pr);
        auto abv = util::newObject();
        util::set (abv, "active", util::js (std::string (1, active_ == 0 ? 'A' : 'B')));
        auto slots = util::newObject();
        for (int i = 0; i < 2; ++i)
        {
            const Slot s = (i == active_) ? captureSlot() : slot_[i];
            if (! s.valid) continue;
            auto so = util::newObject();
            auto pv = util::newObject();
            for (const auto& d : live_.decls)
            {
                const auto it = s.params.find (d.id);
                if (it != s.params.end()) util::set (pv, d.id.c_str(), valueToVar (it->second, d));
            }
            util::set (so, "params", pv);
            if (! s.extras.isVoid()) util::set (so, "extras", s.extras);
            util::set (slots, i == 0 ? "A" : "B", so);
        }
        util::set (abv, "slots", slots);
        util::set (session, "ab", abv);
        util::set (doc, "session", session);
        return Result<std::string>::success (util::toJsonText (doc, true));
    }

    // setStateInformation(): defaults-first restore. A bad/foreign chunk leaves the plugin on its defaults
    // (we apply the defaults first so a failed restore never leaves half-applied state) and reports why.
    Result<ChunkReport> restoreChunk (const void* data, std::size_t size)
    {
        if (auto e = needLive(); ! e.empty()) return Result<ChunkReport>::fail (e);
        if (data == nullptr || size == 0) return Result<ChunkReport>::fail ("bad_chunk", "The saved plugin state is empty; using the defaults.");
        juce::var doc;
        std::string err;
        if (! util::parseJson (std::string (static_cast<const char*> (data), size), doc, err) || ! util::isObject (doc))
            return Result<ChunkReport>::fail ("bad_chunk", "The saved plugin state is not valid JSON (" + err + "); using the defaults.");
        const std::string schema = util::getStr (doc, "schema");
        if (schema.rfind ("apc-preset/", 0) != 0) return Result<ChunkReport>::fail ("bad_chunk", "The saved plugin state is not an apc-preset document (schema \"" + schema + "\").");
        if (majorOf (schema) > 1) return Result<ChunkReport>::fail ("bad_schema", "The saved plugin state was written by a newer version (" + schema + ").");

        ChunkReport rep;
        rep.stateVersionFound = (int) util::getNum (doc, "state_version", 0);
        if (rep.stateVersionFound > cfg_.stateVersion)
            rep.warnings.push_back ("The state was written by a newer plugin version (state_version " + std::to_string (rep.stateVersionFound) + "); unknown parts were kept but may be ignored.");

        applyDocument (doc, {}, rep.load);
        if (cfg_.engineInChunk && live_.setEngine && util::isObject (util::get (doc, "engine"))) { live_.setEngine (util::get (doc, "engine")); rep.engineApplied = true; }

        // identity
        cur_ = Current {};
        const auto session = util::get (doc, "session");
        const auto pr = util::get (session, "preset");
        cur_.id = util::getStr (pr, "id");
        cur_.name = util::getStr (pr, "name", util::getStr (doc, "name"));
        cur_.pack = util::getStr (pr, "pack");
        cur_.kind = util::getStr (pr, "kind", util::getStr (doc, "kind"));
        cur_.doc = doc;
        if (auto* d = cur_.doc.getDynamicObject()) { d->removeProperty ("session"); d->removeProperty ("engine"); d->removeProperty ("state_version"); }
        if (! cur_.id.empty())
        {
            const auto idx = index();
            if (const IndexRow* row = idx->find (cur_.id))
            {
                cur_.path = util::pathToUtf8 (cfg_.layout.presets / util::pathOf (row->path));
                cur_.hasFile = true;
                cur_.pack = row->pack;
                cur_.readOnly = isPackReadOnly (row->pack);
            }
        }
        rebaseline();   // baseline = what was just applied
        // A/B + dirty
        slot_[0] = slot_[1] = Slot {};
        active_ = 0;
        const auto abv = util::get (session, "ab");
        const auto slots = util::get (abv, "slots");
        for (int i = 0; i < 2; ++i)
        {
            const auto so = util::get (slots, i == 0 ? "A" : "B");
            if (! util::isObject (so)) continue;
            Slot s;
            s.valid = true;
            s.params = decodeParams (util::get (so, "params"));
            s.extras = util::get (so, "extras");
            slot_[i] = s;
        }
        if (util::getStr (abv, "active") == "B" && slot_[1].valid) active_ = 1;
        dirty_ = util::getBool (session, "dirty", false);
        baselineStale_ = dirty_.load() && cur_.hasFile;   // the file may differ from the chunk: keep reporting dirty
        ++generation_;
        fire (StateEvent::Kind::Preset);
        rep.load.id = cur_.id; rep.load.name = cur_.name;
        return Result<ChunkReport>::success (rep);
    }

    // ------------------------------------------------------------------------------ import / export / factory
    // Import an asset file (JSON), a zip pack, or inline JSON text. NEVER overwrites a file (P-06).
    Result<ImportReport> importAsset (const std::string& path, const std::string& data, const std::string& packName = {})
    {
        if (cfg_.gate && ! cfg_.gate (Gate::PackInstall)) return Result<ImportReport>::fail ("gated", "Importing presets and packs is locked in this license state.");
        if (! cfg_.layout.valid) return Result<ImportReport>::fail ("no_layout", "The preset folder could not be determined: " + cfg_.layout.error);
        std::string bytes;
        std::string label = path;
        if (! path.empty())
        {
            const auto r = apc::readFileToString (util::pathOf (path), bytes);
            if (! r.ok) return Result<ImportReport>::fail ("io", r.error, path);
        }
        else bytes = data;
        if (bytes.empty()) return Result<ImportReport>::fail ("invalid", "Nothing to import (empty file).", path);
        ImportReport rep;
        if (bytes.size() > 4 && bytes[0] == 'P' && bytes[1] == 'K')
        {
            auto r = importZip (bytes, path.empty() ? "import" : util::pathToUtf8 (util::pathOf (path).stem()), rep);
            if (! r.ok) return Result<ImportReport>::fail (r.error);
        }
        else
        {
            juce::var doc;
            std::string err;
            if (! util::parseJson (bytes, doc, err)) return Result<ImportReport>::fail ("bad_json", "Not a valid preset file: " + err, path);
            if (! isAssetDoc (doc)) return Result<ImportReport>::fail ("bad_schema", "Not an apc-preset asset (missing schema/id).", path);
            if (majorOf (util::getStr (doc, "schema")) > 1) return Result<ImportReport>::fail ("bad_schema", "This preset was written by a newer version (" + util::getStr (doc, "schema") + ").", path);
            std::string kind = util::getStr (doc, "kind");
            apc::AssetKind ak;
            if (! kindFromString (kind, ak)) return Result<ImportReport>::fail ("bad_kind", "Unknown asset kind \"" + kind + "\".", path);
            if (cfg_.flat != (ak == apc::AssetKind::Preset)) return Result<ImportReport>::fail ("bad_kind", "A \"" + kind + "\" asset does not fit this plugin's " + (cfg_.flat ? "flat" : "typed") + " preset layout.", path);
            const std::string ext = extensionFor (ak);
            if (ext.empty()) return Result<ImportReport>::fail ("no_extension", std::string ("The file extension option ") + extOptionName (ak) + " is not configured.");
            const std::string pack = packName.empty() ? cfg_.userPack : packName;
            if (isPackReadOnly (pack)) return Result<ImportReport>::fail ("readonly", "The pack \"" + pack + "\" is read-only.");
            ImportedItem it;
            it.id = util::getStr (doc, "id");
            if (index()->find (it.id) != nullptr)
            {
                it.id = newId (ak);
                util::set (doc, "id", util::js (it.id));
                it.idChanged = true;
            }
            it.name = util::getStr (doc, "name", "imported"); it.kind = kind; it.pack = pack;
            if (auto* d = doc.getDynamicObject()) { d->removeProperty ("engine"); d->removeProperty ("state_version"); d->removeProperty ("session"); }
            const auto w = apc::importNoClobber (cfg_.layout.assetDir (pack, ak, cfg_.flat), it.name, ext, util::toJsonText (doc) + "\n", cfg_.atomic);
            if (! w.ok) return Result<ImportReport>::fail ("io", w.error, util::pathToUtf8 (w.path));
            it.path = util::pathToUtf8 (w.path);
            ensurePackManifest (pack, rep.warnings);
            rep.items.push_back (it);
            rep.packFolder = pack;
        }
        if (auto r = rescan (false); ! r.ok) rep.warnings.push_back (r.error.message);
        if (rep.items.empty() && ! rep.packFolder.empty() && rep.skipped.empty())
            for (const auto& row : index()->rows)
                if (row.pack == rep.packFolder) rep.items.push_back ({ row.id, row.name, row.kind, row.pack, util::pathToUtf8 (cfg_.layout.presets / util::pathOf (row.path)), false });
        return Result<ImportReport>::success (rep);
    }

    // Export the given assets + everything they reference (kits->sounds, patches->kits+sequences, samples) as a
    // pack archive in <root>/exports/. Returns the zip path.
    Result<std::string> exportPack (const std::vector<std::string>& ids, const std::string& packTitle = {})
    {
        if (cfg_.gate && ! cfg_.gate (Gate::PackExport)) return Result<std::string>::fail ("gated", "Exporting packs is locked in this license state.");
        if (! cfg_.layout.valid) return Result<std::string>::fail ("no_layout", "The preset folder could not be determined: " + cfg_.layout.error);
        if (ids.empty()) return Result<std::string>::fail ("invalid", "Select at least one preset to export.");
        const auto idx = index();
        std::map<std::string, std::pair<fsys::path, std::string>> files;   // zip path -> (abs file, pack)
        std::set<std::string> done;
        std::function<Status (const std::string&)> add = [&] (const std::string& id) -> Status
        {
            if (! done.insert (id).second) return Status::success();
            const IndexRow* row = idx->find (id);
            if (row == nullptr) return Status::fail ("not_found", "No preset with id " + id + ".");
            const fsys::path abs = cfg_.layout.presets / util::pathOf (row->path);
            const fsys::path packDir = cfg_.layout.packDir (row->pack);
            const std::string inPack = util::posixRel (packDir, abs);
            files[inPack] = { abs, row->pack };
            std::string text, err;
            juce::var doc;
            if (! apc::readFileToString (abs, text).ok || ! util::parseJson (text, doc, err)) return Status::fail ("io", "Cannot read " + row->path, util::pathToUtf8 (abs));
            for (const auto& ri : resolveReferences (doc, abs, row->pack))
            {
                if (ri.depth != 0 || ! ri.usable || ri.file.empty()) continue;   // deeper levels are added by the recursion
                for (const auto& rr : idx->rows)
                    if ((cfg_.layout.presets / util::pathOf (rr.path)).lexically_normal() == fsys::path (ri.file).lexically_normal())
                    {
                        auto s = add (rr.id);
                        if (! s.ok) return s;
                        break;
                    }
            }
            std::vector<std::string> samples;
            const auto sr = util::getStr (doc, "sample_ref");
            if (! sr.empty()) samples.push_back (sr);
            if (const auto* arr = util::get (doc, "samples").getArray())
                for (const auto& s : *arr) { const auto ref = util::getStr (s, "ref"); if (! ref.empty()) samples.push_back (ref); }
            for (const auto& s : samples)
            {
                if (s.find ("..") != std::string::npos || s.empty() || s.front() == '/') continue;
                const auto p = packDir / util::pathOf (s);
                std::error_code ec;
                if (fsys::is_regular_file (p, ec)) files[s] = { p, row->pack };
            }
            return Status::success();
        };
        for (const auto& id : ids) { auto s = add (id); if (! s.ok) return Result<std::string>::fail (s.error); }

        juce::ZipFile::Builder zb;   // takes ownership of the streams added to it
        auto manifest = util::newObject();
        const std::string title = packTitle.empty() ? "Export " + util::nowIsoUtc().substr (0, 10) : packTitle;
        util::set (manifest, "schema", "apc-pack/1.0");
        util::set (manifest, "id", util::js ("pack_" + util::newUuid()));
        util::set (manifest, "name", util::js (title));
        util::set (manifest, "version", "1.0.0");
        util::set (manifest, "license", "user");
        util::set (manifest, "plugin", util::js (cfg_.pluginName));
        util::set (manifest, "app_version_min", util::js (cfg_.appVersion));
        util::set (manifest, "layout", util::js (cfg_.flat ? "flat" : "typed"));
        {
            const std::string mtext = util::toJsonText (manifest) + "\n";
            zb.addEntry (std::make_unique<juce::MemoryInputStream> (mtext.data(), mtext.size(), true), 9, "pack.json", juce::Time::getCurrentTime());
        }
        std::int64_t total = 0;
        for (const auto& kv : files)
        {
            std::string bytes;
            const auto r = apc::readFileToString (kv.second.first, bytes);
            if (! r.ok) return Result<std::string>::fail ("io", r.error, util::pathToUtf8 (kv.second.first));
            total += (std::int64_t) bytes.size();
            if (total > cfg_.maxImportBytes) return Result<std::string>::fail ("too_large", "The selection is too large to export.");
            zb.addEntry (std::make_unique<juce::MemoryInputStream> (bytes.data(), bytes.size(), true), 9, util::js (kv.first), juce::Time::getCurrentTime());
        }
        juce::MemoryOutputStream mos;
        zb.writeToStream (mos, nullptr);
        const fsys::path dest = apc::uniquePath (cfg_.layout.root / "exports", apc::sanitizeFilename (title), ".zip");
        const auto w = apc::atomicWrite (dest, std::string_view (static_cast<const char*> (mos.getData()), mos.getDataSize()), cfg_.atomic);
        if (! w.ok) return Result<std::string>::fail ("io", w.error, util::pathToUtf8 (w.path));
        return Result<std::string>::success (util::pathToUtf8 (dest));
    }

    // "Restore Factory Layout": re-create the factory pack(s) without touching User/ or _wip/.
    Status restoreFactoryLayout()
    {
        if (! cfg_.layout.valid) return Status::fail ("no_layout", "The preset folder could not be determined: " + cfg_.layout.error);
        Status s;
        if (cfg_.restoreFactory) s = cfg_.restoreFactory (cfg_.layout.presets);
        else
        {
            std::error_code ec;
            if (cfg_.layout.factorySeed.empty() || ! fsys::is_directory (cfg_.layout.factorySeed, ec))
                return Status::fail ("no_factory_source", "No factory pack source is available (no embedded archive hook and no shared seed folder).", util::pathToUtf8 (cfg_.layout.factorySeed));
            s = copySeed (cfg_.layout.factorySeed, cfg_.layout.presets);
        }
        if (! s.ok) return s;
        auto r = rescan (true);
        return r.ok ? Status::success() : Status::fail (r.error);
    }

    // Extract a zip held in memory (embedded factory archive) into the presets folder. Same safety rules as import.
    Status restoreFromZip (const void* zipData, std::size_t size)
    {
        ImportReport rep;
        return importZipInto (std::string (static_cast<const char*> (zipData), size), "", rep, true);
    }

    // Settings -> "Presets & Data": root folder, index age, packs (apc.presets.info).
    juce::var presetsInfo()
    {
        if (! scanned_.load()) rescan (false);
        const auto idx = index();
        std::map<std::string, int> counts;
        for (const auto& r : idx->rows) ++counts[r.pack];
        std::error_code ec;
        if (fsys::is_directory (cfg_.layout.presets, ec))
            for (const auto& e : sortedEntries (cfg_.layout.presets))
            {
                const std::string n = util::pathToUtf8 (e.path().filename());
                if (e.is_directory (ec) && ! n.empty() && n[0] != '.' && ! isIgnoredDir (n) && ! counts.count (n)) counts[n] = 0;   // an empty pack is still a pack
            }
        counts.emplace (cfg_.userPack, 0);
        auto packs = util::newArray();
        auto writable = util::newArray();
        for (const auto& kv : counts)
        {
            const bool ro = isPackReadOnly (kv.first);
            auto p = util::newObject();
            util::set (p, "name", util::js (kv.first));
            util::set (p, "readOnly", ro);
            util::set (p, "count", kv.second);
            util::push (packs, p);
            if (! ro) util::push (writable, juce::var (util::js (kv.first)));
        }
        auto o = util::newObject();
        util::set (o, "root", util::js (util::pathToUtf8 (cfg_.layout.presets)));
        util::set (o, "assets", (int) idx->rows.size());
        util::set (o, "builtAt", util::js (builtAt()));
        if (! cfg_.devRoot.empty()) util::set (o, "devRoot", util::js (cfg_.devRoot));
        util::set (o, "factoryInstall", util::js (cfg_.factoryInstall));
        util::set (o, "hierarchy", util::js (cfg_.flat ? "flat" : "typed"));
        util::set (o, "packs", packs);
        util::set (o, "writablePacks", writable);
        return o;
    }

    // ------------------------------------------------------------------------------ exposed for tests
    static bool kindFromString (const std::string& k, apc::AssetKind& out)
    {
        if (k == "sound") out = apc::AssetKind::Sound;
        else if (k == "kit") out = apc::AssetKind::Kit;
        else if (k == "sequence") out = apc::AssetKind::Sequence;
        else if (k == "patch") out = apc::AssetKind::Patch;
        else if (k == "preset") out = apc::AssetKind::Preset;
        else return false;
        return true;
    }

private:
    // ---- internal types ------------------------------------------------------------------------------
    struct Slot
    {
        bool valid = false;
        std::map<std::string, apc::Value> params;
        juce::var extras;
    };

    struct FilterSet
    {
        std::vector<std::string> kinds, categories, subcategories, genres, moods, tags, packs;
        struct AxisF { std::string key; int idx; bool lte; };   // threshold on the ordered word list: >= idx (default) or <= idx
        std::vector<AxisF> axes;
        bool favorite = false;
        int minRating = 0;
        std::string scopeKind, scopePack;

        bool matches (const IndexRow& r, const UserEntry& u) const
        {
            if (! scopeKind.empty() && r.kind != scopeKind) return false;
            if (! scopePack.empty() && r.pack != scopePack) return false;
            if (! kinds.empty() && std::find (kinds.begin(), kinds.end(), r.kind) == kinds.end()) return false;
            if (! packs.empty() && std::find (packs.begin(), packs.end(), r.pack) == packs.end()) return false;
            if (favorite && ! u.favorite) return false;
            if (u.rating < minRating) return false;
            if (! categories.empty() && ! oneOf (categories, { util::norm (util::getStr (r.meta, "category")) })) return false;
            if (! subcategories.empty() && ! oneOf (subcategories, { util::norm (util::getStr (r.meta, "subcategory")) })) return false;
            if (! genres.empty())
            {
                std::vector<std::string> have;
                const auto g = util::get (r.meta, "genre");
                if (g.isString()) have.push_back (canonicalGenre (util::ss (g.toString())));
                else if (const auto* a = g.getArray()) for (const auto& x : *a) if (x.isString()) have.push_back (canonicalGenre (util::ss (x.toString())));
                if (! oneOf (genres, have)) return false;
            }
            if (! moods.empty() && ! oneOf (moods, strList (util::get (r.meta, "moods")))) return false;
            if (! tags.empty() && ! oneOf (tags, strList (util::get (r.meta, "tags")))) return false;
            for (const auto& ax : axes)
            {
                const auto word = util::norm (util::getStr (util::get (r.meta, "axes"), ax.key.c_str()));
                if (word.empty()) return false;   // untagged never passes a strict axis filter
                int idx = -1;
                for (const auto& def : axisTable())
                    if (ax.key == def.key)
                        for (std::size_t i = 0; i < def.words.size(); ++i) if (word == def.words[i]) idx = (int) i;
                if (idx < 0) return false;                       // a word outside the vocabulary never satisfies a strict filter
                if (ax.lte ? idx > ax.idx : idx < ax.idx) return false;
            }
            return true;
        }

        static std::vector<std::string> strList (const juce::var& v)
        {
            std::vector<std::string> out;
            if (v.isString()) out.push_back (util::norm (util::ss (v.toString())));
            else if (const auto* a = v.getArray()) for (const auto& x : *a) if (x.isString()) out.push_back (util::norm (util::ss (x.toString())));
            return out;
        }
        static bool oneOf (const std::vector<std::string>& want, const std::vector<std::string>& have)
        {
            for (const auto& w : want) if (std::find (have.begin(), have.end(), w) != have.end()) return true;
            return false;
        }
    };

    // ---- constants mirrored from scripts/apc-presets.js ---------------------------------------------
    static bool isIgnoredDir (const std::string& n) { return n == "samples" || n == "_history" || n == "cache" || n == ".git" || n == "node_modules"; }
    static bool isKindDir (const std::string& n) { return n == "sounds" || n == "kits" || n == "sequences" || n == "patches"; }
    static bool isAssetCandidateName (const std::string& name)
    {
        if (name.empty() || name[0] == '.') return false;
        if (name == "pack.json" || name == "changelog.json" || name == "user-data.json" || name == "settings.json") return false;
        // /\.(tmp|promote-bak)-\d+$/
        for (const char* tag : { ".tmp-", ".promote-bak-" })
        {
            const auto pos = name.rfind (tag);
            if (pos != std::string::npos)
            {
                bool digits = pos + std::strlen (tag) < name.size();
                for (std::size_t i = pos + std::strlen (tag); i < name.size(); ++i) digits = digits && name[i] >= '0' && name[i] <= '9';
                if (digits) return false;
            }
        }
        static const std::set<std::string> nonAsset = { ".wav", ".flac", ".aif", ".aiff", ".ogg", ".mp3", ".png", ".jpg", ".jpeg", ".svg", ".md", ".txt", ".zip", ".lic", ".bak", ".log" };
        const auto dot = name.rfind ('.');
        if (dot != std::string::npos && dot > 0)
        {
            std::string e = name.substr (dot);
            std::transform (e.begin(), e.end(), e.begin(), [] (unsigned char c) { return (char) std::tolower (c); });
            if (nonAsset.count (e)) return false;
        }
        return true;
    }

    static std::vector<fsys::directory_entry> sortedEntries (const fsys::path& dir)
    {
        std::vector<fsys::directory_entry> v;
        std::error_code ec;
        for (fsys::directory_iterator it (dir, ec), end; ! ec && it != end; it.increment (ec)) v.push_back (*it);
        std::sort (v.begin(), v.end(), [] (const auto& a, const auto& b) { return util::pathToUtf8 (a.path().filename()) < util::pathToUtf8 (b.path().filename()); });
        return v;
    }

    static void walkFiles (const fsys::path& dir, std::vector<fsys::path>& out)
    {
        for (const auto& e : sortedEntries (dir))
        {
            std::error_code ec;
            const std::string n = util::pathToUtf8 (e.path().filename());
            if (e.is_directory (ec)) { if (! isIgnoredDir (n)) walkFiles (e.path(), out); }
            else if (e.is_regular_file (ec)) out.push_back (e.path());
        }
    }

    static bool isPackDir (const fsys::path& dir)
    {
        std::error_code ec;
        if (fsys::exists (dir / "pack.json", ec)) return true;
        for (const char* k : { "sounds", "kits", "sequences", "patches" }) if (fsys::is_directory (dir / k, ec)) return true;
        for (const auto& e : sortedEntries (dir)) if (e.is_regular_file (ec) && isAssetCandidateName (util::pathToUtf8 (e.path().filename()))) return true;
        return false;
    }

    static std::vector<fsys::path> findPacks (const fsys::path& dir)
    {
        if (isPackDir (dir)) return { dir };
        std::vector<fsys::path> out;
        for (const auto& e : sortedEntries (dir))
        {
            std::error_code ec;
            const std::string n = util::pathToUtf8 (e.path().filename());
            if (! e.is_directory (ec) || n.empty() || n[0] == '.' || isIgnoredDir (n)) continue;
            if (isPackDir (e.path())) out.push_back (e.path());
        }
        return out;
    }

    static void collectAssetFiles (const fsys::path& packDir, std::vector<fsys::path>& out)
    {
        for (const auto& e : sortedEntries (packDir))
        {
            std::error_code ec;
            const std::string n = util::pathToUtf8 (e.path().filename());
            if (e.is_regular_file (ec)) { if (isAssetCandidateName (n)) out.push_back (e.path()); }
            else if (e.is_directory (ec) && isKindDir (n))
            {
                std::vector<fsys::path> sub;
                walkFiles (e.path(), sub);
                for (const auto& f : sub) if (isAssetCandidateName (util::pathToUtf8 (f.filename()))) out.push_back (f);
            }
        }
    }

    // meta as shown in lists: the file's top-level `author` is searchable and displayed, so surface it next to the PMX/1 meta.
    static juce::var metaWithAuthor (const IndexRow& r)
    {
        if (r.author.empty() || util::has (r.meta, "author")) return r.meta;
        auto m = util::newObject();
        if (auto* d = r.meta.getDynamicObject()) for (const auto& p : d->getProperties()) util::set (m, util::ss (p.name.toString()).c_str(), p.value);
        util::set (m, "author", util::js (r.author));
        return m;
    }

    // Names of referenced assets that cannot be resolved ("[Missing: <name>]" badges). Only kits and patches have references;
    // cached per index generation (cleared on every rescan / single-file re-index).
    std::vector<std::string> missingNames (const IndexRow& row) const
    {
        if (row.kind != "kit" && row.kind != "patch") return {};
        {
            std::lock_guard<std::mutex> g (indexMutex_);
            const auto it = missingCache_.find (row.path);
            if (it != missingCache_.end()) return it->second;
        }
        std::vector<std::string> out;
        std::string text, err;
        juce::var doc;
        const auto abs = cfg_.layout.presets / util::pathOf (row.path);
        if (apc::readFileToString (abs, text).ok && util::parseJson (text, doc, err))
            for (const auto& ri : resolveReferences (doc, abs, row.pack))
                if (! ri.usable && ri.status != "empty") out.push_back (ri.name);
        std::lock_guard<std::mutex> g (indexMutex_);
        missingCache_[row.path] = out;
        return out;
    }

    static bool isAssetDoc (const juce::var& doc)
    {
        return util::isObject (doc) && util::getStr (doc, "schema").rfind ("apc-preset/", 0) == 0 && util::get (doc, "id").isString();
    }
    static int majorOf (const std::string& schema)
    {
        const auto slash = schema.find ('/');
        return slash == std::string::npos ? 0 : std::atoi (schema.c_str() + slash + 1);
    }
    static void fillRowFromDoc (IndexRow& row, const juce::var& doc)
    {
        row.id = util::getStr (doc, "id");
        row.kind = util::getStr (doc, "kind");
        row.name = util::getStr (doc, "name");
        const auto m = util::get (doc, "meta");
        row.meta = util::isObject (m) ? m : util::newObject();
        const auto a = util::get (doc, "author");
        row.hasAuthor = true;
        row.author = a.isString() ? util::ss (a.toString()) : std::string();
    }
    static bool isIdentityKey (const std::string& k) { return k == "id" || k == "created" || k == "schema" || k == "kind" || k == "name" || k == "derived_from"; }
    static const char* extOptionName (apc::AssetKind k)
    {
        switch (k)
        {
            case apc::AssetKind::Sound: return "preset.sound_ext";
            case apc::AssetKind::Kit: return "preset.kit_ext";
            case apc::AssetKind::Sequence: return "preset.seq_ext";
            case apc::AssetKind::Patch: return "preset.patch_ext";
            case apc::AssetKind::Preset: return "preset.preset_ext";
        }
        return "preset.*_ext";
    }
    std::string extensionFor (apc::AssetKind k) const
    {
        switch (k)
        {
            case apc::AssetKind::Sound: return cfg_.soundExt;
            case apc::AssetKind::Kit: return cfg_.kitExt;
            case apc::AssetKind::Sequence: return cfg_.seqExt;
            case apc::AssetKind::Patch: return cfg_.patchExt;
            case apc::AssetKind::Preset: return cfg_.presetExt;
        }
        return {};
    }
    static std::string newId (apc::AssetKind k)
    {
        const char* p = "pre";
        switch (k)
        {
            case apc::AssetKind::Sound: p = "snd"; break;
            case apc::AssetKind::Kit: p = "kit"; break;
            case apc::AssetKind::Sequence: p = "seq"; break;
            case apc::AssetKind::Patch: p = "pat"; break;
            case apc::AssetKind::Preset: p = "pre"; break;
        }
        return std::string (p) + "_" + util::newUuid();
    }
    Error needLive() const
    {
        if (! live_.snapshotParams || ! live_.setParam) return makeError ("no_live_state", "The plugin has not connected its parameters to the preset store (LiveState).");
        return {};
    }
    std::string idOfFile (const fsys::path& f) const
    {
        std::string text, err;
        juce::var d;
        if (apc::readFileToString (f, text).ok && util::parseJson (text, d, err)) return util::getStr (d, "id");
        return {};
    }
    void fire (StateEvent::Kind k)
    {
        std::vector<std::function<void (const StateEvent&)>> copy;
        {
            std::lock_guard<std::mutex> g (listenerMutex_);
            for (const auto& l : listeners_) copy.push_back (l.second);
        }
        StateEvent e;
        e.kind = k;
        for (auto& f : copy) f (e);
    }

    // ---- filters -------------------------------------------------------------------------------------
    static std::string scopeOf (const juce::var& v)
    {
        if (v.isString()) return util::ss (v.toString());
        if (util::isObject (v))
        {
            const auto p = util::getStr (v, "pack");
            if (! p.empty()) return "pack:" + p;
            return util::getStr (v, "kind", "everything");
        }
        return "everything";
    }

    Error parseFilters (const juce::var& f, const std::string& scope, FilterSet& out) const
    {
        // scope
        if (scope.empty() || scope == "everything" || scope == "all" || scope == "any") {}
        else if (scope == "patches" || scope == "patch") out.scopeKind = "patch";
        else if (scope == "sounds" || scope == "sound") out.scopeKind = "sound";
        else if (scope == "kits" || scope == "kit") out.scopeKind = "kit";
        else if (scope == "sequences" || scope == "sequence") out.scopeKind = "sequence";
        else if (scope == "presets" || scope == "preset") out.scopeKind = "preset";
        else if (scope.rfind ("pack:", 0) == 0) out.scopePack = scope.substr (5);
        else out.scopePack = scope;

        if (f.isVoid() || f.isUndefined()) return {};
        if (! util::isObject (f)) return makeError ("invalid", "filters must be an object.");
        auto listOf = [&] (std::initializer_list<const char*> names, std::vector<std::string>& dst, bool genre = false) -> Error
        {
            for (const char* n : names)
            {
                const auto v = util::get (f, n);
                if (v.isVoid()) continue;
                std::vector<std::string> tmp;
                if (v.isString()) tmp.push_back (util::ss (v.toString()));
                else if (const auto* a = v.getArray()) { for (const auto& x : *a) if (x.isString()) tmp.push_back (util::ss (x.toString())); }
                else if (v.isBool() || v.isDouble() || v.isInt()) return makeError ("invalid", std::string ("filter \"") + n + "\" must be a string or an array of strings.");
                for (auto& t : tmp)
                {
                    const auto nt = util::norm (t);
                    if (nt.empty() || nt == "any") { tmp.clear(); break; }
                    t = genre ? canonicalGenre (t) : nt;
                }
                dst.insert (dst.end(), tmp.begin(), tmp.end());
            }
            return {};
        };
        Error e;
        if (! (e = listOf ({ "kind", "kinds" }, out.kinds)).empty()) return e;
        if (! (e = listOf ({ "category", "categories" }, out.categories)).empty()) return e;
        if (! (e = listOf ({ "subcategory", "subcategories" }, out.subcategories)).empty()) return e;
        if (! (e = listOf ({ "genre", "genres" }, out.genres, true)).empty()) return e;
        if (! (e = listOf ({ "mood", "moods" }, out.moods)).empty()) return e;
        if (! (e = listOf ({ "tag", "tags" }, out.tags)).empty()) return e;
        std::vector<std::string> packsRaw;
        {
            const auto v = util::get (f, "pack");
            if (v.isString()) packsRaw.push_back (util::ss (v.toString()));
            else if (const auto* a = v.getArray()) for (const auto& x : *a) if (x.isString()) packsRaw.push_back (util::ss (x.toString()));
            for (const auto& p : packsRaw) if (! p.empty() && util::norm (p) != "any") out.packs.push_back (p);
        }
        out.favorite = util::getBool (f, "favorite", false) || util::getBool (f, "favorites", false) || util::getBool (f, "favoritesOnly", false);
        out.minRating = (int) std::max ({ util::getNum (f, "rating", 0), util::getNum (f, "minRating", 0), util::getNum (f, "ratingMin", 0) });
        for (const char* key : { "axis", "axes" })
        {
            const auto ax = util::get (f, key);
            if (ax.isVoid()) continue;
            auto* d = ax.getDynamicObject();
            if (d == nullptr) return makeError ("invalid", "filters.axis must be an object { bri: \"muted\", ... }.");
            for (const auto& p : d->getProperties())
            {
                const std::string akey = util::ss (p.name.toString());
                // "muted" (= muted or higher), or what the kit sends: { word: "muted", op: "gte" | "lte" } ({min: w} / {max: w} also work)
                bool lte = false;
                std::string word;
                if (p.value.isString()) word = util::norm (util::ss (p.value.toString()));
                else if (util::isObject (p.value))
                {
                    word = util::norm (util::getStr (p.value, "word"));
                    if (word.empty()) word = util::norm (util::getStr (p.value, "min"));
                    if (word.empty()) { word = util::norm (util::getStr (p.value, "max")); lte = ! word.empty(); }
                    if (util::getStr (p.value, "op") == "lte") lte = true;
                }
                if (word.empty() || word == "any") continue;
                const AxisDef* def = nullptr;
                for (const auto& a : axisTable()) if (akey == a.key) def = &a;
                if (def == nullptr) return makeError ("invalid", "Unknown axis \"" + akey + "\".");
                int idx = -1;
                for (std::size_t i = 0; i < def->words.size(); ++i) if (word == def->words[i]) idx = (int) i;
                if (idx < 0) return makeError ("invalid", "\"" + word + "\" is not a word of axis " + akey + ".");
                out.axes.push_back ({ akey, idx, lte });
            }
        }
        return {};
    }

    static std::string haystack (const IndexRow& r)
    {
        std::string h = r.name;
        auto add = [&h] (const std::string& s) { if (! s.empty()) { h += ' '; h += s; } };
        add (util::getStr (r.meta, "subcategory"));
        add (util::getStr (r.meta, "desc"));
        add (util::getStr (r.meta, "category"));
        add (r.author);
        for (const auto& t : FilterSet::strList (util::get (r.meta, "tags"))) add (t);
        for (const auto& t : FilterSet::strList (util::get (r.meta, "moods"))) add (t);
        return util::ss (util::js (h).toLowerCase());
    }

    // ---- index cache ---------------------------------------------------------------------------------
    static juce::var rowToVar (const IndexRow& r)
    {
        auto o = util::newObject();
        util::set (o, "id", util::js (r.id));
        util::set (o, "kind", util::js (r.kind));
        util::set (o, "name", util::js (r.name));
        util::set (o, "pack", util::js (r.pack));
        util::set (o, "path", util::js (r.path));
        util::set (o, "meta", r.meta);
        util::set (o, "mtime", (juce::int64) r.mtime);
        util::set (o, "size", (juce::int64) r.size);
        util::set (o, "hash", util::js (r.hash));
        util::set (o, "author", r.hasAuthor ? juce::var (util::js (r.author)) : juce::var());
        util::set (o, "rating", r.rating);
        util::set (o, "favorite", r.favorite);
        if (r.hasUses) util::set (o, "uses", r.uses);
        return o;
    }
    static bool rowFromVar (const juce::var& v, IndexRow& r)
    {
        if (! util::isObject (v) || ! util::get (v, "id").isString() || ! util::get (v, "path").isString()) return false;
        r.id = util::getStr (v, "id"); r.kind = util::getStr (v, "kind"); r.name = util::getStr (v, "name");
        r.pack = util::getStr (v, "pack"); r.path = util::getStr (v, "path");
        r.meta = util::isObject (util::get (v, "meta")) ? util::get (v, "meta") : util::newObject();
        r.mtime = (std::int64_t) util::getNum (v, "mtime", -1); r.size = (std::int64_t) util::getNum (v, "size", -1);
        r.hash = util::getStr (v, "hash");
        r.hasAuthor = util::has (v, "author");
        r.author = util::getStr (v, "author");
        return true;
    }

    void readCache (std::map<std::string, juce::var>& out) const
    {
        std::string text, err;
        juce::var d;
        if (! apc::readFileToString (cfg_.layout.indexFile, text).ok || ! util::parseJson (text, d, err)) return;   // disposable: rebuild
        if (util::getStr (d, "schema") != "apc-index/1.0") return;
        if (const auto* a = util::get (d, "rows").getArray())
            for (const auto& r : *a) out[util::getStr (r, "path")] = r;
    }

    void finishIndex (Index& idx)
    {
        std::map<std::string, std::vector<std::string>> dup;
        std::map<std::string, std::string> first;
        std::set<std::string> ids;
        {
            std::lock_guard<std::mutex> g (userMutex_);
            for (auto& r : idx.rows)
            {
                const auto it = user_.find (r.id);
                if (it != user_.end()) { r.rating = it->second.rating; r.favorite = it->second.favorite; r.hasUses = it->second.hasUses; r.uses = it->second.uses; }
                else { r.rating = 0; r.favorite = false; r.hasUses = false; r.uses = 0; }
            }
            for (const auto& kv : user_) { (void) kv; }
        }
        for (std::size_t i = 0; i < idx.rows.size(); ++i)
        {
            const auto& r = idx.rows[i];
            ids.insert (r.id);
            if (r.pack != "_wip")
            {
                const auto f = first.find (r.id);
                if (f != first.end()) { if (! dup.count (r.id)) dup[r.id] = { f->second }; dup[r.id].push_back (r.path); }
                else first[r.id] = r.path;
            }
        }
        for (const auto& kv : dup)
        {
            std::string joined;
            for (const auto& p : kv.second) joined += (joined.empty() ? "" : ", ") + p;
            idx.warnings.push_back ({ "id-duplicate", "", "id " + kv.first + " appears in several non-_wip files: " + joined });
        }
        {
            std::lock_guard<std::mutex> g (userMutex_);
            for (const auto& kv : user_) if (! ids.count (kv.first)) ++idx.stats.orphanUserData;
        }
        // byId: first non-_wip occurrence wins, _wip only if nothing else has the id
        for (std::size_t i = 0; i < idx.rows.size(); ++i)
        {
            const auto& r = idx.rows[i];
            const auto it = idx.byId.find (r.id);
            if (it == idx.byId.end()) idx.byId[r.id] = i;
            else if (idx.rows[it->second].pack == "_wip" && r.pack != "_wip") it->second = i;
        }
    }

    Status writeCache (const Index& idx) const
    {
        auto o = util::newObject();
        util::set (o, "schema", "apc-index/1.0");
        util::set (o, "generated", util::js (util::nowIsoUtc()));
        util::set (o, "root", "presets");
        util::set (o, "note", "Disposable accelerator. Delete to rebuild. Ratings/favorites come from user-data.json keyed by asset id.");
        auto rows = util::newArray();
        for (const auto& r : idx.rows) util::push (rows, rowToVar (r));
        util::set (o, "rows", rows);
        auto errs = util::newArray();
        for (const auto& e : idx.errors) { auto x = util::newObject(); util::set (x, "path", util::js (e.path)); util::set (x, "message", util::js (e.message)); util::push (errs, x); }
        util::set (o, "errors", errs);
        auto warns = util::newArray();
        for (const auto& e : idx.warnings) { auto x = util::newObject(); util::set (x, "code", util::js (e.code)); util::set (x, "message", util::js (e.message)); util::push (warns, x); }
        util::set (o, "warnings", warns);
        auto st = util::newObject();
        util::set (st, "scanned", idx.stats.scanned); util::set (st, "reused", idx.stats.reused); util::set (st, "reparsed", idx.stats.reparsed);
        util::set (st, "removed", idx.stats.removed); util::set (st, "orphan_user_data", idx.stats.orphanUserData);
        util::set (o, "stats", st);
        const auto w = apc::atomicWrite (cfg_.layout.indexFile, util::toJsonText (o) + "\n", cfg_.atomic);
        return w.ok ? Status::success() : Status::fail ("io", w.error, util::pathToUtf8 (w.path));
    }

    // Update/insert the row of ONE file after a save/import (keeps the cache in step without a full scan).
    void indexOneFile (const fsys::path& f, std::vector<std::string>& warnings)
    {
        std::string raw, err;
        juce::var doc;
        if (! apc::readFileToString (f, raw).ok || ! util::parseJson (raw, doc, err) || ! isAssetDoc (doc)) { warnings.push_back ("The saved file could not be re-indexed; rescan to refresh the list."); return; }
        IndexRow row;
        fillRowFromDoc (row, doc);
        row.path = util::posixRel (cfg_.layout.presets, f);
        row.pack = util::pathToUtf8 (fsys::path (row.path).begin()->filename());
        const auto jf = util::fileOf (f);
        row.mtime = jf.getLastModificationTime().toMilliseconds();
        row.size = jf.getSize();
        row.hash = apc::sha256Hex (raw);
        auto next = std::make_shared<Index> (*index());
        bool replaced = false;
        for (auto& r : next->rows) if (r.path == row.path) { r = row; replaced = true; }
        if (! replaced) next->rows.push_back (row);
        std::sort (next->rows.begin(), next->rows.end(), [] (const IndexRow& a, const IndexRow& b) { return a.path < b.path; });
        next->byId.clear();
        next->warnings.clear();
        finishIndex (*next);
        const std::string stamp = computeTreeStamp();
        {
            std::lock_guard<std::mutex> g (indexMutex_);
            index_ = next;
            treeStamp_ = stamp;
            missingCache_.clear();
        }
        const auto w = writeCache (*next);
        if (! w.ok) warnings.push_back (w.error.message);
        fire (StateEvent::Kind::Index);
    }

    // Cheap change detector: number of entries + newest mtime of the presets folder and its first two levels.
    std::string computeTreeStamp() const
    {
        std::int64_t newest = 0, count = 0;
        std::error_code ec;
        const std::function<void (const fsys::path&, int)> walk = [&] (const fsys::path& d, int depth)
        {
            for (fsys::directory_iterator it (d, ec), end; ! ec && it != end; it.increment (ec))
            {
                ++count;
                const auto jf = util::fileOf (it->path());
                newest = std::max<std::int64_t> (newest, jf.getLastModificationTime().toMilliseconds());
                if (depth < 3 && it->is_directory (ec)) walk (it->path(), depth + 1);
            }
        };
        if (fsys::is_directory (cfg_.layout.presets, ec)) walk (cfg_.layout.presets, 0);
        return std::to_string (count) + ":" + std::to_string (newest);
    }

    // ---- user data -----------------------------------------------------------------------------------
    struct DirLock
    {
        fsys::path path;
        bool held = false;
        DirLock (const fsys::path& p, int timeoutMs = 5000, int staleMs = 3000) : path (p)
        {
            std::error_code ec;
            if (path.has_parent_path()) fsys::create_directories (path.parent_path(), ec);
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds (timeoutMs);
            for (;;)
            {
                ec.clear();
                if (fsys::create_directory (path, ec) && ! ec) { held = true; return; }
                if (! ec && fsys::exists (path, ec))
                {
                    const auto mt = fsys::last_write_time (path, ec);
                    if (! ec && fsys::file_time_type::clock::now() - mt > std::chrono::milliseconds (staleMs)) { fsys::remove (path, ec); continue; }
                }
                if (std::chrono::steady_clock::now() >= deadline) return;
                std::this_thread::sleep_for (std::chrono::milliseconds (3));
            }
        }
        ~DirLock() { if (held) { std::error_code ec; fsys::remove (path, ec); } }
        DirLock (const DirLock&) = delete;
        DirLock& operator= (const DirLock&) = delete;
    };

    static UserEntry entryFromVar (const juce::var& e)
    {
        UserEntry u;
        const auto rt = util::get (e, "rating");
        if (util::isNumber (rt)) u.rating = std::max (0, std::min (5, (int) std::lround ((double) rt)));
        u.favorite = util::getBool (e, "favorite", false);
        const auto us = util::get (e, "uses");
        if (util::isNumber (us)) { u.hasUses = true; u.uses = (int) (double) us; }
        u.lastLoaded = (std::int64_t) util::getNum (e, "last_loaded", 0);
        return u;
    }

    void refreshUserData (bool force)
    {
        std::string stamp;
        {
            std::error_code ec;
            const auto sz = fsys::exists (cfg_.layout.userDataFile, ec) ? std::to_string (util::fileOf (cfg_.layout.userDataFile).getSize()) + ":" + std::to_string (util::fileOf (cfg_.layout.userDataFile).getLastModificationTime().toMilliseconds()) : std::string ("none");
            stamp = sz;
        }
        std::lock_guard<std::mutex> g (userMutex_);
        if (! force && stamp == userStamp_) return;
        userStamp_ = stamp;
        user_.clear();
        std::string text, err;
        juce::var d;
        std::error_code ec;
        if (! fsys::exists (cfg_.layout.userDataFile, ec)) return;
        if (! apc::readFileToString (cfg_.layout.userDataFile, text).ok || ! util::parseJson (text, d, err))
        {
            warnings_.push_back ("user-data.json could not be read (" + err + "). Ratings and favorites are not shown until it is fixed; the file was left untouched.");
            return;
        }
        if (auto* a = util::get (d, "assets").getDynamicObject())
            for (const auto& p : a->getProperties()) user_[util::ss (p.name.toString())] = entryFromVar (p.value);
    }

    Result<UserEntry> updateUser (const std::string& id, const std::function<void (juce::var&)>& mutate)
    {
        if (! cfg_.layout.valid) return Result<UserEntry>::fail ("no_layout", "The preset folder could not be determined: " + cfg_.layout.error);
        if (id.empty()) return Result<UserEntry>::fail ("invalid", "Missing preset id.");
        {
            fsys::path lock = cfg_.layout.userDataFile;
            lock += ".lock";
            DirLock l (lock);
            if (! l.held) return Result<UserEntry>::fail ("busy", "user-data.json is locked by another process; your change was not saved.", util::pathToUtf8 (cfg_.layout.userDataFile));
            std::string text, err;
            juce::var d;
            std::error_code ec;
            if (fsys::exists (cfg_.layout.userDataFile, ec))
            {
                const bool okRead = apc::readFileToString (cfg_.layout.userDataFile, text).ok;
                if (! okRead) return Result<UserEntry>::fail ("io", "Cannot read user-data.json.", util::pathToUtf8 (cfg_.layout.userDataFile));
                if (! util::parseJson (text, d, err) || ! util::isObject (d))
                {
                    // quarantine, never delete (ratings must survive)
                    fsys::path q = cfg_.layout.userDataFile;
                    q += ".corrupt-" + std::to_string ((long long) std::time (nullptr));
                    fsys::rename (cfg_.layout.userDataFile, q, ec);
                    std::lock_guard<std::mutex> g (userMutex_);
                    warnings_.push_back ("user-data.json was damaged (" + err + "); a copy was kept as " + util::pathToUtf8 (q.filename()) + " and a new file was started.");
                    d = juce::var();
                }
            }
            if (! util::isObject (d)) { d = util::newObject(); }
            util::set (d, "schema", "apc-user-data/1.0");
            auto assets = util::get (d, "assets");
            if (! util::isObject (assets)) { assets = util::newObject(); util::set (d, "assets", assets); }
            auto entry = util::get (assets, id.c_str());
            if (! util::isObject (entry)) { entry = util::newObject(); util::set (assets, id.c_str(), entry); }
            mutate (entry);
            const auto w = apc::atomicWrite (cfg_.layout.userDataFile, util::toJsonText (d) + "\n", cfg_.atomic);
            if (! w.ok) return Result<UserEntry>::fail ("io", w.error, util::pathToUtf8 (w.path));
        }
        refreshUserData (true);
        fire (StateEvent::Kind::UserData);
        return Result<UserEntry>::success (userEntry (id));
    }

    void bumpUses (const std::string& id)
    {
        const auto now = (juce::int64) juce::Time::currentTimeMillis();
        auto r = updateUser (id, [now] (juce::var& e)
        {
            const auto cur = util::get (e, "uses");
            util::set (e, "uses", (util::isNumber (cur) ? (int) (double) cur : 0) + 1);
            util::set (e, "last_loaded", now);
        });
        if (! r.ok) { std::lock_guard<std::mutex> g (userMutex_); warnings_.push_back (r.error.message); }
    }

    // ---- references ----------------------------------------------------------------------------------
    static bool insidePack (const fsys::path& pack, const fsys::path& cand)
    {
        const auto rel = cand.lexically_normal().lexically_relative (pack.lexically_normal());
        if (rel.empty()) return false;
        const auto first = rel.begin()->string();
        return first != ".." && ! rel.is_absolute();
    }
    static bool existsExactCase (const fsys::path& abs)
    {
        std::error_code ec;
        const auto norm = abs.lexically_normal();
        fsys::path cur = norm.root_path();
        for (const auto& part : norm.relative_path())
        {
            if (part.empty()) continue;
            bool hit = false;
            for (fsys::directory_iterator it (cur, ec), end; ! ec && it != end; it.increment (ec))
                if (it->path().filename() == part) { hit = true; break; }
            if (! hit) return false;
            cur /= part;
        }
        return true;
    }

    void resolveRefsRec (const juce::var& doc, const fsys::path& fileAbs, const fsys::path& packDir, const std::string& pack,
                         int depth, std::vector<RefInfo>& out, std::set<std::string>& visiting) const
    {
        if (depth > 6) return;
        const std::string me = util::pathToUtf8 (fileAbs.lexically_normal());
        if (! visiting.insert (me).second) return;   // cycle
        struct Item { std::string where, kind; juce::var obj; };
        std::vector<Item> items;
        const std::string kind = util::getStr (doc, "kind");
        auto addList = [&] (const char* key, const char* expect)
        {
            if (const auto* arr = util::get (doc, key).getArray())
                for (int i = 0; i < arr->size(); ++i) if (util::isObject ((*arr)[i])) items.push_back ({ std::string (key) + "[" + std::to_string (i) + "]", expect, (*arr)[i] });
        };
        if (kind == "kit") addList ("slots", "sound");
        if (kind == "patch") { addList ("kits", "kit"); addList ("sequences", "sequence"); }
        const auto embedded = util::get (doc, "embedded");
        const auto idx = index();

        for (const auto& it : items)
        {
            RefInfo ri;
            ri.where = it.where; ri.kind = it.kind; ri.depth = depth;
            ri.ref = util::getStr (it.obj, "ref", util::getStr (it.obj, "sound_ref"));
            ri.id = util::getStr (it.obj, "id", util::getStr (it.obj, "sound_id"));
            if (ri.ref.empty() && ri.id.empty()) { ri.status = "empty"; out.push_back (ri); continue; }
            ri.name = ri.ref.empty() ? ri.id : util::pathToUtf8 (util::pathOf (ri.ref).stem());
            fsys::path found;
            std::string status;
            if (! ri.ref.empty())
            {
                std::string norm = ri.ref;
                std::replace (norm.begin(), norm.end(), '\\', '/');
                if (norm != ri.ref) ri.problem = "reference uses backslashes; use \"/\"";
                const bool absolute = fsys::path (ri.ref).is_absolute() || (ri.ref.size() > 1 && ri.ref[1] == ':' && std::isalpha ((unsigned char) ri.ref[0])) || norm.front() == '/';
                if (absolute) status = "absolute";
                else
                {
                    const fsys::path cands[2] = { fileAbs.parent_path() / util::pathOf (norm), packDir / util::pathOf (norm) };
                    std::vector<fsys::path> inside;
                    for (const auto& c : cands) if (insidePack (packDir, c)) inside.push_back (c);
                    if (inside.empty()) status = "escape";
                    for (const auto& c : inside)
                    {
                        std::error_code ec;
                        if (fsys::is_regular_file (c, ec))
                        {
                            found = c.lexically_normal();
                            status = existsExactCase (c) ? "found" : "case";
                            break;
                        }
                    }
                }
            }
            if (status.empty() && ! ri.id.empty())
            {
                if (const IndexRow* row = idx->find (ri.id))
                {
                    found = (cfg_.layout.presets / util::pathOf (row->path)).lexically_normal();
                    status = "rebound";
                    ri.name = row->name;
                }
                else if (util::has (embedded, ri.id.c_str())) status = "embedded";
            }
            if (status.empty()) status = "missing";
            ri.status = status;
            if (! found.empty()) ri.file = util::pathToUtf8 (found);
            ri.usable = (status == "found" || status == "rebound" || status == "embedded");
            if (ri.usable && ! found.empty())
            {
                std::string text, err;
                juce::var target;
                if (apc::readFileToString (found, text).ok && util::parseJson (text, target, err) && isAssetDoc (target))
                {
                    ri.name = util::getStr (target, "name", ri.name);
                    if (util::getStr (target, "kind") != it.kind) { ri.status = "wrong-kind"; ri.usable = false; ri.problem = "expected a " + it.kind + ", found a " + util::getStr (target, "kind"); }
                    else
                    {
                        const auto declared = ri.id;
                        if (! declared.empty() && util::getStr (target, "id") != declared && ri.problem.empty()) ri.problem = "file id differs from the declared id";
                        out.push_back (ri);
                        resolveRefsRec (target, found, packDir, pack, depth + 1, out, visiting);
                        continue;
                    }
                }
            }
            if (! ri.usable) ri.placeholder = "[Missing: " + ri.name + "]";
            out.push_back (ri);
        }
        visiting.erase (me);
    }

    // On save: references that were only resolved by id get their path rewritten (file-relative).
    void rewriteReboundRefs (juce::var& doc, const fsys::path& target, const std::string& pack)
    {
        const auto refs = resolveReferences (doc, target, pack);
        const auto packDir = cfg_.layout.packDir (pack);
        for (const auto& ri : refs)
        {
            if (ri.depth != 0 || ri.status != "rebound" || ri.file.empty()) continue;
            if (! insidePack (packDir, fsys::path (ri.file))) continue;   // a path that leaves the pack would lint as ref-escape: keep the id link only
            const auto open = ri.where.find ('[');
            const std::string key = ri.where.substr (0, open);
            const int i = std::atoi (ri.where.c_str() + open + 1);
            auto* arr = util::get (doc, key.c_str()).getArray();
            if (arr == nullptr || i >= arr->size()) continue;
            auto item = (*arr)[i];
            const auto rel = fsys::path (ri.file).lexically_relative (target.parent_path().lexically_normal());
            if (rel.empty()) continue;
            const std::string relUtf8 = util::genericUtf8 (rel);
            util::set (item, util::has (item, "sound_ref") ? "sound_ref" : "ref", util::js (relUtf8));
        }
    }

    std::string findSampleByHash (const std::string& hash, std::int64_t bytes) const
    {
        std::error_code ec;
        for (const auto& packDir : findPacks (cfg_.layout.presets))
        {
            const fsys::path sd = packDir / "samples";
            if (! fsys::is_directory (sd, ec)) continue;
            std::vector<fsys::path> files;
            walkFiles (sd, files);   // samples/ is not an ignored dir below it
            for (const auto& f : files)
            {
                if (bytes >= 0 && (std::int64_t) fsys::file_size (f, ec) != bytes) continue;
                std::string hex, err; std::int64_t sz = 0;
                if (apc::sysutil::sha256File (f, hex, sz, err) && hex == hash) return util::pathToUtf8 (f);
            }
        }
        return {};
    }

    // ---- state helpers -------------------------------------------------------------------------------
    static apc::Value valueFromVar (const juce::var& v, bool& ok)
    {
        ok = true;
        if (v.isBool()) return (bool) v;
        if (util::isNumber (v)) return (double) v;
        if (v.isString()) return std::string (util::ss (v.toString()));
        ok = false;
        return 0.0;
    }
    juce::var valueToVar (const apc::Value& v, const apc::ParamDecl& d) const
    {
        if (const auto* b = std::get_if<bool> (&v)) return juce::var (*b);
        if (const auto* s = std::get_if<std::string> (&v)) return juce::var (util::js (*s));
        const double x = std::get<double> (v);
        if (d.kind == apc::ParamKind::Int) return juce::var ((juce::int64) std::llround (x));
        return juce::var (util::roundSignificant (x, 9));
    }
    std::map<std::string, apc::Value> decodeParams (const juce::var& p) const
    {
        std::map<std::string, apc::Value> out;
        if (auto* d = p.getDynamicObject())
            for (const auto& kv : d->getProperties())
            {
                bool ok = false;
                auto v = valueFromVar (kv.value, ok);
                if (ok) out[util::ss (kv.name.toString())] = std::move (v);
            }
        return out;
    }
    // params object for a document: declared params in declaration order from the LIVE snapshot (explicit full
    // snapshot, not "whatever was touched"), then keys of the previous document that this build does not declare.
    juce::var paramsVarFromLive (const juce::var& previous) const
    {
        const auto snap = live_.snapshotParams();
        auto out = util::newObject();
        std::set<std::string> declared;
        for (const auto& d : live_.decls)
        {
            declared.insert (d.id);
            const auto it = snap.find (d.id);
            util::set (out, d.id.c_str(), valueToVar (it != snap.end() ? it->second : d.defaultValue, d));
        }
        if (auto* pd = previous.getDynamicObject())
            for (const auto& kv : pd->getProperties())
            {
                const auto k = util::ss (kv.name.toString());
                if (! declared.count (k)) util::set (out, k.c_str(), kv.value);
            }
        return out;
    }

    // Defaults-first apply of a document's params + extras. Never throws; reports everything.
    void applyDocument (const juce::var& doc, const std::vector<RefInfo>& refs, LoadReport& rep)
    {
        auto refsVar = util::newArray();
        for (const auto& r : refs) util::push (refsVar, r.toVar());
        applying_ = true;
        if (live_.beginBatch) live_.beginBatch();
        const auto stored = decodeParams (util::get (doc, "params"));
        const auto report = apc::applyDefaultsFirst (live_.decls, stored, [this] (const apc::ParamDecl& d, const apc::Value& v) { live_.setParam (d, v); });
        if (live_.applyExtras) live_.applyExtras (doc, refsVar);
        if (live_.endBatch) live_.endBatch();
        applying_ = false;
        rep.applied = report.applied; rep.defaulted = report.defaulted; rep.clamped = report.clamped; rep.invalid = report.invalid;
        for (const auto& kv : report.unknown) rep.unknown.push_back (kv.first);
        rep.refs = refs;
    }

    Result<LoadReport> loadFile (const fsys::path& file, const IndexRow& row)
    {
        std::string text, err;
        if (const auto r = apc::readFileToString (file, text); ! r.ok) return Result<LoadReport>::fail ("io", r.error, util::pathToUtf8 (file));
        juce::var doc;
        if (! util::parseJson (text, doc, err)) return Result<LoadReport>::fail ("bad_json", "The preset file is damaged (" + err + "): " + util::pathToUtf8 (file), util::pathToUtf8 (file));
        if (! isAssetDoc (doc)) return Result<LoadReport>::fail ("bad_schema", "Not an apc-preset asset (missing schema/id): " + util::pathToUtf8 (file), util::pathToUtf8 (file));
        if (majorOf (util::getStr (doc, "schema")) > 1) return Result<LoadReport>::fail ("bad_schema", "This preset was written by a newer version (" + util::getStr (doc, "schema") + "): " + util::pathToUtf8 (file), util::pathToUtf8 (file));
        LoadReport rep;
        const auto refs = resolveReferences (doc, file, row.pack);
        applyDocument (doc, refs, rep);
        for (const auto& r : refs) if (! r.usable) rep.warnings.push_back (r.placeholder.empty() ? r.where + ": " + r.status : r.placeholder);
        for (const auto& kv : rep.invalid) rep.warnings.push_back (kv.first + ": " + kv.second);

        cur_ = Current {};
        cur_.id = util::getStr (doc, "id");
        cur_.name = util::getStr (doc, "name");
        cur_.pack = row.pack;
        cur_.kind = util::getStr (doc, "kind");
        cur_.path = util::pathToUtf8 (file);
        cur_.hasFile = true;
        cur_.readOnly = isPackReadOnly (row.pack);
        for (const auto& r : refs) if (! r.usable && r.status != "empty") cur_.missing.push_back (r.name);
        cur_.doc = doc;
        rep.id = cur_.id; rep.name = cur_.name; rep.pack = cur_.pack; rep.kind = cur_.kind; rep.path = cur_.path; rep.readOnly = cur_.readOnly;
        rebaseline();
        slot_[active_] = captureSlot();
        ++generation_;
        fire (StateEvent::Kind::Preset);
        return Result<LoadReport>::success (rep);
    }

    Slot captureSlot() const
    {
        Slot s;
        s.valid = true;
        s.params = live_.snapshotParams();
        s.extras = live_.snapshotExtras ? live_.snapshotExtras() : juce::var();
        return s;
    }

    void applySlot (const Slot& s)
    {
        applying_ = true;
        if (live_.beginBatch) live_.beginBatch();
        for (const auto& d : live_.decls)
        {
            const auto it = s.params.find (d.id);
            live_.setParam (d, it != s.params.end() ? it->second : d.defaultValue);
        }
        if (live_.applyExtras) live_.applyExtras (util::isObject (s.extras) ? s.extras : util::newObject(), util::newArray());
        if (live_.endBatch) live_.endBatch();
        applying_ = false;
    }

    void rebaseline()
    {
        baselineParams_ = live_.snapshotParams();
        baselineExtras_ = live_.snapshotExtras ? util::toJsonText (live_.snapshotExtras(), true) : std::string();
        baselineStale_ = false;
        dirty_ = false;
    }

    static bool sameValue (const apc::Value& a, const apc::Value& b)
    {
        if (a.index() != b.index()) return false;
        if (const auto* x = std::get_if<double> (&a)) { const double y = std::get<double> (b); return std::abs (*x - y) <= 1e-9 * std::max (1.0, std::abs (y)); }
        return a == b;
    }
    bool sameAsBaseline() const
    {
        const auto now = live_.snapshotParams();
        if (now.size() != baselineParams_.size()) return false;
        for (const auto& kv : now)
        {
            const auto it = baselineParams_.find (kv.first);
            if (it == baselineParams_.end() || ! sameValue (kv.second, it->second)) return false;
        }
        if (live_.snapshotExtras && util::toJsonText (live_.snapshotExtras(), true) != baselineExtras_) return false;
        return true;
    }

    void ensurePackManifest (const std::string& pack, std::vector<std::string>& warnings)
    {
        const auto mf = cfg_.layout.manifestFile (pack);
        std::error_code ec;
        if (fsys::exists (mf, ec)) return;
        auto m = util::newObject();
        util::set (m, "schema", "apc-pack/1.0");
        util::set (m, "id", util::js ("pack_" + util::newUuid()));
        util::set (m, "name", util::js (pack));
        util::set (m, "author", "");
        util::set (m, "version", "1.0.0");
        util::set (m, "license", pack == cfg_.userPack ? "user" : "unspecified");
        util::set (m, "plugin", util::js (cfg_.pluginName));
        util::set (m, "app_version_min", util::js (cfg_.appVersion));
        util::set (m, "layout", util::js (cfg_.flat ? "flat" : "typed"));
        const auto w = apc::atomicWrite (mf, util::toJsonText (m) + "\n", cfg_.atomic);
        if (! w.ok) warnings.push_back ("pack.json could not be created: " + w.error);
    }

    // ---- zip -----------------------------------------------------------------------------------------
    static bool safeEntryName (const std::string& name, std::string& cleaned)
    {
        cleaned = name;
        std::replace (cleaned.begin(), cleaned.end(), '\\', '/');
        if (cleaned.empty() || cleaned.front() == '/' || cleaned.find (':') != std::string::npos) return false;
        for (unsigned char c : cleaned) if (c < 0x20) return false;
        std::size_t start = 0;
        while (start <= cleaned.size())
        {
            auto end = cleaned.find ('/', start);
            if (end == std::string::npos) end = cleaned.size();
            const auto seg = cleaned.substr (start, end - start);
            if (seg == ".." || seg == "." || (seg.empty() && end != cleaned.size())) return false;
            start = end + 1;
        }
        return true;
    }

    Status importZip (const std::string& bytes, const std::string& fallbackName, ImportReport& rep)
    {
        return importZipInto (bytes, fallbackName, rep, false);
    }

    Status importZipInto (const std::string& bytes, const std::string& fallbackName, ImportReport& rep, bool factoryRestore)
    {
        juce::MemoryInputStream mis (bytes.data(), bytes.size(), false);
        juce::ZipFile zip (mis);
        const int n = zip.getNumEntries();
        if (n <= 0) return Status::fail ("bad_pack", "The archive is empty or not a valid zip file.");
        // pass 1: validate every name + size BEFORE writing anything
        std::int64_t total = 0;
        std::vector<std::pair<int, std::string>> entries;
        int manifestIdx = -1;
        for (int i = 0; i < n; ++i)
        {
            const auto* e = zip.getEntry (i);
            std::string name = util::ss (e->filename), cleaned;
            if (name.empty() || name.back() == '/' || name.back() == '\\') continue;   // directory entry
            if (! safeEntryName (name, cleaned)) return Status::fail ("unsafe_path", "The archive contains an unsafe path (\"" + name + "\"); nothing was installed.");
            total += (std::int64_t) e->uncompressedSize;
            if (total > cfg_.maxImportBytes || (std::int64_t) e->uncompressedSize > cfg_.maxImportBytes) return Status::fail ("too_large", "The archive is too large to install.");
            if (cleaned == "pack.json") manifestIdx = i;
            entries.emplace_back (i, cleaned);
        }
        juce::var manifest;
        if (manifestIdx >= 0)
        {
            std::unique_ptr<juce::InputStream> s (zip.createStreamForEntry (manifestIdx));
            std::string err;
            if (s == nullptr || ! util::parseJson (util::ss (s->readEntireStreamAsString()), manifest, err))
                return Status::fail ("bad_pack", "pack.json inside the archive is not valid JSON.");
        }
        std::string packName = util::getStr (manifest, "name", fallbackName);
        const std::string packId = util::getStr (manifest, "id");
        const std::string packVersion = util::getStr (manifest, "version");
        if (packName.empty()) packName = "Imported";
        if (factoryRestore && ! packName.empty() && manifestIdx < 0) return Status::fail ("bad_pack", "The factory archive has no pack.json.");
        fsys::path dest = cfg_.layout.packDir (packName);
        std::error_code ec;
        bool update = false;
        if (fsys::exists (dest, ec))
        {
            std::string t, err;
            juce::var old;
            const bool sameId = ! packId.empty() && apc::readFileToString (dest / "pack.json", t).ok && util::parseJson (t, old, err) && util::getStr (old, "id") == packId;
            if (sameId || factoryRestore)
            {
                if (! factoryRestore && util::getStr (old, "version") == packVersion) { rep.skipped = "already-installed"; rep.packFolder = packName; return Status::success(); }
                update = true;   // a pack is the unit of update: only ITS files are overwritten
            }
            else dest = apc::uniquePath (cfg_.layout.presets, apc::sanitizeFilename (packName), "", 2);
        }
        rep.packFolder = util::pathToUtf8 (dest.filename());
        for (const auto& en : entries)
        {
            std::unique_ptr<juce::InputStream> s (zip.createStreamForEntry (en.first));
            if (s == nullptr) return Status::fail ("bad_pack", "Cannot read \"" + en.second + "\" from the archive.");
            juce::MemoryBlock mb;
            s->readIntoMemoryBlock (mb);
            const fsys::path out = dest / util::pathOf (en.second);
            if (! insidePack (dest, out)) return Status::fail ("unsafe_path", "The archive contains an unsafe path (\"" + en.second + "\").");
            const auto w = apc::atomicWrite (out, std::string_view (static_cast<const char*> (mb.getData()), mb.getSize()), cfg_.atomic);
            if (! w.ok) return Status::fail ("io", w.error, util::pathToUtf8 (w.path));
        }
        (void) update;
        return Status::success();
    }

    Status copySeed (const fsys::path& seed, const fsys::path& presets)
    {
        std::error_code ec;
        for (const auto& packEntry : sortedEntries (seed))
        {
            if (! packEntry.is_directory (ec)) continue;
            const std::string pn = util::pathToUtf8 (packEntry.path().filename());
            if (pn == "User" || pn == "_wip") continue;   // never touch user content
            std::vector<fsys::path> files;
            std::function<void (const fsys::path&)> rec = [&] (const fsys::path& d)
            {
                for (const auto& e : sortedEntries (d))
                {
                    if (e.is_directory (ec)) rec (e.path());
                    else if (e.is_regular_file (ec)) files.push_back (e.path());
                }
            };
            rec (packEntry.path());
            for (const auto& f : files)
            {
                std::string bytes;
                const auto r = apc::readFileToString (f, bytes);
                if (! r.ok) return Status::fail ("io", r.error, util::pathToUtf8 (f));
                const auto out = presets / pn / f.lexically_relative (packEntry.path());
                const auto w = apc::atomicWrite (out, bytes, cfg_.atomic);
                if (! w.ok) return Status::fail ("io", w.error, util::pathToUtf8 (w.path));
            }
        }
        return Status::success();
    }

    // ---- members -------------------------------------------------------------------------------------
    StoreConfig cfg_;
    LiveState live_;
    std::string loadBehavior_ = "confirm-if-dirty";

    mutable std::mutex indexMutex_;
    std::shared_ptr<Index> index_;
    std::string treeStamp_, builtAt_;
    mutable std::map<std::string, std::vector<std::string>> missingCache_;   // row path -> unresolved reference names (kit/patch rows)
    std::mutex scanMutex_;

    mutable std::mutex userMutex_;
    std::map<std::string, UserEntry> user_;
    std::string userStamp_ = "unset";
    std::vector<std::string> warnings_;

    // state (message thread)
    Current cur_;
    std::map<std::string, apc::Value> baselineParams_;
    std::string baselineExtras_;
    std::atomic<bool> dirty_ { false };
    bool baselineStale_ = false;
    std::atomic<bool> scanned_ { false };
    std::atomic<bool> applying_ { false };
    std::atomic<std::uint64_t> generation_ { 0 };
    Slot slot_[2];
    int active_ = 0;

    std::mutex listenerMutex_;
    std::vector<std::pair<int, std::function<void (const StateEvent&)>>> listeners_;
    int nextListener_ = 0;
};

} // namespace apc::presets
