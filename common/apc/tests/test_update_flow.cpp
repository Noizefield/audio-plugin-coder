// test_update_flow.cpp - ApcUpdateFlow.h: state transitions, every failure path (no silent failure),
// explicit-download-only, downgrade blocking, cancel/retry, busy handling, golden manifest handed to the
// verifier byte-exact, and the shared once-per-day auto-check slot across two simulated instances backed by
// the real ApcSettingsStore. Usage: test_update_flow <fixtures-dir>
#include "ApcUpdateFlow.h"
#include "ApcSettingsStore.h"

#include <cstdio>
#include <future>
#include <memory>
#include <stdexcept>
#include <map>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECK_W(c, what) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s [%s]\n", __FILE__, __LINE__, #c, std::string(what).c_str()); } } while (0)

namespace fs = std::filesystem;
using namespace apc;

// ----------------------------------------------------------------------------- fakes

struct FakeVerifier : ISignatureVerifier {
    static std::string sign(const std::string& m) { return sha256Raw("fake-a" + m) + sha256Raw("fake-b" + m); }
    bool verify(const std::string& m, const std::string& s) const override { ++calls; lastMessage = m; lastSig = s; return s == sign(m); }
    mutable int calls = 0; mutable std::string lastMessage, lastSig;
};

struct GoldenVerifier : ISignatureVerifier {     // accepts exactly the golden message + signature
    std::string msg, sig; mutable int calls = 0;
    bool verify(const std::string& m, const std::string& s) const override { ++calls; return m == msg && s == sig; }
};

struct FakeClock : IClock {
    int64_t t = 1800000000;
    int64_t nowUnixSeconds() const override { return t; }
};

struct FakeHttp : IHttp {
    std::map<std::string, HttpResult> gets;
    std::map<std::string, std::string> files;
    int getCalls = 0, downloadCalls = 0;
    std::string getError, dlError;
    bool throwOnGet = false;
    std::function<void()> duringGet, duringDownload;
    HttpResult get(const std::string& url, int, size_t) override {
        ++getCalls;
        if (duringGet) duringGet();
        if (throwOnGet) throw std::runtime_error("boom");
        HttpResult r;
        if (!getError.empty()) { r.ok = false; r.error = getError; return r; }
        auto it = gets.find(url);
        if (it == gets.end()) { r.ok = true; r.status = 404; return r; }
        return it->second;
    }
    bool download(const std::string& url, const fs::path& dest, int, const std::atomic<bool>& cancel,
                  const std::function<void(int64_t)>& progress, std::string& error) override {
        ++downloadCalls;
        if (duringDownload) duringDownload();
        if (cancel) { error = "cancelled"; return false; }
        if (!dlError.empty()) { error = dlError; return false; }
        auto it = files.find(url);
        if (it == files.end()) { error = "HTTP 404"; return false; }
        std::ofstream f(dest, std::ios::binary); f << it->second; f.close();
        progress((int64_t) it->second.size());
        return true;
    }
};

static HttpResult ok200(const std::string& body) { HttpResult r; r.ok = true; r.status = 200; r.body = body; return r; }

static const char* kEndpoint = "https://updates.example.test/demo/update-manifest.json";
static const char* kInstallerUrl = "https://updates.example.test/demo/DemoSynth-1.3.0-Windows-Setup.exe";

struct M {
    std::string schema = "apc-update/1.0", product = "DemoSynth", version = "1.3.0", minSupported, platform = "windows-x64",
                kind = "installer", url = "DemoSynth-1.3.0-Windows-Setup.exe", payload = "installer-bytes-v1.3.0", sha, notes = "Fixes.";
    int64_t size = -1;
    bool sign = true, withArtifacts = true, badShaFormat = false, dropSize = false;
};

