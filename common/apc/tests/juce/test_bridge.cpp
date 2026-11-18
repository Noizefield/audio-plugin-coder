// Tests for common/apc/juce/ApcWebBridge.h: the JS <-> C++ dispatcher, its events, the URL allow-list,
// the ParamTable help source, license/update glue, redaction. The WebView itself is NOT involved (that part is
// compile-checked by compilecheck_webview.cpp); the dispatcher is exactly what addApcNativeFunctions() forwards to.
#include "test_util.h"

#include "apc/juce/ApcWebBridge.h"

#include <future>
#include <regex>
#include <tuple>

namespace fs = std::filesystem;

namespace pu = apc::presets::util;
using namespace apc::web;
using t::FakeLive;

namespace
{
// ---------------------------------------------------------------- fakes
struct FakeParams : IParamAccess
{
    std::map<std::string, ParamDescriptor> p;
    std::vector<std::tuple<std::string, double, bool>> pending;
    std::vector<std::string> log;

    FakeParams()
    {
        ParamDescriptor c;
        c.id = "filter_cutoff_hz"; c.name = "Cutoff"; c.unit = "Hz"; c.min = 20; c.max = 20000; c.def = 1000; c.value = 1000; c.skew = 0.3;
        c.help = { "what", "effect", "how" };
        p[c.id] = c;
        ParamDescriptor m;
        m.id = "osc1_wave"; m.name = "Wave"; m.min = 0; m.max = 2; m.def = 0; m.value = 0; m.step = 1; m.choices = { "saw", "square", "pulse" };
        p[m.id] = m;
    }
    std::vector<ParamDescriptor> list() override { std::vector<ParamDescriptor> o; for (auto& kv : p) o.push_back (kv.second); return o; }
    std::optional<ParamDescriptor> get (const std::string& id) override { auto it = p.find (id); if (it == p.end()) return std::nullopt; return it->second; }
    apc::presets::Result<double> set (const std::string& id, double v) override
    {
        auto it = p.find (id);
        if (it == p.end()) return apc::presets::Result<double>::fail ("unknown_param", "Unknown parameter \"" + id + "\".");
        it->second.value = std::max (it->second.min, std::min (it->second.max, v));
        log.push_back ("set:" + id);
        return apc::presets::Result<double>::success (it->second.value);
    }
    apc::presets::Status begin (const std::string& id) override { log.push_back ("begin:" + id); return apc::presets::Status::success(); }
    apc::presets::Status end (const std::string& id) override { log.push_back ("end:" + id); return apc::presets::Status::success(); }
    apc::presets::Result<double> reset (const std::string& id) override
    {
        auto it = p.find (id);
        if (it == p.end()) return apc::presets::Result<double>::fail ("unknown_param", "Unknown parameter.");
        it->second.value = it->second.def;
        return apc::presets::Result<double>::success (it->second.value);
    }
    void collectChanged (const std::function<void (const std::string&, double, bool)>& cb) override
    {
        auto copy = std::move (pending);
        pending.clear();
        for (auto& e : copy) cb (std::get<0> (e), std::get<1> (e), std::get<2> (e));
    }
};

struct FakeVerifier : apc::ISignatureVerifier
{
    static std::string sign (const std::string& m) { return apc::sha256Raw ("lic-a" + m) + apc::sha256Raw ("lic-b" + m); }
    bool verify (const std::string& m, const std::string& s) const override { return s == sign (m); }
};
struct FakeClock : apc::IClock { std::int64_t nowUnixSeconds() const override { return 1800000000; } };
struct FakeMachine : apc::IMachineInfo { std::vector<apc::MachineComponent> components() const override { return { { "cpu", "X" }, { "machine-id", "abc" } }; } };
struct NoHttp : apc::IHttp
{
    apc::HttpResult get (const std::string&, int, size_t) override { return {}; }
    bool download (const std::string&, const std::filesystem::path&, int, const std::atomic<bool>&, const std::function<void (int64_t)>&, std::string& e) override { e = "no network in tests"; return false; }
};

std::string makeLicense (const std::string& product = "DemoSynth", bool sign = true)
{
    apc::JsonValue d = apc::JsonValue::object();
    d.set ("schema", "apc-license/1.0"); d.set ("product", product); d.set ("customer_name", "Ada Lovelace"); d.set ("customer_email", "ada@example.test");
    d.set ("order_id", "ORD-1"); d.set ("issued_at", "2026-10-23T14:30:00Z"); d.set ("license_type", "commercial_perpetual"); d.set ("allowed_seats", 3);
    d.set ("expires_at", apc::JsonValue());
    if (sign) { std::string canon; apc::canonicalize (d, canon); d.set ("signature_ed25519", apc::base64Encode (FakeVerifier::sign (canon))); }
    return apc::toJson (d);
}

// ---------------------------------------------------------------- rig
struct BridgeRig
{
    fs::path base;
    apc::PresetLayout layout;
    FakeLive live { t::typedDecls() };
    std::unique_ptr<apc::presets::Store> store;
    FakeParams params;
    std::unique_ptr<apc::SettingsStore> settings;
    FakeVerifier verifier;
    FakeClock clock;
    FakeMachine machine;
    NoHttp http;
    std::unique_ptr<apc::LicenseManager> license;
    std::unique_ptr<apc::UpdateFlow> update;
    ApcBackend backend;
    std::unique_ptr<ApcBridge> bridge;

    std::mutex qm;
    std::deque<std::function<void()>> queue;
    std::vector<std::pair<std::string, juce::var>> events;
    std::vector<std::string> opened, revealed;
    bool allowSave = true;

