// ApcWebBridge.h - native side of the APC WebView UI kit: every JS -> C++ function of
// templates/webview/apc-ui/CONTRACT.md plus the C++ -> JS events, for JUCE 9.
//
// Needs juce_core + juce_events (the dispatcher, workers and events) and, only for addApcNativeFunctions() /
// attach(), juce_gui_extra (WebBrowserComponent). The dispatcher itself has NO WebView dependency, so it is
// unit-tested headless (common/apc/tests/juce). Parameter access lives in ApcApvtsParams.h (juce_audio_processors).
//
// WIRING (see .agents/guides/ui-kit-native.md for the full walk-through)
//
//   processor (outlives every editor):            editor (member order: relays -> ApcBridge -> webView -> attachments):
//     ApcBackend backend;  // you fill it          apc::web::ApcBridge apcBridge { audioProcessor.backend };
//                                                  webView = std::make_unique<juce::WebBrowserComponent> (
//                                                      apc::web::addApcNativeFunctions (juce::WebBrowserComponent::Options()...,
//                                                                                       apcBridge));
//                                                  webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
//                                                  apcBridge.attach (*webView);   // AFTER goToURL
//
// WIRE FORMAT (binding for apc-bridge.js)
//   * JS calls  APC.bridge.call ("apc.x.y", argsObject)  ->  native function "apc.x.y" with ONE parameter (the object).
//   * Success: the value shaped exactly as CONTRACT.md says.
//   * Failure: { error: "<code>", message: "<text>", path?: "<file>" }. `{error:"gated"}` = license gate (L-02).
//     A failed CALL never also emits an `error` event (the JS bridge shows it); `error` events are for UNSOLICITED
//     failures (a worker thread, a failed async rescan, an update that went wrong in the background).
//   * Events: C++ emits "apc.<name>" via emitEventIfBrowserIsVisible: param preset license update meter error.
//   * Choice parameters travel as their INDEX (descriptor.choices has the labels); preset FILES store labels.
//
// THREADING
//   * Native-function callbacks run on the message thread (JUCE guarantees it). Handlers that can block (rescan,
//     import/export, license activation, update check/download) hop to a worker "lane" and complete later - the
//     completion callback may be called from any thread. The message thread never waits for the network.
//   * emit() may be called from any thread; delivery is marshalled to the message thread via ApcBackend::post.
//   * Call shutdown() (or destroy the bridge) before the stores it points at are destroyed. The editor owns the
//     bridge, so it dies first.
#pragma once

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#if JUCE_MODULE_AVAILABLE_juce_gui_extra
 #include <juce_gui_extra/juce_gui_extra.h>
#endif

#include "../ApcLicense.h"
#include "../ApcSettingsStore.h"
#include "../ApcUpdateFlow.h"
#include "ApcPresetStore.h"

#include <condition_variable>
#include <deque>
#include <optional>
#include <thread>

namespace apc::web
{
namespace pu = apc::presets::util;
using apc::presets::Error;
using apc::presets::Result;
using apc::presets::Status;
using Completion = std::function<void (juce::var)>;
using Handler = std::function<void (const juce::Array<juce::var>&, Completion)>;
using Hook = std::function<juce::var (const juce::var& args)>;   // plugin-provided; return value or an error object

// =============================================================================================
//  JsonValue (settings store) <-> juce::var
// =============================================================================================
inline juce::var toVar (const apc::JsonValue& v)
{
    switch (v.type())
    {
        case apc::JsonValue::Type::Null: return juce::var();
        case apc::JsonValue::Type::Bool: return juce::var (v.asBool());
        case apc::JsonValue::Type::Int: return juce::var ((juce::int64) v.asInt());
        case apc::JsonValue::Type::Double: return juce::var (v.asDouble());
        case apc::JsonValue::Type::String: return juce::var (pu::js (v.asString()));
        case apc::JsonValue::Type::Array:
        {
            auto a = pu::newArray();
            for (std::size_t i = 0; i < v.size(); ++i) pu::push (a, toVar (v.at (i)));
            return a;
        }
        case apc::JsonValue::Type::Object:
        {
            auto o = pu::newObject();
            for (std::size_t i = 0; i < v.size(); ++i) pu::set (o, v.keyAt (i).c_str(), toVar (v.valueAt (i)));
            return o;
        }
    }
    return juce::var();
}

inline apc::JsonValue toJson (const juce::var& v)
{
    if (v.isVoid() || v.isUndefined()) return apc::JsonValue();
    if (v.isBool()) return apc::JsonValue ((bool) v);
    if (v.isInt() || v.isInt64()) return apc::JsonValue ((std::int64_t) (juce::int64) v);
    if (v.isDouble()) return apc::JsonValue ((double) v);
    if (v.isString()) return apc::JsonValue (pu::ss (v.toString()));
    if (const auto* a = v.getArray())
    {
        auto out = apc::JsonValue::array();
        for (const auto& x : *a) out.push (toJson (x));
        return out;
    }
    if (auto* d = v.getDynamicObject())
    {
        auto out = apc::JsonValue::object();
        for (const auto& p : d->getProperties()) out.set (pu::ss (p.name.toString()), toJson (p.value));
        return out;
    }
    return apc::JsonValue();
}

// =============================================================================================
//  Parameter descriptors - ONE source table for help text
// =============================================================================================
struct ParamHelp { std::string what, effect, how; };

struct ParamMeta
{
    std::string name, unit, group;      // overrides; empty = take them from the parameter itself
    ParamHelp help;                     // the ONLY place help text is written (tooltip, info bar, F1 and the context panel read it)
    std::optional<int> midiCc;
    bool normalized = false;            // value travels 0..1 (descriptor says so)
};

// Author this once (e.g. Design/param-help.json embedded as BinaryData) - JSON form:
//   { "cutoff_hz": { "name":"Cutoff", "unit":"Hz", "group":"Filter", "midiCc":74,
//                    "help": { "what":"...", "effect":"...", "how":"..." } }, ... }
class ParamTable
{
public:
    void set (const std::string& id, ParamMeta m) { byId_[id] = std::move (m); }
    const ParamMeta* find (const std::string& id) const { const auto it = byId_.find (id); return it == byId_.end() ? nullptr : &it->second; }
    std::size_t size() const { return byId_.size(); }

    static Result<ParamTable> fromVar (const juce::var& v)
    {
        auto* d = v.getDynamicObject();
        if (d == nullptr) return Result<ParamTable>::fail ("invalid", "The parameter help table must be a JSON object keyed by parameter id.");
        ParamTable t;
        for (const auto& p : d->getProperties())
        {
            ParamMeta m;
            m.name = pu::getStr (p.value, "name");
            m.unit = pu::getStr (p.value, "unit");
            m.group = pu::getStr (p.value, "group");
            const auto h = pu::get (p.value, "help");
            m.help = { pu::getStr (h, "what"), pu::getStr (h, "effect"), pu::getStr (h, "how") };
            if (pu::isNumber (pu::get (p.value, "midiCc"))) m.midiCc = (int) pu::getNum (p.value, "midiCc");
            m.normalized = pu::getBool (p.value, "normalized", false);
            t.set (pu::ss (p.name.toString()), std::move (m));
        }
        return Result<ParamTable>::success (std::move (t));
    }
    static Result<ParamTable> fromJsonText (const std::string& text)
    {
        juce::var v;
        std::string err;
        if (! pu::parseJson (text, v, err)) return Result<ParamTable>::fail ("bad_json", "Parameter help table is not valid JSON: " + err);
        return fromVar (v);
    }

