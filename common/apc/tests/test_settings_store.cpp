// test_settings_store.cpp - ApcSettingsStore.h: persistence, unknown-key preservation, per-key
// last-writer-wins between instances, corruption / newer-schema handling, lock behaviour, visible
// write failures, claimTimeSlot, engine chunk-vs-machine scope.
#include "ApcSettingsStore.h"

#include <cstdio>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECK_W(c, what) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s [%s]\n", __FILE__, __LINE__, #c, std::string(what).c_str()); } } while (0)

namespace fs = std::filesystem;
using namespace apc;

static fs::path tempDir(const char* tag) {
    static int n = 0;
    fs::path p = fs::temp_directory_path() / ("apc_test_settings_" + std::string(tag) + "_" + std::to_string(sysutil::currentProcessId()) + "_" + std::to_string(n++));
    fs::remove_all(p); fs::create_directories(p);
    return p;
}
static std::string slurp(const fs::path& p) { std::string s, e; sysutil::readWholeFile(p, s, e); return s; }
static void spit(const fs::path& p, const std::string& s) { fs::create_directories(p.parent_path()); std::ofstream f(p, std::ios::binary | std::ios::trunc); f << s; }
static SettingsStore::Options opts(const fs::path& file) { SettingsStore::Options o; o.filePath = file; return o; }
static int countMatching(const fs::path& dir, const std::string& needle) {
    int n = 0;
    for (const auto& e : fs::directory_iterator(dir)) if (e.path().filename().string().find(needle) != std::string::npos) ++n;
    return n;
}

static void testBasics() {
    const fs::path dir = tempDir("basic");
    const fs::path file = dir / "Mfr" / "Plug" / "settings.json";
    SettingsStore s(opts(file));
    std::string err;
    CHECK(s.load(err) && err.empty());                                  // missing file is fine
    CHECK(!fs::exists(file));                                           // load never creates
    CHECK(s.getBool("ui.tooltips", true) && s.getInt("engine.oversampling", 2) == 2 && s.getString("ui.theme", "follow-os") == "follow-os");
    CHECK(!s.has("ui.theme"));

    CHECK(s.set("ui.theme", "night", err));
    CHECK(s.set("ui.scale", 1.25, err));
    CHECK(s.set("ui.tooltips", false, err));
    CHECK(s.set("engine.oversampling", 4, err));
    CHECK(s.set("presets.recents", [] { JsonValue a = JsonValue::array(); a.push("pat_0c8f"); return a; }(), err));
    CHECK(fs::exists(file));

    SettingsStore t(opts(file));                                        // a fresh instance (new process) sees it
    CHECK(t.load(err));
    CHECK(t.getString("ui.theme", "") == "night" && t.getDouble("ui.scale", 0) == 1.25 && !t.getBool("ui.tooltips", true));
    CHECK(t.getInt("engine.oversampling", 0) == 4 && t.get("presets.recents").size() == 1);
    CHECK(t.getString("schema", "") == "apc-settings/1.0");
    const std::string text = slurp(file);
    CHECK(text.find("\"schema\": \"apc-settings/1.0\"") != std::string::npos);
    CHECK(text.find("1.25") != std::string::npos);
    CHECK(t.snapshot().find("ui")->isObject());

    CHECK(t.set("ui.theme", "day", err) && s.refreshIfChanged() && s.getString("ui.theme", "") == "day");   // other instance picks it up
    CHECK(!s.refreshIfChanged());                                       // nothing changed since

    CHECK(t.erase("ui.scale", err) && !t.has("ui.scale") && t.has("ui.theme"));
    CHECK(t.setMany({ { "ui.wheel_target", "panel" }, { "ui.double_click", "value_entry" } }, err));
    s.load(err);
    CHECK(s.getString("ui.wheel_target", "") == "panel" && s.getString("ui.double_click", "") == "value_entry" && !s.has("ui.scale"));

    CHECK(!t.set("a..b", 1, err));                                      // bad key is refused, visibly
    CHECK(countMatching(file.parent_path(), ".tmp.") == 0 && countMatching(file.parent_path(), ".lock") == 0);   // nothing left behind
    std::error_code ec; fs::remove_all(dir, ec);
}