    explicit BridgeRig (const std::string& name, bool withFixtures = true)
    {
        base = t::freshDir (name);
        layout = t::layoutIn (base);
        if (withFixtures) t::copyTree (t::fixtures() / "typed-valid" / "presets", layout.presets);
        auto cfg = t::typedConfig (layout);
        cfg.gate = [this] (apc::presets::Gate) { return allowSave; };
        store = std::make_unique<apc::presets::Store> (cfg);
        store->setLiveState (live.make());
        store->rescan();

        apc::SettingsStore::Options so;
        so.filePath = layout.settingsFile;
        settings = std::make_unique<apc::SettingsStore> (so);

        apc::LicenseConfig lc;
        lc.product = "DemoSynth";
        license = std::make_unique<apc::LicenseManager> (lc, verifier, clock, machine);
        apc::UpdateConfig uc;
        uc.product = "DemoSynth"; uc.currentVersion = "1.2.3"; uc.platform = "windows-x64"; uc.endpointUrl = "";   // not configured
        update = std::make_unique<apc::UpdateFlow> (uc, http, verifier, clock);

        backend.info.product = "Demo Synth"; backend.info.manufacturer = "Acme"; backend.info.version = "1.2.3"; backend.info.buildDate = "2026-11-08";
        backend.info.frameworkVersion = "1.8.0";
        backend.info.links = { { "company", "https://acme.example/" }, { "product", "https://acme.example/demo-synth" }, { "docs", "https://docs.acme.example" }, { "support", "" } };
        backend.info.features = t::parseV ("{\"themeEnabled\":true,\"presetHierarchy\":\"typed\"}");
        backend.params = &params;
        backend.presets = store.get();
        backend.settings = settings.get();
        backend.license.manager = license.get();
        backend.license.licensePath = layout.licenseFile;
        backend.license.mode = "signed-file";
        backend.update = update.get();
        backend.openUrl = [this] (const std::string& u) { opened.push_back (u); return true; };
        backend.reveal = [this] (const std::filesystem::path& p) { revealed.push_back (pu::pathToUtf8 (p)); };
        backend.post = [this] (std::function<void()> f) { std::lock_guard<std::mutex> g (qm); queue.push_back (std::move (f)); };
        bridge = std::make_unique<ApcBridge> (backend);
        bridge->setEmitter ([this] (const std::string& e, const juce::var& v) { events.emplace_back (e, v); });
    }

    ~BridgeRig() { bridge.reset(); }

    void pump()
    {
        for (;;)
        {
            std::function<void()> f;
            { std::lock_guard<std::mutex> g (qm); if (queue.empty()) return; f = std::move (queue.front()); queue.pop_front(); }
            f();
        }
    }

    // Synchronous call: waits (<= 10 s) for the completion even when a worker lane answers.
    juce::var call (const std::string& name, const char* json = "{}")
    {
        auto prom = std::make_shared<std::promise<juce::var>>();
        auto fut = prom->get_future();
        juce::Array<juce::var> args;
        if (json != nullptr) args.add (t::parseV (json));
        bridge->invoke (name, args, [prom] (juce::var v) { try { prom->set_value (std::move (v)); } catch (...) {} });
        if (fut.wait_for (std::chrono::seconds (10)) != std::future_status::ready) return pu::newObject();
        pump();
        return fut.get();
    }

    bool waitEvent (const std::string& name, std::function<bool (const juce::var&)> pred, int ms = 5000)
    {
        const auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds (ms);
        while (std::chrono::steady_clock::now() < end)
        {
            pump();
            for (auto& e : events) if (e.first == name && pred (e.second)) return true;
            std::this_thread::sleep_for (std::chrono::milliseconds (5));
        }
        return false;
    }
    int countEvents (const std::string& name) const { int n = 0; for (auto& e : events) if (e.first == name) ++n; return n; }
};

bool isError (const juce::var& v) { return pu::get (v, "error").isString(); }
std::string errCode (const juce::var& v) { return pu::getStr (v, "error"); }
} // namespace

// =============================================================================================
TEST (bridge_function_list_matches_contract_md)
{
    const auto text = t::slurp (fs::path (APC_REPO_ROOT) / "templates" / "webview" / "apc-ui" / "CONTRACT.md");
    const auto from = text.find ("## Bridge functions");
    const auto to = text.find ("Native -> JS events");
    CHECK (from != std::string::npos && to != std::string::npos && to > from);
    const std::string block = text.substr (from, to - from);
    std::set<std::string> contract;
    const std::regex re ("apc\\.[A-Za-z]+(\\.[A-Za-z]+)*");
    for (auto it = std::sregex_iterator (block.begin(), block.end(), re); it != std::sregex_iterator(); ++it) contract.insert (it->str());
    std::set<std::string> impl (names::all().begin(), names::all().end());
    CHECK (contract.size() > 30);
    // every CONTRACT.md function is implemented ...
    for (const auto& n : contract) { if (! impl.count (n)) std::cout << "  in CONTRACT.md but not implemented: " << n << "\n"; CHECK (impl.count (n) == 1); }
    // ... and the only extras are the three the UI kit already calls (and apc-mock.js implements) that CONTRACT.md does not list yet
    const std::set<std::string> kitExtensions = { "apc.presets.info", "apc.presets.restoreFactory", "apc.update.cancel" };
    for (const auto& n : impl) if (! contract.count (n)) { std::cout << "  implemented but not in CONTRACT.md: " << n << "\n"; CHECK (kitExtensions.count (n) == 1); }
    // drift guard: every "apc.*" function name the kit's JS (components + mock) mentions is implemented natively
    std::set<std::string> used;
    const std::regex quoted ("\"(apc\\.[A-Za-z]+(\\.[A-Za-z]+)*)\"");
    for (const auto& e : fs::directory_iterator (fs::path (APC_REPO_ROOT) / "templates" / "webview" / "apc-ui"))
    {
        if (e.path().extension() != ".js" || e.path().filename() == "apc-bridge.js") continue;
        const std::string js = t::slurp (e.path());
        for (auto it = std::sregex_iterator (js.begin(), js.end(), quoted); it != std::sregex_iterator(); ++it) used.insert ((*it)[1].str());
    }
    CHECK (used.size() > 30);
    for (const auto& n : used) { if (! impl.count (n)) std::cout << "  used by the kit JS but not implemented natively: " << n << "\n"; CHECK (impl.count (n) == 1); }

    BridgeRig r ("bridge_names");
    std::set<std::string> registered;
    for (const auto& kv : r.bridge->functions()) registered.insert (kv.first);
    CHECK (registered == impl);
    CHECK_EQ (errCode (r.call ("apc.nope")), std::string ("unknown_function"));   // the code apc-settings.js special-cases
    // no JUCE-reserved prefix, and unknown names never hang
    for (const auto& n : impl) CHECK (n.rfind ("apc.", 0) == 0);
    const auto unk = r.call ("apc.nope");
    CHECK_EQ (errCode (unk), std::string ("unknown_function"));
}