static std::string buildManifest(const M& m) {
    JsonValue d = JsonValue::object();
    d.set("schema", m.schema); d.set("product", m.product); d.set("version", m.version);
    d.set("published_at", "2026-11-07T12:00:00Z"); d.set("notes", m.notes);
    if (!m.minSupported.empty()) d.set("min_supported", m.minSupported);
    JsonValue arts = JsonValue::array();
    if (m.withArtifacts) {
        JsonValue a = JsonValue::object();
        a.set("platform", m.platform); a.set("kind", m.kind); a.set("url", m.url);
        a.set("sha256", m.badShaFormat ? std::string("XYZ") : (m.sha.empty() ? sha256Hex(m.payload) : m.sha));
        if (!m.dropSize) a.set("size", m.size < 0 ? (int64_t) m.payload.size() : m.size);
        arts.push(a);
    }
    d.set("artifacts", arts);
    if (m.sign) {
        std::string canon, err; canonicalize(d, canon, &err);
        d.set("signature", base64Encode(FakeVerifier::sign(canon)));
    }
    return toJson(d);
}

static fs::path tempDir(const char* tag) {
    static int n = 0;
    fs::path p = fs::temp_directory_path() / ("apc_test_update_" + std::string(tag) + "_" + std::to_string(sysutil::currentProcessId()) + "_" + std::to_string(n++));
    fs::remove_all(p); fs::create_directories(p);
    return p;
}

struct Rig {
    FakeHttp http; FakeVerifier ver; FakeClock clock; fs::path dir;
    UpdateConfig cfg;
    std::vector<UpdateState> seen;
    explicit Rig(const char* tag, const char* current = "1.2.0") : dir(tempDir(tag)) {
        cfg.product = "DemoSynth"; cfg.currentVersion = current; cfg.platform = "windows-x64";
        cfg.endpointUrl = kEndpoint; cfg.downloadDir = dir / "updates";
    }
    ~Rig() { std::error_code ec; fs::remove_all(dir, ec); }
    void serve(const M& m) {
        http.gets[kEndpoint] = ok200(buildManifest(m));
        http.files[kInstallerUrl] = m.payload;
    }
    std::unique_ptr<UpdateFlow> make(IUpdateSettings* s = nullptr) {
        auto f = std::make_unique<UpdateFlow>(cfg, http, ver, clock, s);
        f->onChange = [this](const UpdateStatus& st) { if (seen.empty() || seen.back() != st.state) seen.push_back(st.state); };
        return f;
    }
};

static bool failedWith(const UpdateStatus& s, UpdateError e) {
    return s.state == UpdateState::Failed && s.error == e && !s.message.empty();
}

// ----------------------------------------------------------------------------- tests

static void testHappyPath() {
    Rig r("happy");
    M m; r.serve(m);
    auto f = r.make();
    CHECK(f->status().state == UpdateState::Idle);
    CHECK(f->checkNow());
    UpdateStatus s = f->status();
    CHECK(s.state == UpdateState::UpdateAvailable);
    CHECK(s.latestVersion == "1.3.0" && s.currentVersion == "1.2.0" && s.notes == "Fixes.");
    CHECK(s.artifactUrl == kInstallerUrl);                      // bare file name resolved next to the manifest
    CHECK(s.message.find("1.3.0") != std::string::npos);
    CHECK(r.http.downloadCalls == 0);                           // a check NEVER downloads
    CHECK(!fs::exists(r.cfg.downloadDir) || fs::is_empty(r.cfg.downloadDir));
    CHECK(r.ver.calls == 1);
    // the verifier saw the canonical bytes WITHOUT the signature member
    CHECK(r.ver.lastMessage.find("signature") == std::string::npos);
    CHECK(r.ver.lastMessage.find("\"version\":\"1.3.0\"") != std::string::npos);

    CHECK(f->download());
    s = f->status();
    CHECK(s.state == UpdateState::ReadyToInstall);
    CHECK(s.error == UpdateError::None);
    CHECK(!s.installerPath.empty() && fs::exists(s.installerPath));
    CHECK(s.installerPath.find("DemoSynth-1.3.0-Windows-Setup.exe") != std::string::npos);
    std::string content, err; sysutil::readWholeFile(s.installerPath, content, err);
    CHECK(content == m.payload);
    CHECK(!fs::exists(s.installerPath + ".part"));
    CHECK(s.message.find("Close your DAW") != std::string::npos);        // explicit user step, never silently replaced
    CHECK(s.bytesDownloaded == (int64_t) m.payload.size());
    CHECK(r.http.downloadCalls == 1);
    // the exact state sequence, in order
    const std::vector<UpdateState> want = { UpdateState::Checking, UpdateState::UpdateAvailable, UpdateState::Downloading,
                                            UpdateState::Verifying, UpdateState::ReadyToInstall };
    CHECK(r.seen == want);
    // ReadyToInstall is terminal for download(): no double download
    CHECK(!f->download());
    CHECK(r.http.downloadCalls == 1);
}