static void testUnknownKeysAndBom() {
    const fs::path dir = tempDir("unknown");
    const fs::path file = dir / "settings.json";
    // written by "a newer minor version" and by PowerShell (BOM)
    spit(file, "\xEF\xBB\xBF{\n  \"schema\": \"apc-settings/1.0\",\n  \"x_future\": {\"deep\": [1, 2, {\"z\": null}], \"flag\": true},\n"
               "  \"ui\": {\"theme\": \"night\", \"future_key\": \"keep me\", \"ratio\": 0.5},\n  \"license\": {\"activated\": true}\n}\n");
    SettingsStore s(opts(file));
    std::string err;
    CHECK(s.load(err) && s.getString("ui.theme", "") == "night" && s.getBool("license.activated", false));
    CHECK(s.set("ui.theme", "day", err) && s.set("engine.max_voices", 16, err));
    SettingsStore t(opts(file)); t.load(err);
    CHECK(t.getString("ui.theme", "") == "day");
    CHECK(t.getString("ui.future_key", "") == "keep me" && t.getDouble("ui.ratio", 0) == 0.5);
    CHECK(t.getBool("x_future.flag", false));
    const JsonValue snap = t.snapshot();
    const JsonValue* deep = snap.getPath("x_future.deep");
    CHECK(deep && deep->size() == 3 && deep->at(2).find("z") && deep->at(2).find("z")->isNull());
    CHECK(t.getBool("license.activated", false) && t.getInt("engine.max_voices", 0) == 16);
    // missing "schema" gets added on first write
    spit(file, "{\"ui\":{\"theme\":\"night\"}}");
    CHECK(s.set("ui.tooltips", true, err));
    SettingsStore u(opts(file)); u.load(err);
    CHECK(u.getString("schema", "") == "apc-settings/1.0" && u.getString("ui.theme", "") == "night");
    std::error_code ec; fs::remove_all(dir, ec);
}

static void testLastWriterWinsPerKey() {
    const fs::path dir = tempDir("lww");
    const fs::path file = dir / "settings.json";
    SettingsStore a(opts(file)), b(opts(file));
    std::string err;
    a.load(err); b.load(err);                                           // both start from "nothing"
    CHECK(a.set("ui.theme", "night", err));
    CHECK(b.set("ui.tooltips", false, err));                            // b's cache is stale: must NOT erase a's key
    SettingsStore c(opts(file)); c.load(err);
    CHECK(c.getString("ui.theme", "") == "night" && !c.getBool("ui.tooltips", true));
    CHECK(b.set("ui.theme", "day", err));                               // same key: last writer wins
    CHECK(a.set("ui.scale", 1.5, err));                                 // a's stale cache still says night; day must survive
    c.load(err);
    CHECK(c.getString("ui.theme", "") == "day" && c.getDouble("ui.scale", 0) == 1.5 && !c.getBool("ui.tooltips", true));
    std::error_code ec; fs::remove_all(dir, ec);
}

static void testCorruptAndNewerSchema() {
    const fs::path dir = tempDir("corrupt");
    const fs::path file = dir / "settings.json";
    spit(file, "{\"ui\": {\"theme\": \"night\"");                       // truncated by a crash of some OTHER tool
    SettingsStore s(opts(file));
    std::string err;
    CHECK(s.load(err));
    CHECK(s.getString("ui.theme", "x") == "x");                         // fresh defaults
    auto w = s.takeWarnings();
    CHECK(w.size() == 1 && w[0].find("damaged") != std::string::npos && w[0].find("settings.json.corrupt-") != std::string::npos);
    CHECK(s.takeWarnings().empty());
    CHECK(countMatching(dir, "settings.json.corrupt-") == 1);           // quarantined, not deleted
    CHECK(!fs::exists(file));
    CHECK(s.set("ui.theme", "day", err));                               // preferences work again
    SettingsStore t(opts(file)); t.load(err); CHECK(t.getString("ui.theme", "") == "day");

    // corrupt discovered at WRITE time (another process broke it after our load)
    spit(file, "not json");
    CHECK(s.set("ui.tooltips", false, err));
    CHECK(!s.takeWarnings().empty() && countMatching(dir, "settings.json.corrupt-") == 2);

    // a document from a NEWER major version: readable, never written, visible error
    const std::string future = "{\"schema\":\"apc-settings/2.0\",\"ui\":{\"theme\":\"night\"},\"new_thing\":{\"a\":1}}";
    spit(file, future);
    SettingsStore f(opts(file));
    CHECK(f.load(err) && f.getString("ui.theme", "") == "night");
    CHECK(!f.set("ui.theme", "day", err) && err.find("newer version") != std::string::npos);
    CHECK(slurp(file) == future);                                       // untouched
    CHECK(countMatching(dir, "settings.json.corrupt-") == 2);           // and not "quarantined" either

    // a JSON value that is not an object counts as corrupt
    spit(file, "[1,2,3]");
    SettingsStore g(opts(file)); CHECK(g.load(err) && !g.takeWarnings().empty());
    std::error_code ec; fs::remove_all(dir, ec);
}