TEST (bridge_info_params_and_error_shape)
{
    BridgeRig r ("bridge_info");
    const auto info = r.call ("apc.info", nullptr);
    CHECK_EQ (pu::getStr (info, "product"), std::string ("Demo Synth"));
    CHECK_EQ (pu::getStr (info, "version"), std::string ("1.2.3"));
    CHECK (pu::has (pu::get (info, "links"), "company"));
    CHECK (! pu::has (pu::get (info, "links"), "support"));   // not configured -> not sent (branding rule)
    CHECK (pu::getBool (pu::get (info, "features"), "themeEnabled"));
    CHECK (pu::isObject (pu::get (info, "standards")));

    const auto list = r.call ("apc.params.list");
    CHECK (list.isArray());
    CHECK_EQ ((int) list.getArray()->size(), 2);
    const auto d = r.call ("apc.params.get", "{\"id\":\"filter_cutoff_hz\"}");
    for (const char* k : { "id", "name", "unit", "min", "max", "default", "value", "help", "modulation", "midiCc" }) CHECK (pu::has (d, k));
    CHECK_EQ (pu::getStr (pu::get (d, "help"), "what"), std::string ("what"));
    CHECK (pu::get (d, "modulation").isArray());
    CHECK_EQ (pu::getNum (d, "skew"), 0.3);
    const auto ch = r.call ("apc.params.get", "{\"id\":\"osc1_wave\"}");
    CHECK_EQ ((int) pu::get (ch, "choices").getArray()->size(), 3);

    const auto set = r.call ("apc.param.set", "{\"id\":\"filter_cutoff_hz\",\"value\":99999}");
    CHECK_EQ (pu::getNum (set, "value"), 20000.0);                                  // clamped value is what comes back
    CHECK (r.store->isDirty());                                                    // a UI write marks the preset dirty
    CHECK_EQ (pu::getNum (r.call ("apc.param.reset", "{\"id\":\"filter_cutoff_hz\"}"), "value"), 1000.0);
    CHECK (! isError (r.call ("apc.param.begin", "{\"id\":\"filter_cutoff_hz\"}")));
    CHECK (! isError (r.call ("apc.param.end", "{\"id\":\"filter_cutoff_hz\"}")));
    CHECK_EQ (r.params.log.back(), std::string ("end:filter_cutoff_hz"));

    // every failure is { error, message } (+ code) - never a bare string, never silent
    for (const auto& bad : { r.call ("apc.params.get", "{\"id\":\"nope\"}"), r.call ("apc.param.set", "{\"id\":\"nope\",\"value\":1}"),
                             r.call ("apc.param.set", "{\"id\":\"filter_cutoff_hz\",\"value\":\"loud\"}"), r.call ("apc.param.set", "{\"id\":\"filter_cutoff_hz\"}") })
    {
        CHECK (isError (bad));
        CHECK (pu::get (bad, "message").isString() && ! pu::getStr (bad, "message").empty());
    }
    CHECK_EQ (errCode (r.call ("apc.param.set", "{\"id\":\"filter_cutoff_hz\"}")), std::string ("invalid"));

    // optional features answer `unsupported` instead of doing nothing
    for (const char* n : { "apc.mod.set", "apc.mod.remove", "apc.mod.clear", "apc.midi.learn", "apc.midi.unlearn", "apc.midi.table.get", "apc.midi.table.set", "apc.engine.get", "apc.engine.set" })
        CHECK_EQ (errCode (r.call (n, "{\"patch\":{},\"id\":\"x\"}")), std::string ("unsupported"));
    r.backend.engineGet = [] (const juce::var&) { return t::parseV ("{\"oversampling\":2}"); };
    r.backend.engineSet = [] (const juce::var& patch) { return patch; };
    CHECK_EQ ((int) pu::getNum (r.call ("apc.engine.get"), "oversampling"), 2);           // hooks are read lazily
    CHECK_EQ ((int) pu::getNum (r.call ("apc.engine.set", "{\"patch\":{\"voices\":4}}"), "voices"), 4);
    CHECK_EQ (errCode (r.call ("apc.engine.set", "{}")), std::string ("invalid"));
}