static void testUpToDateAndDowngrade() {
    {   Rig r("same", "1.3.0");
        M m; r.serve(m); auto f = r.make();
        CHECK(f->checkNow() && f->status().state == UpdateState::UpToDate);
        CHECK(!f->status().message.empty());
        CHECK(!f->download());                                           // nothing to download
        CHECK(r.http.downloadCalls == 0); }
    {   Rig r("older-server", "2.0.0");                                  // server is BEHIND us: never offer a downgrade
        M m; r.serve(m); auto f = r.make();
        CHECK(f->checkNow() && f->status().state == UpdateState::UpToDate);
        CHECK(!f->download()); CHECK(r.http.downloadCalls == 0); }
    {   Rig r("rc-current", "1.3.0-rc.1");                               // pre-release -> release IS an update
        M m; r.serve(m); auto f = r.make();
        CHECK(f->checkNow() && f->status().state == UpdateState::UpdateAvailable); }
    {   Rig r("rc-manifest", "1.3.0");                                   // release -> pre-release manifest is NOT
        M m; m.version = "1.3.0-rc.1"; r.serve(m); auto f = r.make();
        CHECK(f->checkNow() && f->status().state == UpdateState::UpToDate); }
    {   Rig r("min-supported", "0.9.0");
        M m; m.minSupported = "1.0.0"; r.serve(m); auto f = r.make();
        CHECK(f->checkNow());
        CHECK(f->status().state == UpdateState::UpdateAvailable && f->status().belowMinSupported);
        CHECK(f->status().minSupported == "1.0.0"); }
}