static void testLockBehaviour() {
    const fs::path dir = tempDir("lock");
    const fs::path file = dir / "settings.json";
    fs::path lock = file; lock += ".lock";
    std::string err;
    {   // abandoned lock from a crashed process -> broken after staleLockMs, write succeeds
        fs::create_directories(lock);
        fs::last_write_time(lock, fs::file_time_type::clock::now() - std::chrono::hours(1));
        SettingsStore::Options o = opts(file); o.staleLockMs = 500; o.lockTimeoutMs = 3000;
        SettingsStore s(o);
        CHECK(s.set("ui.theme", "night", err));
        CHECK(!fs::exists(lock));                                       // released afterwards
    }
    {   // a FRESH lock held by someone else: our write fails VISIBLY, file untouched, then works after release
        fs::create_directories(lock);
        SettingsStore::Options o = opts(file); o.staleLockMs = 60000; o.lockTimeoutMs = 150;
        SettingsStore s(o);
        const std::string before = slurp(file);
        CHECK(!s.set("ui.theme", "day", err));
        CHECK(err.find("locked") != std::string::npos && err.find("not saved") != std::string::npos);
        CHECK(slurp(file) == before);
        CHECK(!s.claimTimeSlot("update.last_check_unix", 5, 86400));    // failure -> false + warning
        CHECK(!s.takeWarnings().empty());
        fs::remove(lock);
        CHECK(s.set("ui.theme", "day", err));
    }
    {   // unwritable location: error is returned, not swallowed
        const fs::path blocker = dir / "iamafile";
        spit(blocker, "x");
        SettingsStore::Options o = opts(blocker / "sub" / "settings.json"); o.lockTimeoutMs = 100;
        SettingsStore s(o);
        CHECK(!s.set("ui.theme", "night", err) && !err.empty());
    }
    std::error_code ec; fs::remove_all(dir, ec);
}

static void testClaimTimeSlot() {
    const fs::path dir = tempDir("claim");
    const fs::path file = dir / "settings.json";
    SettingsStore a(opts(file)), b(opts(file));
    const int64_t t0 = 1800000000;
    CHECK(a.claimTimeSlot("update.last_check_unix", t0, 86400));        // first ever: due
    CHECK(!b.claimTimeSlot("update.last_check_unix", t0 + 10, 86400));
    CHECK(!a.claimTimeSlot("update.last_check_unix", t0 + 86399, 86400));
    CHECK(b.claimTimeSlot("update.last_check_unix", t0 + 86400, 86400));   // exactly one interval later
    std::string e2;
    a.load(e2);                                                          // a's cache was stale until reloaded
    CHECK(a.getInt("update.last_check_unix", 0) == t0 + 86400);
    CHECK(a.claimTimeSlot("update.last_check_unix", t0 - 5000, 86400)); // clock moved backwards: due again
    CHECK(a.getInt("update.last_check_unix", 0) == t0 - 5000);
    CHECK(a.claimTimeSlot("other.job", t0, 60) && !a.claimTimeSlot("other.job", t0 + 59, 60) && a.claimTimeSlot("other.job", t0 + 60, 60));
    std::error_code ec; fs::remove_all(dir, ec);
}

static void testEngineScope() {
    const fs::path dir = tempDir("engine");
    SettingsStore s(opts(dir / "settings.json"));
    std::string err;
    const JsonValue builtIn(1);
    CHECK(parseEngineStateScope("chunk") == EngineStateScope::Chunk && parseEngineStateScope("machine") == EngineStateScope::Machine
          && parseEngineStateScope("") == EngineStateScope::Chunk && parseEngineStateScope("garbage") == EngineStateScope::Chunk);

    // nothing in settings.json: built-in default
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Chunk, nullptr, builtIn).asInt() == 1);
    // machine default exists
    CHECK(setEngineMachineDefault(s, "oversampling", 4, err));
    // CHUNK scope: a NEW instance (no chunk value) takes the machine default ...
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Chunk, nullptr, builtIn).asInt() == 4);
    // ... an instance restored from a DAW project keeps ITS value, whatever this machine says
    const JsonValue fromProject(8);
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Chunk, &fromProject, builtIn).asInt() == 8);
    const JsonValue nullChunk;
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Chunk, &nullChunk, builtIn).asInt() == 4);   // null == not stored
    // MACHINE scope: settings.json is authoritative, a chunk value is ignored
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Machine, &fromProject, builtIn).asInt() == 4);
    CHECK(resolveEngineValue(s, "max_voices", EngineStateScope::Machine, &fromProject, JsonValue(16)).asInt() == 16);
    // changing the machine default must NOT change an existing project's value in chunk scope
    CHECK(setEngineMachineDefault(s, "oversampling", 2, err));
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Chunk, &fromProject, builtIn).asInt() == 8);
    CHECK(resolveEngineValue(s, "oversampling", EngineStateScope::Chunk, nullptr, builtIn).asInt() == 2);
    std::error_code ec; fs::remove_all(dir, ec);
}

int main() {
    testBasics();
    testUnknownKeysAndBom();
    testLastWriterWinsPerKey();
    testCorruptAndNewerSchema();
    testLockBehaviour();
    testClaimTimeSlot();
    testEngineScope();
    std::printf("test_settings_store: %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