TEST (bridge_param_events_and_dirty_origin)
{
    BridgeRig r ("bridge_param_events");
    CHECK (r.store->load ("snd_00000000-0000-4000-8000-000000000011").ok);
    r.pump();
    r.events.clear();
    // preset-apply changes (userOriginated=false) update the UI but must not mark the preset dirty
    r.params.pending.emplace_back ("filter_cutoff_hz", 95.5, false);
    r.bridge->pollNow();
    r.pump();
    CHECK_EQ (r.countEvents ("param"), 1);
    CHECK (! r.store->isDirty());
    // a host-automation / UI change does
    r.params.pending.emplace_back ("filter_cutoff_hz", 400.0, true);
    r.bridge->pollNow();
    r.pump();
    CHECK_EQ (r.countEvents ("param"), 2);
    CHECK (r.store->isDirty());
    juce::var lastParam;
    for (auto& ev : r.events) if (ev.first == "param") lastParam = ev.second;
    CHECK_EQ (pu::getStr (lastParam, "id"), std::string ("filter_cutoff_hz"));
    CHECK_EQ (pu::getNum (lastParam, "value"), 400.0);
    CHECK (r.countEvents ("preset") >= 1);   // dirty transition is announced

    r.bridge->emitMeter ("out_l", 0.5);
    r.bridge->emitError ("boom", "detail", "unit-test");
    r.pump();
    CHECK_EQ (pu::getNum (r.events[r.events.size() - 2].second, "value"), 0.5);
    CHECK_EQ (r.events.back().first, std::string ("error"));
    CHECK_EQ (pu::getStr (r.events.back().second, "source"), std::string ("unit-test"));

    // events from another thread are marshalled through `post`, not delivered on the caller
    std::thread th ([&] { r.bridge->emitMeter ("t", 1.0); });
    th.join();
    const int before = (int) r.events.size();
    CHECK_EQ ((int) r.events.size(), before);   // nothing yet: queued
    r.pump();
    CHECK_EQ ((int) r.events.size(), before + 1);

    // after shutdown nothing is delivered and nothing crashes
    r.bridge->shutdown();
    r.bridge->emitMeter ("late", 2.0);
    r.pump();
    CHECK_EQ ((int) r.events.size(), before + 1);
}