static void testCheckFailures() {
    auto expect = [](const char* tag, UpdateError e, const std::function<void(Rig&)>& setup) {
        Rig r(tag);
        setup(r);
        auto f = r.make();
        CHECK_W(f->checkNow(), tag);
        const UpdateStatus s = f->status();
        CHECK_W(failedWith(s, e), std::string(tag) + " -> state " + toString(s.state) + " msg=" + s.message);
        CHECK_W(r.http.downloadCalls == 0, tag);
        CHECK_W(!f->download(), tag);                                    // nothing offered after a failed check
        return s;
    };
    expect("empty-endpoint", UpdateError::NotConfigured, [](Rig& r) { r.cfg.endpointUrl.clear(); });
    expect("bad-current", UpdateError::NotConfigured, [](Rig& r) { r.cfg.currentVersion = "banana"; M m; r.serve(m); });
    expect("http-endpoint", UpdateError::InsecureUrl, [](Rig& r) { r.cfg.endpointUrl = "http://updates.example.test/m.json"; });
    {   auto s = expect("net-down", UpdateError::Network, [](Rig& r) { r.http.getError = "timeout"; });
        CHECK(s.message.find("timeout") != std::string::npos); }
    expect("http-500", UpdateError::Network, [](Rig& r) { HttpResult x; x.ok = true; x.status = 500; r.http.gets[kEndpoint] = x; });
    expect("http-404", UpdateError::Network, [](Rig&) {});               // nothing served
    expect("not-json", UpdateError::BadManifest, [](Rig& r) { r.http.gets[kEndpoint] = ok200("<html>captive portal</html>"); });
    expect("empty-body", UpdateError::BadManifest, [](Rig& r) { r.http.gets[kEndpoint] = ok200(""); });
    expect("json-array", UpdateError::BadManifest, [](Rig& r) { r.http.gets[kEndpoint] = ok200("[1,2]"); });
    expect("float-in-doc", UpdateError::BadManifest, [](Rig& r) { M m; std::string b = buildManifest(m); r.http.gets[kEndpoint] = ok200(b.substr(0, b.rfind('}')) + ",\"x\":1.5}"); });
    expect("wrong-schema", UpdateError::UnsupportedSchema, [](Rig& r) { M m; m.schema = "apc-update/2.0"; r.serve(m); });
    expect("no-signature", UpdateError::BadSignature, [](Rig& r) { M m; m.sign = false; r.serve(m); });
    expect("short-signature", UpdateError::BadSignature, [](Rig& r) {
        M m; std::string b = buildManifest(m); auto pr = parseJson(b); pr.value.set("signature", base64Encode("short")); r.http.gets[kEndpoint] = ok200(toJson(pr.value)); });
    expect("tampered-version", UpdateError::BadSignature, [](Rig& r) {   // signed 1.3.0, attacker bumps to 9.9.9
        M m; std::string b = buildManifest(m); auto pr = parseJson(b); pr.value.set("version", "9.9.9"); r.http.gets[kEndpoint] = ok200(toJson(pr.value)); });
    expect("tampered-sha", UpdateError::BadSignature, [](Rig& r) {
        M m; std::string b = buildManifest(m); auto pr = parseJson(b);
        pr.value.find("artifacts")->at(0).set("sha256", std::string(64, 'a')); r.http.gets[kEndpoint] = ok200(toJson(pr.value)); });
    expect("tampered-url", UpdateError::BadSignature, [](Rig& r) {
        M m; std::string b = buildManifest(m); auto pr = parseJson(b);
        pr.value.find("artifacts")->at(0).set("url", "https://evil.example.test/x.exe"); r.http.gets[kEndpoint] = ok200(toJson(pr.value)); });
    expect("extra-member", UpdateError::BadSignature, [](Rig& r) {
        M m; std::string b = buildManifest(m); auto pr = parseJson(b); pr.value.set("extra", true); r.http.gets[kEndpoint] = ok200(toJson(pr.value)); });
    expect("wrong-product", UpdateError::WrongProduct, [](Rig& r) { M m; m.product = "OtherSynth"; r.serve(m); });
    expect("bad-version-string", UpdateError::BadManifest, [](Rig& r) { M m; m.version = "one.two"; r.serve(m); });
    expect("no-artifacts", UpdateError::BadManifest, [](Rig& r) { M m; m.withArtifacts = false; r.serve(m); });
    expect("bad-sha-format", UpdateError::BadManifest, [](Rig& r) { M m; m.badShaFormat = true; r.serve(m); });
    expect("missing-size", UpdateError::BadManifest, [](Rig& r) { M m; m.dropSize = true; r.serve(m); });
    expect("zero-size", UpdateError::BadManifest, [](Rig& r) { M m; m.size = 0; r.serve(m); });
    expect("other-platform", UpdateError::NoArtifactForPlatform, [](Rig& r) { M m; m.platform = "macos-universal"; r.serve(m); });
    expect("archive-only", UpdateError::NoArtifactForPlatform, [](Rig& r) { M m; m.kind = "archive"; r.serve(m); });
    expect("http-artifact", UpdateError::InsecureUrl, [](Rig& r) { M m; m.url = "http://updates.example.test/x.exe"; r.serve(m); });
    expect("rooted-artifact-url", UpdateError::InsecureUrl, [](Rig& r) { M m; m.url = "/etc/passwd"; r.serve(m); });
    expect("url-with-space", UpdateError::InsecureUrl, [](Rig& r) { M m; m.url = "https://a.example.test/x y.exe"; r.serve(m); });
    expect("http-throws", UpdateError::Unexpected, [](Rig& r) { M m; r.serve(m); r.http.throwOnGet = true; });
    {   // manifest bigger than the cap is refused, not truncated
        Rig r("huge"); M m; m.notes = std::string(20000, 'x'); r.serve(m);
        auto f = r.make(); f->checkNow();
        CHECK(failedWith(f->status(), UpdateError::BadManifest)); }
    {   // a failed check after a good one must not leave a stale offer behind
        Rig r("stale"); M m; r.serve(m);
        auto f = r.make(); f->checkNow(); CHECK(f->status().state == UpdateState::UpdateAvailable);
        r.http.getError = "offline"; f->checkNow();
        CHECK(failedWith(f->status(), UpdateError::Network));
        CHECK(!f->download()); CHECK(r.http.downloadCalls == 0); }
}