    // CI helper: every parameter id must have all three help fields (write it once, here).
    std::vector<std::string> missingHelp (const std::vector<std::string>& ids) const
    {
        std::vector<std::string> out;
        for (const auto& id : ids)
        {
            const auto* m = find (id);
            if (m == nullptr || m->help.what.empty() || m->help.effect.empty() || m->help.how.empty()) out.push_back (id);
        }
        return out;
    }

private:
    std::map<std::string, ParamMeta> byId_;
};

struct ParamDescriptor
{
    std::string id, name, unit, group;
    double min = 0.0, max = 1.0, def = 0.0, value = 0.0;
    std::optional<double> step, skew;
    std::vector<std::string> choices;
    ParamHelp help;
    juce::var modulation;               // array of { src, amount, polarity, min, max, bypass }
    std::optional<int> midiCc;
    bool normalized = false;

    juce::var toVar() const
    {
        auto o = pu::newObject();
        pu::set (o, "id", pu::js (id));
        pu::set (o, "name", pu::js (name));
        pu::set (o, "unit", pu::js (unit));
        pu::set (o, "min", min);
        pu::set (o, "max", max);
        pu::set (o, "default", def);
        pu::set (o, "value", value);
        if (step) pu::set (o, "step", *step);
        if (skew) pu::set (o, "skew", *skew);
        if (! choices.empty())
        {
            auto a = pu::newArray();
            for (const auto& c : choices) pu::push (a, juce::var (pu::js (c)));
            pu::set (o, "choices", a);
        }
        auto h = pu::newObject();
        pu::set (h, "what", pu::js (help.what));
        pu::set (h, "effect", pu::js (help.effect));
        pu::set (h, "how", pu::js (help.how));
        pu::set (o, "help", h);
        if (! group.empty()) pu::set (o, "group", pu::js (group));
        pu::set (o, "modulation", modulation.isArray() ? modulation : pu::newArray());
        pu::set (o, "midiCc", midiCc ? juce::var (*midiCc) : juce::var());
        if (normalized) pu::set (o, "normalized", true);
        return o;
    }
};

// Implemented over an AudioProcessorValueTreeState by ApcApvtsParams.h; anything else is fine too (message thread).
struct IParamAccess
{
    virtual ~IParamAccess() = default;
    virtual std::vector<ParamDescriptor> list() = 0;
    virtual std::optional<ParamDescriptor> get (const std::string& id) = 0;
    virtual Result<double> set (const std::string& id, double value) = 0;   // returns the value that was applied (clamped/quantised)
    virtual Status begin (const std::string& id) = 0;                        // host automation gesture
    virtual Status end (const std::string& id) = 0;
    virtual Result<double> reset (const std::string& id) = 0;                // declared default, base value only
    // Message-thread poll of changes that happened since the last call (UI, host automation, preset load).
    // userOriginated=false for changes the preset store itself applied (they must NOT mark the preset dirty).
    virtual void collectChanged (const std::function<void (const std::string& id, double value, bool userOriginated)>& cb) = 0;
};

// =============================================================================================
//  What the plugin fills
// =============================================================================================
struct OnlineReply
{
    bool ok = false;
    std::string licenseText;   // the signed apc-license/1.0 text the issuer returned (re-verified locally)
    std::string errorCode;     // issuer error code (invalid_serial, seat_limit, ...)
    std::string message;       // user-presentable text
};

struct ApcBackend
{
    struct Info
    {
        std::string product, manufacturer, version, buildDate, frameworkVersion;
        // company, product, docs, support, update. Only configured (non-empty) links are sent AND only these URLs
        // (or sub-paths of them) may ever be opened by apc.openUrl.
        std::map<std::string, std::string> links;
        juce::var features;   // { themeEnabled, helpMode, midiLearnTable, undoRedo, macros, dragModulation, oversampling, autoUpdateCheck, licenseMode, presetHierarchy }
        juce::var standards;  // effective standards values (read-only information)
    } info;

    IParamAccess* params = nullptr;
    apc::presets::Store* presets = nullptr;
    apc::SettingsStore* settings = nullptr;

    // Optional per-plugin features. A null hook answers { error: "unsupported" } - never silently nothing.
    Hook modSet, modRemove, modClear;                      // { id, route } / { id, src } / { id }
    Hook midiLearn, midiUnlearn, midiTableGet, midiTableSet;
    Hook engineGet, engineSet;                             // per-INSTANCE engine state (X-08): lives in the DAW chunk
    Hook setScale;                                         // { scale } -> resize the editor (aspect locked)
    Hook uiPrefs;                                          // null => settings.ui

    struct License
    {
        apc::LicenseManager* manager = nullptr;
        std::filesystem::path licensePath;                 // <AppDataRoot>/license.lic
        std::string mode = "none";                         // none | signed-file | online-activation
        std::function<OnlineReply (const std::string& serial, const std::string& email)> activateOnline;   // WORKER thread, blocking
        std::function<OnlineReply (const std::string& serial)> deactivateOnline;                            // WORKER thread, optional
        std::function<std::string()> offlineRequest;                                                       // returns the request code
    } license;

    apc::UpdateFlow* update = nullptr;