TEST (bridge_presets_end_to_end)
{
    BridgeRig r ("bridge_presets");
    const auto st0 = r.call ("apc.presets.state");
    CHECK_EQ (pu::getStr (st0, "loadBehavior"), std::string ("confirm-if-dirty"));
    CHECK (pu::has (st0, "current") && pu::has (st0, "ab"));

    const auto list = r.call ("apc.presets.list", "{\"scope\":\"sounds\",\"filters\":{\"category\":\"bass\"},\"search\":\"\",\"sort\":\"name\"}");
    CHECK_EQ ((int) pu::getNum (list, "total"), 1);
    const std::string id = pu::getStr ((*pu::get (list, "items").getArray())[0], "id");

    r.events.clear();
    const auto load = r.call ("apc.presets.load", ("{\"id\":\"" + id + "\"}").c_str());
    CHECK (! isError (load));
    CHECK_EQ (pu::getStr (pu::get (load, "current"), "name"), std::string ("Sub Distort"));          // flat presetState() shape + report fields
    CHECK (pu::get (pu::get (load, "current"), "missing").isArray());
    CHECK_EQ (r.live.num ("filter_cutoff_hz"), 95.5);
    r.pump();
    CHECK (r.countEvents ("preset") >= 1);                         // `preset` event follows a load
    CHECK_EQ (errCode (r.call ("apc.presets.load", "{\"id\":\"nope\"}")), std::string ("not_found"));

    // settings drive loadBehavior
    CHECK (! isError (r.call ("apc.settings.set", "{\"patch\":{\"ui\":{\"preset_load\":\"instant\"}}}")));
    CHECK_EQ (pu::getStr (r.call ("apc.presets.state"), "loadBehavior"), std::string ("instant"));

    // rate/favorite
    const auto rate = r.call ("apc.presets.rate", ("{\"id\":\"" + id + "\",\"stars\":4}").c_str());
    CHECK_EQ ((int) pu::getNum (rate, "rating"), 4);
    CHECK_EQ (errCode (r.call ("apc.presets.rate", ("{\"id\":\"" + id + "\",\"stars\":9}").c_str())), std::string ("invalid"));
    CHECK_EQ (errCode (r.call ("apc.presets.rate", ("{\"id\":\"" + id + "\"}").c_str())), std::string ("invalid"));
    CHECK (pu::getBool (r.call ("apc.presets.favorite", ("{\"id\":\"" + id + "\",\"on\":true}").c_str()), "favorite"));
    CHECK_EQ ((int) pu::getNum (r.call ("apc.presets.list", "{\"filters\":{\"favorite\":true}}"), "total"), 1);

    // save: COW from the factory asset; response carries the new state, not an absolute path
    r.live.user ("filter_cutoff_hz", 640.0);
    const auto saved = r.call ("apc.presets.save", "{\"name\":\"\",\"pack\":\"\",\"kind\":\"sound\",\"meta\":{\"desc\":\"edited\"}}");
    CHECK (! isError (saved));
    CHECK (pu::getBool (saved, "copiedFromReadOnly"));
    CHECK_EQ (pu::getStr (saved, "file"), std::string ("Sub Distort.snd"));
    CHECK (pu::getBool (saved, "ok"));
    CHECK (pu::getStr (saved, "path").size() > 10);
    CHECK_EQ (pu::getStr (pu::get (t::parseV (t::slurp (r.layout.presets / "User/sounds/Sub Distort.snd")), "meta"), "desc"), std::string ("edited"));

    // license gate surfaces as { error:"gated", verb } (UI opens the activation sheet), nothing is written
    r.allowSave = false;
    const auto gated = r.call ("apc.presets.save", "{\"name\":\"Nope\",\"saveAs\":true,\"kind\":\"sound\"}");
    CHECK_EQ (errCode (gated), std::string ("gated"));
    CHECK_EQ (pu::getStr (gated, "verb"), std::string ("PresetSave"));
    CHECK (! t::exists (r.layout.presets / "User/sounds/Nope.snd"));
    CHECK_EQ (errCode (r.call ("apc.presets.import", "{\"data\":\"{}\"}")), std::string ("gated"));
    CHECK_EQ (pu::getStr (r.call ("apc.presets.import", "{\"data\":\"{}\"}"), "verb"), std::string ("PackInstall"));
    CHECK_EQ (pu::getStr (r.call ("apc.presets.exportPack", ("{\"ids\":[\"" + id + "\"]}").c_str()), "verb"), std::string ("PackExport"));
    r.allowSave = true;

    // export / import through worker lanes (completion arrives from another thread)
    const auto ex = r.call ("apc.presets.exportPack", ("{\"ids\":[\"" + id + "\"],\"name\":\"Pack A\"}").c_str());
    CHECK (! isError (ex));
    CHECK_EQ (pu::getStr (ex, "file"), std::string ("Pack A.zip"));
    CHECK_EQ ((int) pu::getNum (ex, "count"), 1);
    const auto im = r.call ("apc.presets.import", ("{\"path\":" + pu::toJsonText (juce::var (pu::js (pu::getStr (ex, "path"))), true) + "}").c_str());
    CHECK (! isError (im));
    CHECK_EQ ((int) pu::getNum (im, "imported"), 1);                       // a count, like the mock
    CHECK_EQ ((int) pu::get (im, "items").getArray()->size(), 1);
    CHECK_EQ (errCode (r.call ("apc.presets.import", "{}")), std::string ("invalid"));

    // A/B, init, revert, rescan, openFolder
    CHECK_EQ (pu::getStr (pu::get (r.call ("apc.presets.ab", "{\"action\":\"toggle\"}"), "ab"), "active"), std::string ("B"));
    CHECK_EQ (errCode (r.call ("apc.presets.ab", "{\"action\":\"zzz\"}")), std::string ("invalid"));
    // INIT is the compiled-in "init" asset (the UI keys off id === "init" to route Save to Save As)
    CHECK (! isError (r.call ("apc.presets.init")));
    CHECK_EQ (pu::getStr (pu::get (r.call ("apc.presets.state"), "current"), "id"), std::string ("init"));
    CHECK (pu::getBool (pu::get (r.call ("apc.presets.state"), "current"), "readOnly"));
    CHECK (! isError (r.call ("apc.presets.init")));
    CHECK_EQ (r.live.num ("filter_cutoff_hz"), 1000.0);
    CHECK (! isError (r.call ("apc.presets.revert")));
    const auto rs = r.call ("apc.presets.rescan");
    CHECK (pu::getNum (rs, "total") >= 7);
    CHECK_EQ ((int) pu::getNum (rs, "count"), (int) pu::getNum (rs, "total"));
    CHECK (pu::getStr (rs, "builtAt").size() >= 20);
    // Settings -> Presets & Data
    const auto info = r.call ("apc.presets.info");
    CHECK_EQ (pu::getStr (info, "hierarchy"), std::string ("typed"));
    CHECK (pu::getNum (info, "assets") >= 7);
    CHECK (pu::getStr (info, "root").find ("presets") != std::string::npos);
    CHECK_EQ (pu::getStr (info, "factoryInstall"), std::string ("user-folder"));
    bool sawFactoryRo = false, userWritable = false;
    for (const auto& p : *pu::get (info, "packs").getArray())
    {
        if (pu::getStr (p, "name") == "Typed_Factory") sawFactoryRo = pu::getBool (p, "readOnly");
        if (pu::getStr (p, "name") == "User") userWritable = ! pu::getBool (p, "readOnly");
    }
    CHECK (sawFactoryRo);
    CHECK (userWritable);
    bool writableHasUser = false;
    for (const auto& w : *pu::get (info, "writablePacks").getArray()) writableHasUser = writableHasUser || pu::ss (w.toString()) == "User";
    CHECK (writableHasUser);
    CHECK_EQ (errCode (r.call ("apc.presets.restoreFactory")), std::string ("no_factory_source"));
    // list items carry what the browser draws: missing[] names, readOnly, and the author inside meta
    const auto lst = r.call ("apc.presets.list", "{\"scope\":\"sounds\",\"search\":\"glass\"}");
    const auto first = (*pu::get (lst, "items").getArray())[0];
    CHECK (pu::get (first, "missing").isArray());
    CHECK_EQ (pu::getStr (pu::get (first, "meta"), "author"), std::string ("Fixture Author"));
    CHECK ((int) pu::getNum (lst, "totalAll") >= 7);
    r.call ("apc.presets.openFolder");
    CHECK_EQ ((int) r.revealed.size(), 1);
    CHECK (r.revealed[0].find ("presets") != std::string::npos);
}