static void testDownloadFailuresAndRetry() {
    {   Rig r("dl-net"); M m; r.serve(m); auto f = r.make();
        f->checkNow(); r.http.dlError = "connection reset";
        CHECK(f->download());
        UpdateStatus s = f->status();
        CHECK(failedWith(s, UpdateError::Network) && s.message.find("connection reset") != std::string::npos);
        CHECK(!fs::exists(r.cfg.downloadDir / "DemoSynth-1.3.0-Windows-Setup.exe.part"));
        r.http.dlError.clear();                                          // retry from Failed works
        CHECK(f->download());
        CHECK(f->status().state == UpdateState::ReadyToInstall); }
    {   Rig r("dl-sha"); M m; m.sha = std::string(64, 'c'); r.serve(m); auto f = r.make();     // manifest hash != payload
        f->checkNow(); CHECK(f->download());
        UpdateStatus s = f->status();
        CHECK(failedWith(s, UpdateError::ChecksumMismatch));
        CHECK(s.installerPath.empty());
        CHECK(!fs::exists(r.cfg.downloadDir / "DemoSynth-1.3.0-Windows-Setup.exe"));
        CHECK(!fs::exists(r.cfg.downloadDir / "DemoSynth-1.3.0-Windows-Setup.exe.part"));      // bad file deleted
        CHECK(s.message.find("Nothing was installed") != std::string::npos); }
    {   Rig r("dl-size"); M m; m.size = 5; r.serve(m); auto f = r.make();
        f->checkNow(); CHECK(f->download());
        CHECK(failedWith(f->status(), UpdateError::SizeMismatch));
        CHECK(fs::is_empty(r.cfg.downloadDir)); }
    {   Rig r("dl-swapped"); M m; r.serve(m); r.http.files[kInstallerUrl] = "attacker payload";   // MITM swaps the file
        auto f = r.make(); f->checkNow(); f->download();
        CHECK(failedWith(f->status(), UpdateError::SizeMismatch) || failedWith(f->status(), UpdateError::ChecksumMismatch));
        CHECK(fs::is_empty(r.cfg.downloadDir)); }
    {   Rig r("dl-same-size-swap"); M m; r.serve(m);                      // same length, different bytes
        std::string evil = m.payload; evil[0] ^= 1; r.http.files[kInstallerUrl] = evil;
        auto f = r.make(); f->checkNow(); f->download();
        CHECK(failedWith(f->status(), UpdateError::ChecksumMismatch)); }
    {   Rig r("dl-cancel"); M m; r.serve(m); auto f = r.make();
        f->checkNow();
        UpdateFlow* fp = f.get();
        r.http.duringDownload = [fp] { fp->cancel(); };
        CHECK(f->download());
        UpdateStatus s = f->status();
        CHECK(s.state == UpdateState::UpdateAvailable && s.message == "Download cancelled.");
        CHECK(fs::is_empty(r.cfg.downloadDir));
        r.http.duringDownload = nullptr;
        CHECK(f->download());                                            // user can try again
        CHECK(f->status().state == UpdateState::ReadyToInstall); }
    {   Rig r("dl-wrong-state"); M m; r.serve(m); auto f = r.make();
        CHECK(!f->download());                                           // Idle
        CHECK(f->status().state == UpdateState::Idle);
        CHECK(r.http.downloadCalls == 0); }
    {   Rig r("dl-io"); M m; r.serve(m); auto f = r.make(); f->checkNow();
        { std::ofstream blocker(r.cfg.downloadDir); }                    // a FILE where the folder must be
        CHECK(f->download());
        CHECK(failedWith(f->status(), UpdateError::Io)); }
    {   Rig r("dl-hostile-name"); M m; m.url = "https://updates.example.test/d/..%2f..%2fevil.exe?x=1#y"; r.serve(m);
        r.http.files[m.url] = m.payload; auto f = r.make(); f->checkNow(); CHECK(f->download());
        const UpdateStatus s = f->status();
        CHECK(s.state == UpdateState::ReadyToInstall);
        CHECK(fs::path(s.installerPath).parent_path() == r.cfg.downloadDir);        // stays inside the download dir
        CHECK(fs::path(s.installerPath).filename().string().find('/') == std::string::npos); }
    {   Rig r("dl-throws"); M m; r.serve(m); auto f = r.make(); f->checkNow();
        r.http.duringDownload = [] { throw std::runtime_error("disk exploded"); };
        CHECK(f->download());
        CHECK(failedWith(f->status(), UpdateError::Unexpected)); }
}