    std::function<std::string()> diagnosticsExtra;         // e.g. the last 50 log lines; redacted by the bridge
    std::function<bool (const std::string& url)> openUrl;  // default: juce::URL::launchInDefaultBrowser (after the allow-list)
    std::function<void (const std::filesystem::path&)> reveal;    // default: juce::File::revealToUser
    std::function<void (std::function<void()>)> post;      // default: MessageManager::callAsync
};

// =============================================================================================
//  Dispatcher
// =============================================================================================
namespace names
{
inline const std::vector<std::string>& all()
{
    static const std::vector<std::string> n = {
        "apc.info", "apc.params.list", "apc.params.get", "apc.param.set", "apc.param.begin", "apc.param.end", "apc.param.reset",
        "apc.mod.set", "apc.mod.remove", "apc.mod.clear",
        "apc.midi.learn", "apc.midi.unlearn", "apc.midi.table.get", "apc.midi.table.set",
        "apc.settings.get", "apc.settings.set", "apc.engine.get", "apc.engine.set",
        "apc.presets.list", "apc.presets.state", "apc.presets.load", "apc.presets.save", "apc.presets.revert", "apc.presets.init",
        "apc.presets.rate", "apc.presets.favorite", "apc.presets.import", "apc.presets.exportPack", "apc.presets.ab",
        "apc.presets.rescan", "apc.presets.openFolder",
        // used by the UI kit (apc-presets.js / apc-settings.js / apc-update-ui.js) and implemented by apc-mock.js, not yet listed in CONTRACT.md:
        "apc.presets.info", "apc.presets.restoreFactory",
        "apc.license.status", "apc.license.activate", "apc.license.loadFile", "apc.license.deactivate", "apc.license.offlineRequest",
        "apc.update.state", "apc.update.check", "apc.update.download", "apc.update.cancel", "apc.update.revealInstaller",
        "apc.openUrl", "apc.ui.setScale", "apc.ui.getPrefs", "apc.diagnostics.copy" };
    return n;
}
} // namespace names

// URL allow-list for apc.openUrl: https only, and only a configured branding link or a sub-path of one.
inline bool urlAllowed (const std::string& url, const std::map<std::string, std::string>& links)
{
    if (url.empty() || url.size() > 2048) return false;
    for (unsigned char c : url) if (c <= 0x20 || c == 0x7F) return false;
    if (url.rfind ("https://", 0) != 0) return false;
    for (const auto& kv : links)
    {
        const std::string& base = kv.second;
        if (base.rfind ("https://", 0) != 0 || base.empty()) continue;
        if (url == base) return true;
        if (url.size() > base.size() && url.compare (0, base.size(), base) == 0)
        {
            const char next = url[base.size()];
            const char last = base.back();
            if (last == '/' || next == '/' || next == '?' || next == '#') return true;
        }
    }
    return false;
}

// Remove user names / home paths from text that leaves via "Copy diagnostics" (X-10).
inline std::string redact (std::string text, const std::vector<std::string>& sensitive)
{
    for (const auto& s : sensitive)
    {
        if (s.size() < 3) continue;
        for (const std::string& variant : { s, [&] { std::string t = s; std::replace (t.begin(), t.end(), '\\', '/'); return t; }() })
        {
            std::size_t pos = 0;
            while ((pos = text.find (variant, pos)) != std::string::npos) { text.replace (pos, variant.size(), "<redacted>"); pos += 10; }
        }
    }
    return text;
}

class ApcBridge
#if JUCE_MODULE_AVAILABLE_juce_events
    : private juce::Timer
#endif
{
public:
    explicit ApcBridge (ApcBackend& b) : backend_ (b), alive_ (std::make_shared<std::atomic<bool>> (true))
    {
        if (! backend_.post)
            backend_.post = [] (std::function<void()> f) { juce::MessageManager::callAsync (std::move (f)); };
        registerAll();
        if (backend_.presets != nullptr)
            storeListener_ = backend_.presets->addListener ([this] (const apc::presets::StateEvent& e)
            {
                if (e.kind == apc::presets::StateEvent::Kind::Preset) emit ("preset", presetEventPayload());
            });
        if (backend_.update != nullptr)
        {
            previousOnChange_ = backend_.update->onChange;
            backend_.update->onChange = [this] (const apc::UpdateStatus& s) { emit ("update", updateStatusVar (s)); };
        }
    }

    ~ApcBridge()
    {
        shutdown();
    }
    ApcBridge (const ApcBridge&) = delete;
    ApcBridge& operator= (const ApcBridge&) = delete;

    // Stop workers and detach from the stores. Idempotent. Call before destroying the stores if the bridge outlives them.
    void shutdown()
    {
        if (down_.exchange (true)) return;
        alive_->store (false);
#if JUCE_MODULE_AVAILABLE_juce_events
        stopTimer();
#endif
        if (backend_.update != nullptr)
        {
            backend_.update->cancel();
            backend_.update->onChange = previousOnChange_;
        }
        if (backend_.presets != nullptr && storeListener_ != 0) backend_.presets->removeListener (storeListener_);
        storeListener_ = 0;
        updateLane_.stop();
        licenseLane_.stop();
        ioLane_.stop();
        std::lock_guard<std::mutex> g (emitMutex_);
        emitter_ = nullptr;
    }

    const std::map<std::string, Handler>& functions() const { return handlers_; }
    bool has (const std::string& name) const { return handlers_.count (name) != 0; }

    // Unknown names complete with { error:"unknown_function" } (JUCE itself would never answer them).
    void invoke (const std::string& name, const juce::Array<juce::var>& args, Completion done)
    {
        const auto it = handlers_.find (name);
        if (it == handlers_.end()) { done (makeErr ("unknown_function", "The plugin has no function \"" + name + "\".")); return; }
        try { it->second (args, std::move (done)); }
        catch (const std::exception& e) { done (makeErr ("internal", std::string ("Internal error in ") + name + ": " + e.what())); }
        catch (...) { done (makeErr ("internal", "Internal error in " + name + ".")); }
    }

    // ---- events (any thread) ----
    void setEmitter (std::function<void (const std::string& event, const juce::var& payload)> fn)
    {
        std::lock_guard<std::mutex> g (emitMutex_);
        emitter_ = std::move (fn);
    }

    void emit (const std::string& event, const juce::var& payload)
    {
        if (down_.load()) return;
        auto alive = alive_;
        backend_.post ([this, alive, event, payload]
        {
            if (! alive->load()) return;
            std::function<void (const std::string&, const juce::var&)> em;
            { std::lock_guard<std::mutex> g (emitMutex_); em = emitter_; }
            if (em) em (event, payload);
        });
    }
    void emitMeter (const std::string& id, double value)
    {
        auto o = pu::newObject();
        pu::set (o, "id", pu::js (id));
        pu::set (o, "value", value);
        emit ("meter", o);
    }
    void emitError (const std::string& message, const std::string& detail, const std::string& source)
    {
        auto o = pu::newObject();
        pu::set (o, "message", pu::js (message));
        if (! detail.empty()) pu::set (o, "detail", pu::js (detail));
        pu::set (o, "source", pu::js (source));
        emit ("error", o);
    }

    // Host-originated parameter changes -> "param" events + dirty tracking. Called by the timer, or manually (tests).
    void pollNow()
    {
        if (backend_.params == nullptr) return;
        backend_.params->collectChanged ([this] (const std::string& id, double value, bool user)
        {
            auto o = pu::newObject();
            pu::set (o, "id", pu::js (id));
            pu::set (o, "value", value);
            emit ("param", o);
            if (user && backend_.presets != nullptr) backend_.presets->notifyParamChanged();
        });
    }

#if JUCE_MODULE_AVAILABLE_juce_events
    void startPolling (int hz = 30) { startTimerHz (hz); }
#endif

#if JUCE_MODULE_AVAILABLE_juce_gui_extra
    // Call AFTER the first goToURL(): on some platforms the JUCE JS side does not exist before that.
    void attach (juce::WebBrowserComponent& browser)
    {
        juce::Component::SafePointer<juce::WebBrowserComponent> safe (&browser);
        setEmitter ([safe] (const std::string& event, const juce::var& payload)
        {
            if (auto* b = safe.getComponent()) b->emitEventIfBrowserIsVisible (juce::Identifier (pu::js ("apc." + event)), payload);
        });
        startPolling();
        kickRescanIfNeeded();
    }
#endif

    // Rescan on a worker when the tree changed (window open).
    void kickRescanIfNeeded()
    {
        if (backend_.presets == nullptr) return;
        ioLane_.post ([this]
        {
            if (down_.load()) return;
            if (backend_.presets->index()->rows.empty() || backend_.presets->treeChanged())
            {
                const auto r = backend_.presets->rescan (false);
                if (! r.ok) emitError (r.error.message, r.error.path, "presets");
                else emit ("preset", presetEventPayload());
            }
        });
    }

    juce::var presetEventPayload() const
    {
        auto s = backend_.presets != nullptr ? backend_.presets->stateVar() : pu::newObject();
        addLoadBehavior (s);
        auto o = pu::newObject();
        pu::set (o, "state", s);
        return o;
    }

private:
    // ---- workers ----
    class Lane
    {
    public:
        ~Lane() { stop(); }
        void post (std::function<void()> job)
        {
            {
                std::lock_guard<std::mutex> g (m_);
                if (stopped_) return;
                if (! thread_.joinable()) thread_ = std::thread ([this] { run(); });
                q_.push_back (std::move (job));
            }
            cv_.notify_one();
        }
        void stop()
        {
            {
                std::lock_guard<std::mutex> g (m_);
                stopped_ = true;
                q_.clear();
            }
            cv_.notify_all();
            if (thread_.joinable()) thread_.join();
        }
    private:
        void run()
        {
            for (;;)
            {
                std::function<void()> job;
                {
                    std::unique_lock<std::mutex> lk (m_);
                    cv_.wait (lk, [this] { return stopped_ || ! q_.empty(); });
                    if (stopped_) return;
                    job = std::move (q_.front());
                    q_.pop_front();
                }
                try { job(); } catch (...) {}
            }
        }
        std::mutex m_;
        std::condition_variable cv_;
        std::deque<std::function<void()>> q_;
        std::thread thread_;
        bool stopped_ = false;
    };

    // ---- helpers ----
    static juce::var makeErr (const std::string& code, const std::string& message, const std::string& path = {})
    {
        return Error { code, message, path }.toVar();
    }
    static juce::var arg0 (const juce::Array<juce::var>& a) { return a.size() > 0 ? a[0] : juce::var(); }

    static juce::var errOrGated (const Error& e, const char* verb)
    {
        if (e.code == "gated")
        {
            auto o = e.toVar();
            pu::set (o, "verb", verb);
            return o;
        }
        return e.toVar();
    }

    void addLoadBehavior (juce::var& state) const
    {
        if (backend_.settings != nullptr)
            pu::set (state, "loadBehavior", pu::js (backend_.settings->getString ("ui.preset_load", "confirm-if-dirty")));
    }

    void add (const std::string& name, Handler h) { handlers_[name] = std::move (h); }
    void addSimple (const std::string& name, std::function<juce::var (const juce::var&)> f)
    {
        add (name, [f = std::move (f)] (const juce::Array<juce::var>& a, Completion c) { c (f (arg0 (a))); });
    }
    // Reads the hook lazily, so it may be assigned any time before the first call.
    void addHook (const std::string& name, Hook ApcBackend::* member, const char* what)
    {
        addSimple (name, [this, member, what] (const juce::var& a) -> juce::var
        {
            const Hook& hook = backend_.*member;
            if (! hook) return makeErr ("unsupported", std::string (what) + " is not available in this plugin.");
            return hook (a);
        });
    }

    static juce::var licenseStatusVar (const apc::LicenseStatus& s, const std::string& mode)
    {
        auto o = pu::newObject();
        pu::set (o, "state", apc::toString (s.state));
        if (! s.customerName.empty()) pu::set (o, "name", pu::js (s.customerName));
        if (s.trialDaysLeft >= 0) pu::set (o, "daysLeft", s.trialDaysLeft);
        if (s.allowedSeats > 0) pu::set (o, "seats", s.allowedSeats);
        pu::set (o, "mode", pu::js (mode));
        pu::set (o, "message", pu::js (s.message));
        if (! s.warning.empty()) pu::set (o, "warning", pu::js (s.warning));
        return o;
    }
    juce::var licenseStatusVar() const
    {
        if (backend_.license.manager == nullptr)
        {
            auto o = pu::newObject();
            pu::set (o, "state", "DEMO");
            pu::set (o, "mode", "none");
            pu::set (o, "message", "No license module is configured.");
            return o;
        }
        return licenseStatusVar (backend_.license.manager->status(), backend_.license.mode);
    }

    static const char* updateErrorName (apc::UpdateError e)
    {
        switch (e)
        {
            case apc::UpdateError::None: return "None";
            case apc::UpdateError::NotConfigured: return "NotConfigured";
            case apc::UpdateError::InsecureUrl: return "InsecureUrl";
            case apc::UpdateError::Network: return "Network";
            case apc::UpdateError::BadManifest: return "BadManifest";
            case apc::UpdateError::UnsupportedSchema: return "UnsupportedSchema";
            case apc::UpdateError::BadSignature: return "BadSignature";
            case apc::UpdateError::WrongProduct: return "WrongProduct";
            case apc::UpdateError::NoArtifactForPlatform: return "NoArtifactForPlatform";
            case apc::UpdateError::DowngradeBlocked: return "DowngradeBlocked";
            case apc::UpdateError::ChecksumMismatch: return "ChecksumMismatch";
            case apc::UpdateError::SizeMismatch: return "SizeMismatch";
            case apc::UpdateError::Io: return "Io";
            case apc::UpdateError::Unexpected: return "Unexpected";
        }
        return "Unexpected";
    }

    static juce::var updateStatusVar (const apc::UpdateStatus& s)
    {
        auto o = pu::newObject();
        pu::set (o, "state", apc::toString (s.state));
        pu::set (o, "current", pu::js (s.currentVersion));
        if (! s.latestVersion.empty()) pu::set (o, "latest", pu::js (s.latestVersion));
        if (! s.notes.empty()) pu::set (o, "notes", pu::js (s.notes));
        if (s.state == apc::UpdateState::Failed || ! s.message.empty()) pu::set (o, "message", pu::js (s.message));
        if (s.state == apc::UpdateState::Failed) pu::set (o, "error", pu::js (updateErrorName (s.error)));   // code; the text is `message`
        if (s.artifactSize > 0 && (s.state == apc::UpdateState::Downloading || s.state == apc::UpdateState::Verifying || s.state == apc::UpdateState::ReadyToInstall))
            pu::set (o, "progress", std::min (1.0, (double) s.bytesDownloaded / (double) s.artifactSize));
        pu::set (o, "automatic", s.automatic);
        return o;
    }

    juce::var needStore() const { return makeErr ("unsupported", "The preset system is not available in this plugin."); }

    juce::var loadReportVar (const apc::presets::LoadReport& r) const
    {
        auto o = backend_.presets->stateVar();     // { current:{...,missing:[names]}, ab, loadBehavior } - exactly presetState()
        addLoadBehavior (o);
        pu::set (o, "applied", (int) r.applied.size());
        pu::set (o, "defaulted", (int) r.defaulted.size());
        auto w = pu::newArray();
        for (const auto& x : r.warnings) pu::push (w, juce::var (pu::js (x)));
        pu::set (o, "warnings", w);
        auto refs = pu::newArray();
        for (const auto& ri : r.refs) if (! ri.usable) pu::push (refs, ri.toVar());
        pu::set (o, "unresolved", refs);
        return o;
    }

    // ---- registration ----
    void registerAll()
    {
        // info -------------------------------------------------------------------------------
        addSimple ("apc.info", [this] (const juce::var&)
        {
            auto o = pu::newObject();
            pu::set (o, "product", pu::js (backend_.info.product));
            pu::set (o, "manufacturer", pu::js (backend_.info.manufacturer));
            pu::set (o, "version", pu::js (backend_.info.version));
            pu::set (o, "buildDate", pu::js (backend_.info.buildDate));
            auto links = pu::newObject();
            for (const auto& kv : backend_.info.links) if (! kv.second.empty()) pu::set (links, kv.first.c_str(), pu::js (kv.second));
            pu::set (o, "links", links);
            pu::set (o, "features", pu::isObject (backend_.info.features) ? backend_.info.features : pu::newObject());
            pu::set (o, "standards", pu::isObject (backend_.info.standards) ? backend_.info.standards : pu::newObject());
            return o;
        });

        // parameters -------------------------------------------------------------------------
        addSimple ("apc.params.list", [this] (const juce::var&) -> juce::var
        {
            if (backend_.params == nullptr) return makeErr ("unsupported", "Parameters are not available.");
            auto a = pu::newArray();
            for (const auto& d : backend_.params->list()) pu::push (a, d.toVar());
            return a;
        });
        addSimple ("apc.params.get", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.params == nullptr) return makeErr ("unsupported", "Parameters are not available.");
            const auto id = pu::getStr (a, "id");
            if (const auto d = backend_.params->get (id)) return d->toVar();
            return makeErr ("unknown_param", "Unknown parameter \"" + id + "\".");
        });
        addSimple ("apc.param.set", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.params == nullptr) return makeErr ("unsupported", "Parameters are not available.");
            const auto v = pu::get (a, "value");
            if (! (pu::isNumber (v) || v.isBool())) return makeErr ("invalid", "apc.param.set needs a numeric value.");
            const double x = v.isBool() ? ((bool) v ? 1.0 : 0.0) : (double) v;
            if (! std::isfinite (x)) return makeErr ("invalid", "The value is not a finite number.");
            const auto r = backend_.params->set (pu::getStr (a, "id"), x);
            if (! r.ok) return r.error.toVar();
            if (backend_.presets != nullptr) backend_.presets->notifyParamChanged();
            auto o = pu::newObject();
            pu::set (o, "value", r.value);
            return o;
        });
        addSimple ("apc.param.begin", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.params == nullptr) return makeErr ("unsupported", "Parameters are not available.");
            const auto r = backend_.params->begin (pu::getStr (a, "id"));
            return r.ok ? pu::newObject() : r.error.toVar();
        });
        addSimple ("apc.param.end", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.params == nullptr) return makeErr ("unsupported", "Parameters are not available.");
            const auto r = backend_.params->end (pu::getStr (a, "id"));
            return r.ok ? pu::newObject() : r.error.toVar();
        });
        addSimple ("apc.param.reset", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.params == nullptr) return makeErr ("unsupported", "Parameters are not available.");
            const auto r = backend_.params->reset (pu::getStr (a, "id"));
            if (! r.ok) return r.error.toVar();
            if (backend_.presets != nullptr) backend_.presets->notifyParamChanged();
            auto o = pu::newObject();
            pu::set (o, "value", r.value);
            return o;
        });
        addHook ("apc.mod.set", &ApcBackend::modSet, "Modulation");
        addHook ("apc.mod.remove", &ApcBackend::modRemove, "Modulation");
        addHook ("apc.mod.clear", &ApcBackend::modClear, "Modulation");
        addHook ("apc.midi.learn", &ApcBackend::midiLearn, "MIDI learn");
        addHook ("apc.midi.unlearn", &ApcBackend::midiUnlearn, "MIDI learn");
        addHook ("apc.midi.table.get", &ApcBackend::midiTableGet, "The MIDI table");
        addHook ("apc.midi.table.set", &ApcBackend::midiTableSet, "The MIDI table");

        // settings / engine ------------------------------------------------------------------
        addSimple ("apc.settings.get", [this] (const juce::var&) -> juce::var
        {
            if (backend_.settings == nullptr) return makeErr ("unsupported", "Settings are not available.");
            backend_.settings->refreshIfChanged();
            auto v = toVar (backend_.settings->snapshot());
            surfaceSettingsWarnings();
            return v;
        });
        addSimple ("apc.settings.set", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.settings == nullptr) return makeErr ("unsupported", "Settings are not available.");
            const auto patch = pu::get (a, "patch");
            if (! pu::isObject (patch)) return makeErr ("invalid", "apc.settings.set needs { patch: { section: { key: value } } }.");
            std::vector<std::pair<std::string, apc::JsonValue>> kv;
            std::string bad;
            flatten ("", patch, 0, kv, bad);
            if (! bad.empty()) return makeErr ("invalid", bad);
            std::string err;
            if (! backend_.settings->setMany (kv, err)) return makeErr ("io", err);
            if (backend_.presets != nullptr) backend_.presets->setLoadBehavior (backend_.settings->getString ("ui.preset_load", "confirm-if-dirty"));
            surfaceSettingsWarnings();
            return toVar (backend_.settings->snapshot());
        });
        addHook ("apc.engine.get", &ApcBackend::engineGet, "Engine settings");
        add ("apc.engine.set", [this] (const juce::Array<juce::var>& a, Completion c)
        {
            if (! backend_.engineSet) { c (makeErr ("unsupported", "Engine settings are not available in this plugin.")); return; }
            const auto patch = pu::get (arg0 (a), "patch");
            if (! pu::isObject (patch)) { c (makeErr ("invalid", "apc.engine.set needs { patch: { ... } }.")); return; }
            const auto r = backend_.engineSet (patch);
            if (backend_.presets != nullptr && ! pu::has (r, "error")) backend_.presets->notifyParamChanged();
            c (r);
        });

        // presets ----------------------------------------------------------------------------
        addSimple ("apc.presets.list", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            auto r = backend_.presets->list (a);
            return r.ok ? r.value : r.error.toVar();
        });
        addSimple ("apc.presets.state", [this] (const juce::var&) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            auto s = backend_.presets->stateVar();
            addLoadBehavior (s);
            return s;
        });
        addSimple ("apc.presets.load", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto r = backend_.presets->load (pu::getStr (a, "id"));
            return r.ok ? loadReportVar (r.value) : r.error.toVar();
        });
        addSimple ("apc.presets.save", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            apc::presets::SaveRequest req;
            req.name = pu::getStr (a, "name");
            req.pack = pu::getStr (a, "pack");
            req.kind = pu::getStr (a, "kind");
            req.meta = pu::get (a, "meta");
            req.saveAs = pu::getBool (a, "saveAs", false);
            req.overwrite = pu::getBool (a, "overwrite", false) || pu::getBool (a, "replace", false);   // "replace": what the UI kit sends
            const auto r = backend_.presets->save (req);
            if (! r.ok) return errOrGated (r.error, "PresetSave");
            auto o = pu::newObject();
            pu::set (o, "ok", true);
            pu::set (o, "id", pu::js (r.value.id));
            pu::set (o, "path", pu::js (r.value.path));
            pu::set (o, "name", pu::js (r.value.name));
            pu::set (o, "pack", pu::js (r.value.pack));
            pu::set (o, "kind", pu::js (r.value.kind));
            pu::set (o, "file", pu::js (pu::pathToUtf8 (pu::pathOf (r.value.path).filename())));
            pu::set (o, "copiedFromReadOnly", r.value.copiedFromReadOnly);
            auto s = backend_.presets->stateVar();
            addLoadBehavior (s);
            pu::set (o, "state", s);
            return o;
        });
        addSimple ("apc.presets.revert", [this] (const juce::var&) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto r = backend_.presets->revert();
            return r.ok ? loadReportVar (r.value) : r.error.toVar();
        });
        addSimple ("apc.presets.init", [this] (const juce::var&) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto r = backend_.presets->init();
            return r.ok ? loadReportVar (r.value) : r.error.toVar();
        });
        addSimple ("apc.presets.rate", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto sv = pu::get (a, "stars");
            if (! pu::isNumber (sv)) return makeErr ("invalid", "Rating must be a number of stars (0..5).");
            const auto r = backend_.presets->setRating (pu::getStr (a, "id"), (int) std::lround ((double) sv));
            return r.ok ? userEntryVar (pu::getStr (a, "id"), r.value) : r.error.toVar();
        });
        addSimple ("apc.presets.favorite", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto r = backend_.presets->setFavorite (pu::getStr (a, "id"), pu::getBool (a, "on", false));
            return r.ok ? userEntryVar (pu::getStr (a, "id"), r.value) : r.error.toVar();
        });
        add ("apc.presets.import", [this] (const juce::Array<juce::var>& args, Completion c)
        {
            if (backend_.presets == nullptr) { c (needStore()); return; }
            const auto a = arg0 (args);
            const std::string path = pu::getStr (a, "path"), pack = pu::getStr (a, "pack");
            std::string data = pu::getStr (a, "data");
            if (pu::getStr (a, "encoding") == "base64" && ! data.empty())   // dropped files arrive as base64 (FileReader.readAsDataURL)
            {
                std::string decoded;
                if (! apc::base64Decode (data, decoded)) { c (makeErr ("invalid", "The dropped file could not be decoded.")); return; }
                data = std::move (decoded);
            }
            if (path.empty() && data.empty()) { c (makeErr ("invalid", "apc.presets.import needs { path } or { data }.")); return; }
            ioLane_.post ([this, c, path, data, pack]
            {
                const auto r = backend_.presets->importAsset (path, data, pack);
                if (! r.ok) { c (errOrGated (r.error, "PackInstall")); return; }
                auto o = pu::newObject();
                auto items = pu::newArray();
                for (const auto& it : r.value.items)
                {
                    auto x = pu::newObject();
                    pu::set (x, "id", pu::js (it.id)); pu::set (x, "name", pu::js (it.name)); pu::set (x, "kind", pu::js (it.kind));
                    pu::set (x, "pack", pu::js (it.pack)); pu::set (x, "idChanged", it.idChanged);
                    pu::push (items, x);
                }
                pu::set (o, "ok", true);
                pu::set (o, "imported", (int) r.value.items.size());      // count (the UI prints "Imported N presets")
                pu::set (o, "items", items);
                pu::set (o, "pack", pu::js (r.value.packFolder));
                if (! r.value.skipped.empty()) pu::set (o, "skipped", pu::js (r.value.skipped));
                auto w = pu::newArray();
                for (const auto& x : r.value.warnings) pu::push (w, juce::var (pu::js (x)));
                pu::set (o, "warnings", w);
                c (o);
                emit ("preset", presetEventPayload());
            });
        });
        add ("apc.presets.exportPack", [this] (const juce::Array<juce::var>& args, Completion c)
        {
            if (backend_.presets == nullptr) { c (needStore()); return; }
            const auto a = arg0 (args);
            std::vector<std::string> ids;
            if (const auto* arr = pu::get (a, "ids").getArray()) for (const auto& x : *arr) if (x.isString()) ids.push_back (pu::ss (x.toString()));
            const std::string title = pu::getStr (a, "name");
            ioLane_.post ([this, c, ids, title]
            {
                const auto r = backend_.presets->exportPack (ids, title);
                if (! r.ok) { c (errOrGated (r.error, "PackExport")); return; }
                auto o = pu::newObject();
                pu::set (o, "ok", true);
                pu::set (o, "count", (int) ids.size());
                pu::set (o, "path", pu::js (r.value));
                pu::set (o, "file", pu::js (pu::pathToUtf8 (pu::pathOf (r.value).filename())));
                c (o);
            });
        });
        addSimple ("apc.presets.ab", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto r = backend_.presets->ab (pu::getStr (a, "action"));
            if (! r.ok) return r.error.toVar();
            auto s = backend_.presets->stateVar();
            addLoadBehavior (s);
            return s;
        });
        add ("apc.presets.rescan", [this] (const juce::Array<juce::var>&, Completion c)
        {
            if (backend_.presets == nullptr) { c (needStore()); return; }
            ioLane_.post ([this, c]
            {
                const auto r = backend_.presets->rescan (true);
                if (! r.ok) { c (r.error.toVar()); return; }
                auto o = pu::newObject();
                pu::set (o, "ok", true);
                pu::set (o, "count", (int) backend_.presets->index()->rows.size());
                pu::set (o, "builtAt", pu::js (backend_.presets->builtAt()));
                pu::set (o, "total", (int) backend_.presets->index()->rows.size());
                pu::set (o, "scanned", r.value.scanned);
                pu::set (o, "reparsed", r.value.reparsed);
                pu::set (o, "unreadable", (int) backend_.presets->index()->errors.size());
                c (o);
                emit ("preset", presetEventPayload());
            });
        });
        addSimple ("apc.presets.openFolder", [this] (const juce::var&) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            const auto dir = backend_.presets->config().layout.presets;
            std::error_code ec;
            std::filesystem::create_directories (dir, ec);
            if (ec) return makeErr ("io", "Cannot create the preset folder: " + ec.message(), pu::pathToUtf8 (dir));
            revealPath (dir);
            auto o = pu::newObject();
            pu::set (o, "ok", true);
            pu::set (o, "path", pu::js (pu::pathToUtf8 (dir)));
            return o;
        });
        addSimple ("apc.presets.info", [this] (const juce::var&) -> juce::var
        {
            if (backend_.presets == nullptr) return needStore();
            return backend_.presets->presetsInfo();
        });
        add ("apc.presets.restoreFactory", [this] (const juce::Array<juce::var>&, Completion c)
        {
            if (backend_.presets == nullptr) { c (needStore()); return; }
            ioLane_.post ([this, c]
            {
                const auto r = backend_.presets->restoreFactoryLayout();
                if (! r.ok) { c (r.error.toVar()); return; }
                auto o = pu::newObject();
                pu::set (o, "ok", true);
                pu::set (o, "restored", (int) backend_.presets->index()->rows.size());
                pu::set (o, "path", pu::js (pu::pathToUtf8 (backend_.presets->config().layout.presets)));
                c (o);
                emit ("preset", presetEventPayload());
            });
        });

        // license ----------------------------------------------------------------------------
        addSimple ("apc.license.status", [this] (const juce::var&) { return licenseStatusVar(); });
        add ("apc.license.activate", [this] (const juce::Array<juce::var>& args, Completion c)
        {
            const auto a = arg0 (args);
            const std::string serial = pu::getStr (a, "serial"), email = pu::getStr (a, "email");
            if (backend_.license.manager == nullptr || ! backend_.license.activateOnline) { c (makeErr ("unsupported", "Online activation is not configured for this product.")); return; }
            if (serial.empty()) { c (makeErr ("invalid", "Enter your serial number.")); return; }
            licenseLane_.post ([this, c, serial, email]
            {
                const auto reply = backend_.license.activateOnline (serial, email);   // WORKER thread: may block on the network
                if (! reply.ok) { c (makeErr (reply.errorCode.empty() ? "activation_failed" : reply.errorCode, reply.message.empty() ? "Activation failed." : reply.message)); return; }
                finishActivation (reply.licenseText, c);
            });
        });
        add ("apc.license.loadFile", [this] (const juce::Array<juce::var>& args, Completion c)
        {
            const std::string text = pu::getStr (arg0 (args), "text");
            if (backend_.license.manager == nullptr) { c (makeErr ("unsupported", "No license module is configured.")); return; }
            if (text.empty()) { c (makeErr ("invalid", "The license file is empty.")); return; }
            licenseLane_.post ([this, c, text] { finishActivation (text, c); });
        });
        add ("apc.license.deactivate", [this] (const juce::Array<juce::var>&, Completion c)
        {
            if (backend_.license.manager == nullptr) { c (makeErr ("unsupported", "No license module is configured.")); return; }
            licenseLane_.post ([this, c]
            {
                std::string err;
                if (backend_.license.deactivateOnline)
                {
                    const auto r = backend_.license.deactivateOnline ({});
                    if (! r.ok) emitError (r.message.empty() ? "The seat could not be released online; the local license was still removed." : r.message, r.errorCode, "license");
                }
                if (! backend_.license.manager->deactivate (backend_.license.licensePath, err)) { c (makeErr ("io", err)); return; }
                const auto st = licenseStatusVar();
                c (st);
                emit ("license", st);
            });
        });
        addSimple ("apc.license.offlineRequest", [this] (const juce::var&) -> juce::var
        {
            if (! backend_.license.offlineRequest) return makeErr ("unsupported", "Offline activation is not available for this product.");
            auto o = pu::newObject();
            pu::set (o, "requestCode", pu::js (backend_.license.offlineRequest()));
            return o;
        });

        // update -----------------------------------------------------------------------------
        addSimple ("apc.update.state", [this] (const juce::var&) -> juce::var
        {
            if (backend_.update == nullptr) return makeErr ("unsupported", "Updates are not available in this plugin.");
            return updateStatusVar (backend_.update->status());
        });
        add ("apc.update.check", [this] (const juce::Array<juce::var>&, Completion c)
        {
            if (backend_.update == nullptr) { c (makeErr ("unsupported", "Updates are not available in this plugin.")); return; }
            auto st = updateStatusVar (backend_.update->status());
            pu::set (st, "state", "Checking");
            c (st);   // returns at once; progress and the result arrive as `update` events
            updateLane_.post ([this]
            {
                if (! backend_.update->checkNow()) emitError ("An update operation is already running.", "", "update");
            });
        });
        add ("apc.update.download", [this] (const juce::Array<juce::var>&, Completion c)
        {
            if (backend_.update == nullptr) { c (makeErr ("unsupported", "Updates are not available in this plugin.")); return; }
            const auto s = backend_.update->status();
            if (s.state != apc::UpdateState::UpdateAvailable && s.state != apc::UpdateState::Failed)
            {
                c (makeErr ("invalid_state", "There is no update ready to download (state " + std::string (apc::toString (s.state)) + ")."));
                return;
            }
            auto st = updateStatusVar (s);
            pu::set (st, "state", "Downloading");
            c (st);
            updateLane_.post ([this]
            {
                if (! backend_.update->download()) emitError ("The download could not be started (busy, or nothing to download).", "", "update");
            });
        });
        addSimple ("apc.update.revealInstaller", [this] (const juce::var&) -> juce::var
        {
            if (backend_.update == nullptr) return makeErr ("unsupported", "Updates are not available in this plugin.");
            const auto s = backend_.update->status();
            std::error_code ec;
            if (s.state != apc::UpdateState::ReadyToInstall || s.installerPath.empty() || ! std::filesystem::exists (pu::pathOf (s.installerPath), ec))
                return makeErr ("invalid_state", "No downloaded installer is available.");
            revealPath (pu::pathOf (s.installerPath));
            auto o = pu::newObject();
            pu::set (o, "ok", true);
            pu::set (o, "path", pu::js (s.installerPath));
            return o;
        });
        addSimple ("apc.update.cancel", [this] (const juce::var&) -> juce::var
        {
            if (backend_.update == nullptr) return makeErr ("unsupported", "Updates are not available in this plugin.");
            const auto s = backend_.update->status();
            if (s.state != apc::UpdateState::Downloading && s.state != apc::UpdateState::Verifying)
                return makeErr ("invalid_state", "Nothing to cancel.");
            backend_.update->cancel();   // the download loop polls the flag; the resulting state arrives as an `update` event
            return updateStatusVar (s);
        });

        // misc -------------------------------------------------------------------------------
        addSimple ("apc.openUrl", [this] (const juce::var& a) -> juce::var
        {
            const auto url = pu::getStr (a, "url");
            if (! urlAllowed (url, backend_.info.links))
                return makeErr ("url_not_allowed", "This link is not one of the product's configured links, so it was not opened.");
            const bool ok = backend_.openUrl ? backend_.openUrl (url) : juce::URL (pu::js (url)).launchInDefaultBrowser();
            if (! ok) return makeErr ("open_failed", "The link could not be opened.");
            auto o = pu::newObject();
            pu::set (o, "opened", true);
            return o;
        });
        addSimple ("apc.ui.setScale", [this] (const juce::var& a) -> juce::var
        {
            const auto v = pu::get (a, "scale");
            if (! pu::isNumber (v) || (double) v < 0.25 || (double) v > 4.0) return makeErr ("invalid", "scale must be a number between 0.25 and 4.");
            if (! backend_.setScale) return makeErr ("unsupported", "Scaling is not available in this plugin.");
            return backend_.setScale (a);
        });
        addSimple ("apc.ui.getPrefs", [this] (const juce::var& a) -> juce::var
        {
            if (backend_.uiPrefs) return backend_.uiPrefs (a);
            if (backend_.settings == nullptr) return pu::newObject();
            backend_.settings->refreshIfChanged();
            const apc::JsonValue snap = backend_.settings->snapshot();   // a COPY: keep it alive while we point into it
            const auto* ui = snap.getPath ("ui");
            return ui != nullptr ? toVar (*ui) : pu::newObject();
        });
        addSimple ("apc.diagnostics.copy", [this] (const juce::var&) -> juce::var
        {
            auto o = pu::newObject();
            pu::set (o, "text", pu::js (buildDiagnostics()));
            return o;
        });
    }

    juce::var userEntryVar (const std::string& id, const apc::presets::UserEntry& u) const
    {
        auto o = pu::newObject();
        pu::set (o, "id", pu::js (id));
        pu::set (o, "rating", u.rating);
        pu::set (o, "favorite", u.favorite);
        return o;
    }

    void finishActivation (const std::string& text, const Completion& c)
    {
        const auto res = backend_.license.manager->activateFromText (text, backend_.license.licensePath);
        if (! res.accepted)
        {
            const std::string msg = ! res.ioError.empty() ? res.status.warning : res.status.message;
            const bool notALicense = res.status.reason == apc::LicenseReason::BadLicenseFile || res.status.reason == apc::LicenseReason::UnsupportedSchema;
            c (makeErr (! res.ioError.empty() ? "io" : notALicense ? "invalid_file" : "unverified", msg.empty() ? "The license was not accepted." : msg));
            return;
        }
        const auto st = licenseStatusVar();
        c (st);
        emit ("license", st);
    }

    void surfaceSettingsWarnings()
    {
        for (const auto& w : backend_.settings->takeWarnings()) emitError (w, "", "settings");
    }

    static void flatten (const std::string& prefix, const juce::var& v, int depth, std::vector<std::pair<std::string, apc::JsonValue>>& out, std::string& bad)
    {
        if (depth > 6) { bad = "settings patch is nested too deeply."; return; }
        auto* d = v.getDynamicObject();
        if (d == nullptr || d->getProperties().size() == 0)
        {
            if (prefix.empty()) return;
            out.emplace_back (prefix, toJson (v));
            return;
        }
        for (const auto& p : d->getProperties())
        {
            const std::string k = pu::ss (p.name.toString());
            if (k.empty() || k.find ('.') != std::string::npos) { bad = "invalid settings key \"" + k + "\"."; return; }
            if (prefix.empty() && k == "schema") { bad = "The settings \"schema\" member cannot be changed."; return; }
            flatten (prefix.empty() ? k : prefix + "." + k, p.value, depth + 1, out, bad);
            if (! bad.empty()) return;
        }
    }

    void revealPath (const std::filesystem::path& p)
    {
        if (backend_.reveal) backend_.reveal (p);
        else pu::fileOf (p).revealToUser();
    }

    std::string buildDiagnostics() const
    {
        std::string t = "Diagnostics (copy generated locally; nothing was sent anywhere)\n";
        t += "Product: " + backend_.info.product + " v" + backend_.info.version;
        if (! backend_.info.buildDate.empty()) t += " (build " + backend_.info.buildDate + ")";
        t += "\nFramework: apc " + (backend_.info.frameworkVersion.empty() ? std::string ("?") : backend_.info.frameworkVersion)
             + " / JUCE " + std::to_string (JUCE_MAJOR_VERSION) + "." + std::to_string (JUCE_MINOR_VERSION) + "." + std::to_string (JUCE_BUILDNUMBER) + "\n";
        t += "OS: " + pu::ss (juce::SystemStats::getOperatingSystemName()) + "\n";
        if (backend_.license.manager != nullptr)
        {
            const auto s = backend_.license.manager->status();
            t += std::string ("License: ") + apc::toString (s.state) + "\n";   // state name only: never serial, name or e-mail
        }
        if (backend_.update != nullptr)
        {
            const auto s = backend_.update->status();
            t += std::string ("Update: ") + apc::toString (s.state) + "\n";
        }
        if (backend_.settings != nullptr) t += "Engine settings (machine defaults): " + pu::toJsonText (toVar (backend_.settings->get ("engine")), true) + "\n";
        if (backend_.diagnosticsExtra) t += "--- recent log ---\n" + backend_.diagnosticsExtra() + "\n";
        std::vector<std::string> sensitive = {
            pu::ss (juce::File::getSpecialLocation (juce::File::userHomeDirectory).getFullPathName()),
            pu::ss (juce::SystemStats::getLogonName()),
            backend_.presets != nullptr ? pu::pathToUtf8 (backend_.presets->config().layout.root) : std::string() };
        t = redact (std::move (t), sensitive);
        if (t.size() > 16 * 1024) { t.resize (16 * 1024); t += "\n[truncated]\n"; }
        return t;
    }

#if JUCE_MODULE_AVAILABLE_juce_events
    void timerCallback() override { pollNow(); }
#endif

    ApcBackend& backend_;
    std::map<std::string, Handler> handlers_;
    std::shared_ptr<std::atomic<bool>> alive_;
    std::atomic<bool> down_ { false };
    std::mutex emitMutex_;
    std::function<void (const std::string&, const juce::var&)> emitter_;
    std::function<void (const apc::UpdateStatus&)> previousOnChange_;
    int storeListener_ = 0;
    Lane updateLane_, licenseLane_, ioLane_;
};

#if JUCE_MODULE_AVAILABLE_juce_gui_extra
// Registers every CONTRACT.md bridge function on `options`. The bridge must outlive the WebBrowserComponent
// built from these options (declare it BEFORE the webView member).
[[nodiscard]] inline juce::WebBrowserComponent::Options addApcNativeFunctions (juce::WebBrowserComponent::Options options, ApcBridge& bridge)
{
    for (const auto& name : names::all())
    {
        options = std::move (options).withNativeFunction (juce::Identifier (pu::js (name)),
            [&bridge, name] (const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete)
            {
                bridge.invoke (name, args, std::move (complete));
            });
    }
    return options;
}
#endif

} // namespace apc::web