TEST (bridge_open_url_allow_list)
{
    const std::map<std::string, std::string> links = { { "company", "https://acme.example/" }, { "product", "https://acme.example/demo-synth" }, { "docs", "https://docs.acme.example" }, { "empty", "" } };
    CHECK (urlAllowed ("https://acme.example/", links));
    CHECK (urlAllowed ("https://acme.example/pricing?x=1", links));
    CHECK (urlAllowed ("https://acme.example/demo-synth", links));
    CHECK (urlAllowed ("https://acme.example/demo-synth/manual#top", links));
    CHECK (urlAllowed ("https://docs.acme.example/page", links));
    CHECK (urlAllowed ("https://docs.acme.example?a=b", links));
    CHECK (! urlAllowed ("https://acme.example.evil.test/", links));         // host-prefix trick
    CHECK (! urlAllowed ("https://docs.acme.example.evil.test", links));
    CHECK (urlAllowed ("https://acme.example/demo-synthesizer", links));      // sub-path of the company root link: allowed
    const std::map<std::string, std::string> only = { { "product", "https://acme.example/demo-synth" } };
    CHECK (! urlAllowed ("https://acme.example/demo-synthesizer", only));      // path-prefix trick against a link WITHOUT trailing slash
    CHECK (urlAllowed ("https://acme.example/demo-synth/manual", only));
    CHECK (! urlAllowed ("http://acme.example/", links));                     // https only
    CHECK (! urlAllowed ("javascript:alert(1)", links));
    CHECK (! urlAllowed ("file:///C:/Windows/System32/calc.exe", links));
    CHECK (! urlAllowed ("https://acme.example/ x", links));                  // whitespace
    CHECK (! urlAllowed ("https://acme.example/\nx", links));
    CHECK (! urlAllowed ("", links));
    CHECK (! urlAllowed ("https://evil.test/", links));
    CHECK (! urlAllowed ("https://acme.example/", {}));                       // nothing configured -> nothing opens

    BridgeRig r ("bridge_url");
    CHECK (! isError (r.call ("apc.openUrl", "{\"url\":\"https://acme.example/\"}")));
    CHECK_EQ ((int) r.opened.size(), 1);
    CHECK_EQ (errCode (r.call ("apc.openUrl", "{\"url\":\"https://evil.test/\"}")), std::string ("url_not_allowed"));
    CHECK_EQ (errCode (r.call ("apc.openUrl", "{}")), std::string ("url_not_allowed"));
    CHECK_EQ ((int) r.opened.size(), 1);          // blocked links never reach the launcher; nothing auto-launches
    CHECK_EQ (errCode (r.call ("apc.openUrl", "{\"url\":\"https://docs.acme.example\"}")), std::string (""));
    r.backend.openUrl = [] (const std::string&) { return false; };
    CHECK_EQ (errCode (r.call ("apc.openUrl", "{\"url\":\"https://acme.example/\"}")), std::string ("open_failed"));
}

TEST (bridge_settings_get_set_merge)
{
    BridgeRig r ("bridge_settings");
    const auto s0 = r.call ("apc.settings.get");
    CHECK_EQ (pu::getStr (s0, "schema"), std::string ("apc-settings/1.0"));
    auto s1 = r.call ("apc.settings.set", "{\"patch\":{\"ui\":{\"theme\":\"day\",\"scale\":1.25,\"tooltips\":false},\"engine\":{\"oversampling\":4}}}");
    CHECK (! isError (s1));
    CHECK_EQ (pu::getStr (pu::get (s1, "ui"), "theme"), std::string ("day"));
    CHECK_EQ (pu::getNum (pu::get (s1, "ui"), "scale"), 1.25);
    CHECK_EQ (pu::getBool (pu::get (s1, "ui"), "tooltips", true), false);
    CHECK_EQ ((int) pu::getNum (pu::get (s1, "engine"), "oversampling"), 4);
    // a second patch merges instead of replacing; unknown keys survive
    CHECK (! isError (r.call ("apc.settings.set", "{\"patch\":{\"ui\":{\"theme\":\"night\"},\"future\":{\"x\":[1,2,3]}}}")));
    const auto s2 = r.call ("apc.settings.get");
    CHECK_EQ (pu::getStr (pu::get (s2, "ui"), "theme"), std::string ("night"));
    CHECK_EQ (pu::getNum (pu::get (s2, "ui"), "scale"), 1.25);
    CHECK_EQ ((int) pu::get (pu::get (s2, "future"), "x").getArray()->size(), 3);
    CHECK (pu::get (pu::get (s2, "engine"), "oversampling").isInt() || pu::get (pu::get (s2, "engine"), "oversampling").isInt64());
    // on disk
    CHECK_EQ (pu::getStr (pu::get (t::parseV (t::slurp (r.layout.settingsFile)), "ui"), "theme"), std::string ("night"));
    // rejected patches
    CHECK_EQ (errCode (r.call ("apc.settings.set", "{\"patch\":{\"schema\":\"x\"}}")), std::string ("invalid"));
    CHECK_EQ (errCode (r.call ("apc.settings.set", "{\"patch\":{\"a.b\":1}}")), std::string ("invalid"));
    CHECK_EQ (errCode (r.call ("apc.settings.set", "{\"patch\":5}")), std::string ("invalid"));
    CHECK_EQ (errCode (r.call ("apc.settings.set", "{}")), std::string ("invalid"));
    CHECK_EQ (pu::getStr (r.call ("apc.ui.getPrefs"), "theme"), std::string ("night"));
    // damaged file -> visible warning event, not a silent reset
    t::writeText (r.layout.settingsFile, "{ broken");
    r.events.clear();
    r.settings->refreshIfChanged();
    r.call ("apc.settings.set", "{\"patch\":{\"ui\":{\"theme\":\"day\"}}}");
    r.pump();
    CHECK (r.countEvents ("error") >= 1);
    CHECK_EQ (pu::getStr (r.events.back().second, "source"), std::string ("settings"));
    // setScale
    CHECK_EQ (errCode (r.call ("apc.ui.setScale", "{\"scale\":99}")), std::string ("invalid"));
    CHECK_EQ (errCode (r.call ("apc.ui.setScale", "{\"scale\":1.5}")), std::string ("unsupported"));
    double got = 0;
    r.backend.setScale = [&got] (const juce::var& a) { got = pu::getNum (a, "scale"); auto o = pu::newObject(); pu::set (o, "scale", got); return o; };
    CHECK (! isError (r.call ("apc.ui.setScale", "{\"scale\":1.5}")));
    CHECK_EQ (got, 1.5);
}