static void testGoldenManifest(const char* fixturesDir) {
    std::string raw, err;
    CHECK(sysutil::readWholeFile(fs::path(fixturesDir) / "canonical-vectors.json", raw, err) == sysutil::ReadStatus::Ok);
    const JsonParseResult pr = parseJson(stripUtf8Bom(raw));
    CHECK(pr.ok);
    const JsonValue& s = *pr.value.find("signed");
    JsonValue doc = *s.find("document");
    doc.set("signature", s.find("signature_b64")->asString());

    GoldenVerifier gv;
    gv.msg = s.find("canonical")->asString();
    CHECK(base64Decode(s.find("signature_b64")->asString(), gv.sig));

    Rig r("golden", "1.2.0");
    r.http.gets[kEndpoint] = ok200(toJson(doc));
    UpdateFlow f(r.cfg, r.http, gv, r.clock);
    f.checkNow();
    const UpdateStatus st = f.status();
    CHECK_W(st.state == UpdateState::UpdateAvailable, st.message);       // proves canonical bytes + signature bytes are exactly the golden ones
    CHECK(gv.calls == 1);
    CHECK(st.latestVersion == "1.3.0" && st.artifactSize == 12345678);
    CHECK(st.notes == "Fixes.\nNew: A/B.");
    // Same document but the SIGNED size was changed by one -> the golden verifier rejects
    JsonValue tampered = doc; tampered.find("artifacts")->at(0).set("size", 12345679);
    r.http.gets[kEndpoint] = ok200(toJson(tampered));
    f.checkNow();
    CHECK(failedWith(f.status(), UpdateError::BadSignature));
}

static void testBusyAndStatusFromOtherThread() {
    Rig r("busy"); M m; r.serve(m);
    std::promise<void> entered, release;
    auto released = release.get_future().share();
    r.http.duringGet = [&] { entered.set_value(); released.wait(); };
    auto f = r.make();
    std::thread worker([&] { f->checkNow(); });
    entered.get_future().wait();
    CHECK(f->status().state == UpdateState::Checking);                   // readable while the worker is blocked
    CHECK(!f->checkNow());                                               // second op refused, not queued
    CHECK(!f->autoCheckIfDue());
    CHECK(!f->download());
    release.set_value();
    worker.join();
    CHECK(f->status().state == UpdateState::UpdateAvailable);
    CHECK(r.http.getCalls == 1);
}