TEST (bridge_license_glue)
{
    BridgeRig r ("bridge_license");
    CHECK_EQ (pu::getStr (r.call ("apc.license.status"), "state"), std::string ("DEMO"));
    CHECK_EQ (pu::getStr (r.call ("apc.license.status"), "mode"), std::string ("signed-file"));
    CHECK (pu::getStr (r.call ("apc.license.status"), "message").size() > 5);

    // a tampered license is rejected: visible error, state unchanged, nothing written
    auto bad = makeLicense();
    bad.replace (bad.find ("Ada"), 3, "Eve");
    const auto rej = r.call ("apc.license.loadFile", ("{\"text\":" + pu::toJsonText (juce::var (pu::js (bad)), true) + "}").c_str());
    CHECK_EQ (errCode (rej), std::string ("unverified"));
    CHECK (! pu::getStr (rej, "message").empty());
    CHECK_EQ (pu::getStr (r.call ("apc.license.status"), "state"), std::string ("DEMO"));
    CHECK (! t::exists (r.layout.licenseFile));

    r.events.clear();
    const auto ok = r.call ("apc.license.loadFile", ("{\"text\":" + pu::toJsonText (juce::var (pu::js (makeLicense())), true) + "}").c_str());
    CHECK (! isError (ok));
    CHECK_EQ (pu::getStr (ok, "state"), std::string ("LICENSED"));
    CHECK_EQ (pu::getStr (ok, "name"), std::string ("Ada Lovelace"));
    CHECK_EQ ((int) pu::getNum (ok, "seats"), 3);
    CHECK (t::exists (r.layout.licenseFile));
    CHECK (r.waitEvent ("license", [] (const juce::var& v) { return pu::getStr (v, "state") == "LICENSED"; }));
    CHECK_EQ (errCode (r.call ("apc.license.loadFile", "{\"text\":\"\"}")), std::string ("invalid"));

    // online activation: no hook -> not-configured; hook -> signed text re-verified locally
    CHECK_EQ (pu::getStr (r.call ("apc.license.deactivate"), "state"), std::string ("DEMO"));
    CHECK (! t::exists (r.layout.licenseFile));
    CHECK_EQ (errCode (r.call ("apc.license.activate", "{\"serial\":\"AAAAA-BBBBB\"}")), std::string ("unsupported"));
    std::string seenSerial;
    r.backend.license.activateOnline = [&seenSerial] (const std::string& serial, const std::string&)
    {
        seenSerial = serial;
        OnlineReply rep;
        if (serial == "BAD") { rep.errorCode = "invalid_serial"; rep.message = "That serial number is not valid."; return rep; }
        rep.ok = true; rep.licenseText = makeLicense();
        return rep;
    };
    CHECK_EQ (errCode (r.call ("apc.license.activate", "{\"serial\":\"\"}")), std::string ("invalid"));
    const auto bad2 = r.call ("apc.license.activate", "{\"serial\":\"BAD\"}");
    CHECK_EQ (errCode (bad2), std::string ("invalid_serial"));
    CHECK_EQ (pu::getStr (bad2, "message"), std::string ("That serial number is not valid."));
    const auto act = r.call ("apc.license.activate", "{\"serial\":\"GOOD-1\",\"email\":\"a@b.test\"}");
    CHECK_EQ (pu::getStr (act, "state"), std::string ("LICENSED"));
    CHECK_EQ (seenSerial, std::string ("GOOD-1"));
    // the issuer is untrusted: an invalid license from the "server" is refused by the local check
    r.call ("apc.license.deactivate");
    r.backend.license.activateOnline = [] (const std::string&, const std::string&) { OnlineReply rep; rep.ok = true; rep.licenseText = makeLicense ("OtherProduct"); return rep; };
    CHECK_EQ (errCode (r.call ("apc.license.activate", "{\"serial\":\"X\"}")), std::string ("unverified"));
    CHECK_EQ (pu::getStr (r.call ("apc.license.status"), "state"), std::string ("DEMO"));
    // offline request
    CHECK_EQ (errCode (r.call ("apc.license.offlineRequest")), std::string ("unsupported"));
    r.backend.license.offlineRequest = [] { return std::string ("REQ-CODE-123"); };
    CHECK_EQ (pu::getStr (r.call ("apc.license.offlineRequest"), "requestCode"), std::string ("REQ-CODE-123"));
}