// ----- auto-check gating, two simulated instances sharing one settings.json -----

static void testAutoCheckGating() {
    Rig r("auto");
    M m; r.serve(m);
    SettingsStore::Options o; o.filePath = r.dir / "settings" / "settings.json";
    SettingsStore storeA(o), storeB(o);                                  // two instances (could be two processes)
    StoreUpdateSettings<SettingsStore> setA(storeA), setB(storeB);
    FakeHttp httpB; httpB.gets = r.http.gets; httpB.files = r.http.files;
    auto fa = r.make(&setA);
    UpdateFlow fb(r.cfg, httpB, r.ver, r.clock, &setB);

    // default: auto check is OFF -> nothing happens, no network
    CHECK(!fa->autoCheckIfDue());
    CHECK(!fb.autoCheckIfDue());
    CHECK(r.http.getCalls == 0 && httpB.getCalls == 0);

    std::string err;
    CHECK(storeA.set("ui.auto_update_check", true, err));
    // instance A wins the daily slot; B (same file, different object) must not check again
    CHECK(fa->autoCheckIfDue());
    CHECK(r.http.getCalls == 1);
    CHECK(fa->status().automatic && fa->status().state == UpdateState::UpdateAvailable);
    CHECK(!fb.autoCheckIfDue());
    CHECK(httpB.getCalls == 0);
    CHECK(!fa->autoCheckIfDue());
    CHECK(r.http.downloadCalls == 0 && httpB.downloadCalls == 0);        // auto never downloads

    // 23 h later: still within the day for both
    r.clock.t += 23 * 3600;
    CHECK(!fa->autoCheckIfDue() && !fb.autoCheckIfDue());
    // 24 h after the first check: exactly one of them runs
    r.clock.t += 1 * 3600;
    const bool b1 = fb.autoCheckIfDue();
    const bool a1 = fa->autoCheckIfDue();
    CHECK(b1 != a1);
    CHECK(r.http.getCalls + httpB.getCalls == 2);

    // manual check is always allowed and does NOT consume or require the slot
    CHECK(fa->checkNow());
    CHECK(!fa->status().automatic);

    // the user turns auto-check off in another instance -> this one honours it (settings re-read from disk)
    r.clock.t += 48 * 3600;
    CHECK(storeB.set("ui.auto_update_check", false, err));
    CHECK(!fa->autoCheckIfDue());

    // clock moved backwards past the stored timestamp -> treated as due (never stuck for years)
    CHECK(storeB.set("ui.auto_update_check", true, err));
    CHECK(storeB.set("update.last_check_unix", r.clock.t + 10 * 365 * 86400LL, err));
    const int before = r.http.getCalls;
    CHECK(fa->autoCheckIfDue());
    CHECK(r.http.getCalls == before + 1);

    // no endpoint configured -> auto-check does nothing and does not burn the slot
    Rig r2("auto-noendpoint"); r2.cfg.endpointUrl.clear();
    SettingsStore::Options o2; o2.filePath = r2.dir / "settings.json";
    SettingsStore s2(o2); StoreUpdateSettings<SettingsStore> set2(s2);
    CHECK(s2.set("ui.auto_update_check", true, err));
    auto f2 = r2.make(&set2);
    CHECK(!f2->autoCheckIfDue());
    CHECK(!s2.has("update.last_check_unix"));
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <fixtures-dir>\n", argv[0]); return 2; }
    testHappyPath();
    testUpToDateAndDowngrade();
    testCheckFailures();
    testDownloadFailuresAndRetry();
    testGoldenManifest(argv[1]);
    testBusyAndStatusFromOtherThread();
    testAutoCheckGating();
    std::printf("test_update_flow: %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