TEST (bridge_update_glue_never_blocks_message_thread)
{
    BridgeRig r ("bridge_update");
    const auto st = r.call ("apc.update.state");
    CHECK_EQ (pu::getStr (st, "state"), std::string ("Idle"));
    CHECK_EQ (pu::getStr (st, "current"), std::string ("1.2.3"));
    // download without a prior check: refused with a reason
    CHECK_EQ (errCode (r.call ("apc.update.download")), std::string ("invalid_state"));
    CHECK_EQ (errCode (r.call ("apc.update.revealInstaller")), std::string ("invalid_state"));
    // check: answers at once ("Checking"); the result arrives as events from the worker lane
    r.events.clear();
    const auto t0 = std::chrono::steady_clock::now();
    const auto chk = r.call ("apc.update.check");
    CHECK_EQ (pu::getStr (chk, "state"), std::string ("Checking"));
    CHECK (std::chrono::steady_clock::now() - t0 < std::chrono::seconds (2));
    CHECK (r.waitEvent ("update", [] (const juce::var& v) { return pu::getStr (v, "state") == "Failed"; }));
    bool sawMessage = false;
    for (auto& e : r.events) if (e.first == "update" && pu::getStr (e.second, "state") == "Failed") sawMessage = ! pu::getStr (e.second, "error").empty();
    CHECK (sawMessage);   // a failed state always carries a user-presentable message
    CHECK_EQ (pu::getStr (r.call ("apc.update.state"), "state"), std::string ("Failed"));
    // shutdown with a worker alive must not hang or crash
    r.bridge->shutdown();
}

TEST (bridge_diagnostics_are_local_and_redacted)
{
    BridgeRig r ("bridge_diag");
    const std::string home = pu::ss (juce::File::getSpecialLocation (juce::File::userHomeDirectory).getFullPathName());
    const std::string user = pu::ss (juce::SystemStats::getLogonName());
    r.backend.diagnosticsExtra = [&] { return "2026-11-08T12:00:00Z [warn] failed to read " + home + "\\Documents\\song.wav for user " + user + " key=AAAA-BBBB"; };
    const auto d = r.call ("apc.diagnostics.copy");
    const std::string text = pu::getStr (d, "text");
    CHECK (text.find ("Demo Synth v1.2.3") != std::string::npos);
    CHECK (text.find ("nothing was sent anywhere") != std::string::npos);
    CHECK (text.find ("License: DEMO") != std::string::npos);
    CHECK (text.find ("Update: Idle") != std::string::npos);
    if (home.size() > 3) CHECK (text.find (home) == std::string::npos);
    if (user.size() > 2) CHECK (text.find (user) == std::string::npos);
    CHECK (text.find ("<redacted>") != std::string::npos);
    CHECK (text.size() < 16 * 1024 + 64);
    // the redactor on hostile input
    CHECK_EQ (redact ("C:\\Users\\bob\\x and C:/Users/bob/y", { "C:\\Users\\bob" }), std::string ("<redacted>\\x and <redacted>/y"));
    CHECK_EQ (redact ("abc", { "", "a" }), std::string ("abc"));   // too-short needles are ignored (no accidental mangling)
    // license text never appears (state name only)
    r.call ("apc.license.loadFile", ("{\"text\":" + pu::toJsonText (juce::var (pu::js (makeLicense())), true) + "}").c_str());
    const std::string d2 = pu::getStr (r.call ("apc.diagnostics.copy"), "text");
    CHECK (d2.find ("License: LICENSED") != std::string::npos);
    CHECK (d2.find ("Ada") == std::string::npos);
    CHECK (d2.find ("ada@example.test") == std::string::npos);
    CHECK (d2.find ("ORD-1") == std::string::npos);
}

TEST (param_table_is_the_single_help_source)
{
    const auto tab = ParamTable::fromJsonText (R"({
        "cutoff_hz": { "name": "Cutoff", "unit": "Hz", "group": "Filter", "midiCc": 74,
                       "help": { "what": "w", "effect": "e", "how": "h" } },
        "gain_db":   { "help": { "what": "w", "effect": "", "how": "h" } },
        "mix":       { "normalized": true, "help": { "what": "w", "effect": "e", "how": "h" } } })");
    CHECK (tab.ok);
    CHECK_EQ ((int) tab.value.size(), 3);
    CHECK_EQ (tab.value.find ("cutoff_hz")->midiCc.value_or (-1), 74);
    CHECK (tab.value.find ("mix")->normalized);
    CHECK_EQ (tab.value.missingHelp ({ "cutoff_hz", "gain_db", "mix", "resonance" }), (std::vector<std::string> { "gain_db", "resonance" }));
    CHECK (! ParamTable::fromJsonText ("[1]").ok);
    CHECK (! ParamTable::fromJsonText ("{oops").ok);
    ParamDescriptor d;
    d.id = "x"; d.help = { "a", "b", "c" };
    const auto v = d.toVar();
    CHECK_EQ (pu::getStr (pu::get (v, "help"), "how"), std::string ("c"));
    CHECK (pu::get (v, "midiCc").isVoid());
}

TEST (json_value_var_conversion_roundtrip)
{
    auto v = t::parseV (R"({"a":1,"b":2.5,"c":"s","d":[1,"x",null,true],"e":{"f":false},"g":null,"big":9007199254740991})");
    const auto j = toJson (v);
    CHECK (j.find ("a")->isInt());
    CHECK (j.find ("b")->isDouble());
    CHECK (j.find ("d")->at (3).isBool());
    CHECK (j.find ("g")->isNull());
    const auto back = toVar (j);
    CHECK_EQ (pu::toJsonText (toVar (toJson (back)), true), pu::toJsonText (toVar (j), true));
    CHECK_EQ (pu::getNum (back, "b"), 2.5);
    CHECK_EQ ((juce::int64) back.getProperty ("big", 0), (juce::int64) 9007199254740991LL);
}
