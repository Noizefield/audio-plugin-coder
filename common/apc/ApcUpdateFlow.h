// ApcUpdateFlow.h - update-check / download / verify state machine (apc-updater).
// C++17, std only, NO JUCE. Header-only. Brand-agnostic.
//
// What this is: the logic only. HTTP, the clock, the signature primitive and
// the settings store are INJECTED (IHttp, IClock, ISignatureVerifier,
// IUpdateSettings), so every path is unit-testable and no network library is
// forced on the plugin.
//
// State machine
//
//   Idle --checkNow()--> Checking --+--> UpToDate
//                                   +--> UpdateAvailable --download()--> Downloading
//                                   |                                        |
//                                   +--> Failed (visible message)            v
//                                                                        Verifying
//   Downloading/Verifying --+--> ReadyToInstall   (terminal: user installs by hand)
//                           +--> Failed
//   Downloading --cancel()--> UpdateAvailable  ("Download cancelled.")
//
// Rules this class enforces (plans/05-updates + stone rules):
//   * NEVER downloads without an explicit download() call. checkNow() and
//     autoCheckIfDue() only ever fetch the small signed manifest.
//   * NEVER launches or silently replaces anything. The terminal success state
//     is ReadyToInstall: "downloaded + verified, close your DAW and run the
//     installer". Reasons: Windows keeps a loaded plugin DLL locked, sandboxed
//     hosts block spawning installers, and an installer needs elevation anyway.
//   * Every Failed state carries a non-empty, user-presentable message
//     (UpdateStatus::message). Nothing fails silently. Automatic checks flag
//     `automatic=true` so the UI may choose to stay quiet about "no update" /
//     network errors, but the status is still recorded (log it locally).
//   * Trust chain: manifest signature (Ed25519, key SEPARATE from the license
//     key) -> artifact sha256 + size from the signed manifest -> file hash
//     check. Authenticode / macOS notarization are OS-level and ADDITIONAL.
//   * Downgrade blocked: a manifest whose version is not strictly newer than
//     the running version is reported as UpToDate and download() refuses.
//   * HTTPS only (unless Config::allowInsecureHttp, for tests).
//
// Threading / async-safety notes
//   * All operations are BLOCKING. Run them on a worker thread (std::thread or
//     juce::Thread) - never on the audio thread, never on the message thread.
//   * status() is thread-safe (mutex-guarded copy) and cheap: poll it from a
//     UI timer, or set onChange (invoked on the WORKER thread, outside the
//     internal lock) and marshal to the message thread yourself.
//   * Only one operation runs at a time. A second call returns false ("busy")
//     instead of queueing.
//   * The object must outlive its worker: cancel(), join the thread, then
//     destroy. The destructor cancels but cannot join a thread you own.
//   * Plugin editors come and go: own the UpdateFlow in the processor (or a
//     process-wide singleton) rather than the editor, and let the editor only
//     read status().
//
// Manifest: see schemas/apc-update-manifest.schema.json and
// .agents/guides/updater.md. Signed bytes = canonical JSON (ApcCanonicalJson.h)
// of the manifest WITHOUT its "signature" member.
#pragma once

#include "ApcCanonicalJson.h"
#include "ApcSemVer.h"

#include <atomic>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

namespace apc {

enum class UpdateState { Idle, Checking, UpToDate, UpdateAvailable, Downloading, Verifying, ReadyToInstall, Failed };

enum class UpdateError {
    None, NotConfigured, InsecureUrl, Network, BadManifest, UnsupportedSchema, BadSignature,
    WrongProduct, NoArtifactForPlatform, DowngradeBlocked, ChecksumMismatch, SizeMismatch, Io, Unexpected
};

inline const char* toString(UpdateState s) {
    switch (s) {
        case UpdateState::Idle: return "Idle";
        case UpdateState::Checking: return "Checking";
        case UpdateState::UpToDate: return "UpToDate";
        case UpdateState::UpdateAvailable: return "UpdateAvailable";
        case UpdateState::Downloading: return "Downloading";
        case UpdateState::Verifying: return "Verifying";
        case UpdateState::ReadyToInstall: return "ReadyToInstall";
        case UpdateState::Failed: return "Failed";
    }
    return "?";
}

// ----- injected seams ------------------------------------------------------

struct HttpResult {
    bool ok = false;           // transport succeeded (a response was received)
    int status = 0;            // HTTP status code
    std::string body;
    std::string error;         // transport error text when !ok
};

struct IHttp {
    virtual ~IHttp() = default;
    /** Small GET (the manifest). Must honour timeoutMs and cap the body at maxBytes. */
    virtual HttpResult get(const std::string& url, int timeoutMs, size_t maxBytes) = 0;
    /** Streams `url` into `dest` (the flow passes a ".part" path). Poll `cancel`.
     *  Returns false and fills `error` on any failure, including cancellation. */
    virtual bool download(const std::string& url, const std::filesystem::path& dest, int timeoutMs,
                          const std::atomic<bool>& cancel,
                          const std::function<void(int64_t bytes)>& progress, std::string& error) = 0;
};

/** The two settings the flow needs. Implement over ApcSettingsStore (see
 *  StoreUpdateSettings below) or anything else that is shared per machine. */
struct IUpdateSettings {
    virtual ~IUpdateSettings() = default;
    virtual bool autoCheckEnabled() = 0;
    /** ATOMICALLY (across threads AND processes) decide whether an automatic check may run
     *  now and, if so, record `nowUnix` as the last check time. Returns true for exactly one
     *  caller per interval. */
    virtual bool tryClaimAutoCheckSlot(int64_t nowUnix, int64_t minIntervalSeconds) = 0;
};

/** Adapter for ApcSettingsStore (duck-typed so this header does not include it).
 *  Keys: ui.auto_update_check (bool, default false), update.last_check_unix (int). */
template <class Store>
class StoreUpdateSettings : public IUpdateSettings {
public:
    explicit StoreUpdateSettings(Store& s) : store_(s) {}
    bool autoCheckEnabled() override { std::string err; store_.load(err); return store_.getBool("ui.auto_update_check", false); }
    bool tryClaimAutoCheckSlot(int64_t now, int64_t interval) override {
        return store_.claimTimeSlot("update.last_check_unix", now, interval);
    }
private:
    Store& store_;
};

// ----- data ----------------------------------------------------------------

struct UpdateStatus {
    UpdateState state = UpdateState::Idle;
    UpdateError error = UpdateError::None;
    std::string message;               // user-visible text for the current state
    bool automatic = false;            // the last check was started by autoCheckIfDue()
    std::string currentVersion, latestVersion, minSupported, publishedAt, notes;
    bool belowMinSupported = false;    // informational only: the plugin keeps working
    std::string artifactUrl;
    int64_t artifactSize = 0;
    int64_t bytesDownloaded = 0;
    std::string installerPath;         // set in ReadyToInstall
};

struct UpdateConfig {
    std::string product;               // must equal manifest "product"
    std::string currentVersion;        // from the single version source (JucePlugin_VersionString)
    std::string platform;              // "windows-x64" | "macos-universal" | "linux-x64" | ...
    std::string endpointUrl;           // empty => "no update service configured"
    std::filesystem::path downloadDir; // e.g. <AppDataRoot>/<Mfr>/<Plugin>/updates
    int checkTimeoutMs = 8000;
    int downloadTimeoutMs = 15 * 60 * 1000;
    int64_t autoCheckIntervalSeconds = 24 * 60 * 60;
    bool allowInsecureHttp = false;    // tests / local dev ONLY
    size_t maxManifestBytes = 256 * 1024;
};

class UpdateFlow {
public:
    UpdateFlow(UpdateConfig cfg, IHttp& http, ISignatureVerifier& verifier, IClock& clock,
               IUpdateSettings* settings = nullptr)
        : cfg_(std::move(cfg)), http_(http), verifier_(verifier), clock_(clock), settings_(settings) {
        status_.currentVersion = cfg_.currentVersion;
    }
    ~UpdateFlow() { cancel(); }

    /** Called on the worker thread, outside the internal lock, on every state change. */
    std::function<void(const UpdateStatus&)> onChange;

    UpdateStatus status() const { std::lock_guard<std::mutex> g(m_); return status_; }

    /** Manual "Check for Updates". Blocking. Returns false only if another operation is running. */
    bool checkNow() {
        std::unique_lock<std::mutex> op(op_, std::try_to_lock);
        if (!op.owns_lock()) return false;
        runCheck(false);
        return true;
    }

    /** Auto-check gate: setting on + endpoint configured + the shared once-per-day slot is won.
     *  Returns true if a check was performed. Call it once when a plugin window opens, from a worker. */
    bool autoCheckIfDue() {
        if (!settings_ || cfg_.endpointUrl.empty()) return false;
        std::unique_lock<std::mutex> op(op_, std::try_to_lock);
        if (!op.owns_lock()) return false;
        if (!settings_->autoCheckEnabled()) return false;
        if (!settings_->tryClaimAutoCheckSlot(clock_.nowUnixSeconds(), cfg_.autoCheckIntervalSeconds)) return false;
        runCheck(true);
        return true;
    }

    /** Explicit user action: download + verify the artifact found by the last check.
     *  Valid from UpdateAvailable (or Failed after a failed download, to retry).
     *  Returns false when busy or when there is nothing to download. */
    bool download() {
        std::unique_lock<std::mutex> op(op_, std::try_to_lock);
        if (!op.owns_lock()) return false;
        {
            std::lock_guard<std::mutex> g(m_);
            const bool ok = haveArtifact_ && (status_.state == UpdateState::UpdateAvailable ||
                                              (status_.state == UpdateState::Failed && retryable_));
            if (!ok) return false;
        }
        cancel_ = false;
        try { runDownload(); }
        catch (...) { fail(UpdateError::Unexpected, "The update download failed unexpectedly. Nothing was installed."); }
        return true;
    }

    /** Asks a running download to stop. Safe from any thread. */
    void cancel() { cancel_ = true; }

    /** Back to Idle (only when nothing is running). */
    void reset() {
        std::unique_lock<std::mutex> op(op_, std::try_to_lock);
        if (!op.owns_lock()) return;
        std::lock_guard<std::mutex> g(m_);
        const std::string cur = status_.currentVersion;
        status_ = UpdateStatus(); status_.currentVersion = cur;
        haveArtifact_ = false; retryable_ = false;
    }

private:
    struct Artifact { std::string platform, kind, url, sha256; int64_t size = 0; };

    // ----- state helpers (all take m_ internally, fire onChange outside it) -----
    template <class F> void mutate(F&& f) {
        UpdateStatus copy;
        { std::lock_guard<std::mutex> g(m_); f(status_); copy = status_; }
        if (onChange) { try { onChange(copy); } catch (...) {} }
    }
    void fail(UpdateError e, const std::string& msg) {
        mutate([&](UpdateStatus& s) { s.state = UpdateState::Failed; s.error = e; s.message = msg.empty() ? "The update failed." : msg; });
    }

    static bool startsWith(const std::string& s, const char* p) { return s.rfind(p, 0) == 0; }
    static bool cleanUrl(const std::string& u) {
        if (u.empty() || u.size() > 2048) return false;
        for (const char c : u) if ((unsigned char) c <= 0x20 || (unsigned char) c == 0x7F) return false;
        return true;
    }
    std::string resolveUrl(const std::string& u) const {
        if (u.find("://") != std::string::npos) return u;
        if (u.empty() || u[0] == '/') return std::string();                 // only same-directory relative names
        const size_t slash = cfg_.endpointUrl.rfind('/');
        const size_t scheme = cfg_.endpointUrl.find("://");
        if (slash == std::string::npos || scheme == std::string::npos || slash < scheme + 3) return std::string();
        return cfg_.endpointUrl.substr(0, slash + 1) + u;
    }
    bool urlAllowed(const std::string& u) const {
        return cleanUrl(u) && (startsWith(u, "https://") || (cfg_.allowInsecureHttp && startsWith(u, "http://")));
    }

    static std::string sanitizeFileName(const std::string& url) {
        std::string name = url;
        size_t cut = name.find_first_of("?#");
        if (cut != std::string::npos) name.erase(cut);
        const size_t slash = name.rfind('/');
        if (slash != std::string::npos) name.erase(0, slash + 1);
        std::string out;
        for (const char c : name)
            out += ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '.' || c == '_' || c == '-') ? c : '_';
        if (out.empty() || out[0] == '.') out = "update-" + out;
        if (out.size() > 120) out.resize(120);
        return out;
    }

    // ----- check -----
    void runCheck(bool automatic) {
        try { doCheck(automatic); }
        catch (...) { fail(UpdateError::Unexpected, "The update check failed unexpectedly. Please try again later."); }
    }

    void doCheck(bool automatic) {
        { std::lock_guard<std::mutex> g(m_); haveArtifact_ = false; retryable_ = false; }
        mutate([&](UpdateStatus& s) {
            const std::string cur = s.currentVersion;
            s = UpdateStatus(); s.currentVersion = cur; s.automatic = automatic;
            s.state = UpdateState::Checking; s.message = "Checking for updates...";
        });

        SemVer current;
        if (!parseSemVer(cfg_.currentVersion, current))
            return fail(UpdateError::NotConfigured, "This plugin's own version string is invalid (\"" + cfg_.currentVersion + "\"), so updates cannot be checked.");
        if (cfg_.endpointUrl.empty())
            return fail(UpdateError::NotConfigured, "No update service is configured for this product.");
        if (!urlAllowed(cfg_.endpointUrl))
            return fail(UpdateError::InsecureUrl, "The update service address is not a secure (https) address, so it was not contacted.");

        const HttpResult r = http_.get(cfg_.endpointUrl, cfg_.checkTimeoutMs, cfg_.maxManifestBytes);
        if (!r.ok)
            return fail(UpdateError::Network, "Could not reach the update server" + (r.error.empty() ? std::string(".") : ": " + r.error));
        if (r.status != 200)
            return fail(UpdateError::Network, "The update server answered with HTTP " + std::to_string(r.status) + ". Please try again later.");

        // 1. strict parse (no floats in a signed document)
        JsonParseOptions po; po.allowFloats = false; po.maxBytes = cfg_.maxManifestBytes;
        const JsonParseResult pr = parseJson(stripUtf8Bom(r.body), po);
        if (!pr.ok || !pr.value.isObject())
            return fail(UpdateError::BadManifest, "The update information could not be read (" + (pr.ok ? std::string("not an object") : pr.error) + "). It was ignored.");
        const JsonValue& doc = pr.value;

        const JsonValue* schema = doc.find("schema");
        if (!schema || !schema->isString() || schema->asString() != "apc-update/1.0")
            return fail(UpdateError::UnsupportedSchema, "The update information uses a format this version does not understand. Please update manually from the product page.");

        // 2. signature BEFORE trusting any other field
        const JsonValue* sigv = doc.find("signature");
        std::string sig;
        if (!sigv || !sigv->isString() || !base64Decode(sigv->asString(), sig) || sig.size() != 64)
            return fail(UpdateError::BadSignature, "The update information is not signed correctly and was ignored.");
        std::string canon, cerr;
        if (!canonicalizeWithout(doc, "signature", canon, &cerr))
            return fail(UpdateError::BadManifest, "The update information is malformed (" + cerr + "). It was ignored.");
        if (!verifier_.verify(canon, sig))
            return fail(UpdateError::BadSignature, "The update information failed its signature check and was ignored. Nothing was downloaded.");

        // 3. field validation
        std::string product, version, minSupported, publishedAt, notes;
        std::vector<Artifact> artifacts;
        std::string why;
        if (!readManifest(doc, product, version, minSupported, publishedAt, notes, artifacts, why))
            return fail(UpdateError::BadManifest, "The update information is incomplete (" + why + "). It was ignored.");
        if (product != cfg_.product)
            return fail(UpdateError::WrongProduct, "The update information is for a different product (\"" + product + "\") and was ignored.");

        SemVer latest;
        parseSemVer(version, latest);       // validated in readManifest
        const bool below = !minSupported.empty() && [&] { SemVer m; return parseSemVer(minSupported, m) && compareSemVer(current, m) < 0; }();

        mutate([&](UpdateStatus& s) {
            s.latestVersion = latest.toString(); s.minSupported = minSupported;
            s.publishedAt = publishedAt; s.notes = notes; s.belowMinSupported = below;
        });

        if (!isNewer(latest, current)) {    // equal, or the server is behind us: never offer a downgrade
            return mutate([&](UpdateStatus& s) {
                s.state = UpdateState::UpToDate; s.error = UpdateError::None;
                s.message = "You have the latest version (v" + current.toString() + ").";
            });
        }

        const Artifact* pick = nullptr;
        for (const auto& a : artifacts) if (a.platform == cfg_.platform && a.kind == "installer") { pick = &a; break; }
        if (!pick)
            return fail(UpdateError::NoArtifactForPlatform, "Version " + latest.toString() + " is available, but there is no installer for this platform (" + cfg_.platform + ") yet.");
        const std::string url = resolveUrl(pick->url);
        if (!urlAllowed(url))
            return fail(UpdateError::InsecureUrl, "The installer address in the update information is not a secure (https) address. It was not used.");

        { std::lock_guard<std::mutex> g(m_); artifact_ = *pick; artifact_.url = url; haveArtifact_ = true; retryable_ = false; }
        mutate([&](UpdateStatus& s) {
            s.state = UpdateState::UpdateAvailable; s.error = UpdateError::None;
            s.artifactUrl = url; s.artifactSize = pick->size;
            s.message = "Update available: v" + latest.toString() + " (you have v" + current.toString() + ")."
                        + (below ? " Your version is no longer supported - please update." : "");
        });
    }

    static bool readManifest(const JsonValue& doc, std::string& product, std::string& version, std::string& minSupported,
                             std::string& publishedAt, std::string& notes, std::vector<Artifact>& artifacts, std::string& why) {
        auto str = [&](const char* k, std::string& out, bool required) -> bool {
            const JsonValue* v = doc.find(k);
            if (!v) { if (required) { why = std::string("missing \"") + k + "\""; return false; } return true; }
            if (!v->isString() || (required && v->asString().empty())) { why = std::string("\"") + k + "\" must be a string"; return false; }
            out = v->asString(); return true;
        };
        if (!str("product", product, true) || !str("version", version, true) || !str("published_at", publishedAt, true) ||
            !str("min_supported", minSupported, false) || !str("notes", notes, false)) return false;
        SemVer tmp;
        if (!parseSemVer(version, tmp)) { why = "\"version\" is not a valid version"; return false; }
        if (!minSupported.empty() && !parseSemVer(minSupported, tmp)) { why = "\"min_supported\" is not a valid version"; return false; }
        if (notes.size() > 16 * 1024) { why = "\"notes\" is too long"; return false; }
        const JsonValue* arts = doc.find("artifacts");
        if (!arts || !arts->isArray() || arts->size() == 0) { why = "\"artifacts\" must be a non-empty array"; return false; }
        for (size_t i = 0; i < arts->size(); ++i) {
            const JsonValue& a = arts->at(i);
            if (!a.isObject()) { why = "artifact entry is not an object"; return false; }
            Artifact x;
            const JsonValue* p = a.find("platform"); const JsonValue* k = a.find("kind"); const JsonValue* u = a.find("url");
            const JsonValue* h = a.find("sha256"); const JsonValue* z = a.find("size");
            if (!p || !p->isString() || !k || !k->isString() || !u || !u->isString() || !h || !h->isString() || !z || !z->isInt()) {
                why = "artifact entry is missing platform/kind/url/sha256/size"; return false;
            }
            x.platform = p->asString(); x.kind = k->asString(); x.url = u->asString(); x.sha256 = h->asString(); x.size = z->asInt();
            if (!isLowerHex(x.sha256, 64)) { why = "artifact sha256 must be 64 lowercase hex characters"; return false; }
            if (x.size < 1) { why = "artifact size must be positive"; return false; }
            artifacts.push_back(std::move(x));
        }
        return true;
    }

    // ----- download -----
    void runDownload() {
        Artifact art;
        { std::lock_guard<std::mutex> g(m_); art = artifact_; }
        SemVer current, latest;
        if (!parseSemVer(cfg_.currentVersion, current) || !parseSemVer(status().latestVersion, latest) || !isNewer(latest, current))
            return fail(UpdateError::DowngradeBlocked, "Installing this version over your current one would be a downgrade, so it was blocked.");

        std::error_code ec;
        std::filesystem::create_directories(cfg_.downloadDir, ec);
        if (ec) return fail(UpdateError::Io, "Cannot create the download folder " + cfg_.downloadDir.string() + ": " + ec.message());
        const std::string name = sanitizeFileName(art.url);
        const std::filesystem::path finalPath = cfg_.downloadDir / name;
        std::filesystem::path partPath = finalPath; partPath += ".part";
        std::filesystem::remove(partPath, ec);

        mutate([&](UpdateStatus& s) {
            s.state = UpdateState::Downloading; s.error = UpdateError::None; s.bytesDownloaded = 0;
            s.message = "Downloading v" + s.latestVersion + "...";
        });

        std::string derr;
        const bool got = http_.download(art.url, partPath, cfg_.downloadTimeoutMs, cancel_,
            [this](int64_t n) { mutate([&](UpdateStatus& s) { s.bytesDownloaded = n; }); }, derr);
        if (!got) {
            std::filesystem::remove(partPath, ec);
            if (cancel_) {
                { std::lock_guard<std::mutex> g(m_); retryable_ = false; }
                return mutate([&](UpdateStatus& s) { s.state = UpdateState::UpdateAvailable; s.error = UpdateError::None; s.message = "Download cancelled."; });
            }
            { std::lock_guard<std::mutex> g(m_); retryable_ = true; }
            return fail(UpdateError::Network, "The download failed" + (derr.empty() ? std::string(".") : ": " + derr) + " Nothing was installed.");
        }

        mutate([&](UpdateStatus& s) { s.state = UpdateState::Verifying; s.message = "Verifying the download..."; });
        std::string hex, herr; int64_t size = 0;
        if (!sysutil::sha256File(partPath, hex, size, herr)) {
            std::filesystem::remove(partPath, ec);
            { std::lock_guard<std::mutex> g(m_); retryable_ = true; }
            return fail(UpdateError::Io, "The downloaded file could not be checked: " + herr);
        }
        if (size != art.size) {
            std::filesystem::remove(partPath, ec);
            { std::lock_guard<std::mutex> g(m_); retryable_ = true; }
            return fail(UpdateError::SizeMismatch, "The downloaded file has the wrong size (" + std::to_string(size) + " bytes, expected " + std::to_string(art.size) + "). It was deleted - please try again.");
        }
        if (hex != art.sha256) {
            std::filesystem::remove(partPath, ec);
            { std::lock_guard<std::mutex> g(m_); retryable_ = true; }
            return fail(UpdateError::ChecksumMismatch, "The downloaded file failed its integrity check and was deleted. Nothing was installed - please try again or download from the product page.");
        }
        std::filesystem::remove(finalPath, ec);
        std::filesystem::rename(partPath, finalPath, ec);
        if (ec) {
            { std::lock_guard<std::mutex> g(m_); retryable_ = true; }
            return fail(UpdateError::Io, "The verified installer could not be saved to " + finalPath.string() + ": " + ec.message());
        }
        mutate([&](UpdateStatus& s) {
            s.state = UpdateState::ReadyToInstall; s.error = UpdateError::None; s.installerPath = finalPath.string();
            s.message = "Version " + s.latestVersion + " was downloaded and verified. Close your DAW, then run this installer:\n" + s.installerPath +
                        "\n(It is not started automatically: a loaded plugin cannot be replaced while the DAW is running.)";
        });
    }

    UpdateConfig cfg_;
    IHttp& http_;
    ISignatureVerifier& verifier_;
    IClock& clock_;
    IUpdateSettings* settings_;

    mutable std::mutex m_;      // guards status_, artifact_, haveArtifact_, retryable_
    std::mutex op_;             // one operation at a time
    UpdateStatus status_;
    Artifact artifact_;
    bool haveArtifact_ = false;
    bool retryable_ = false;
    std::atomic<bool> cancel_ { false };
};

} // namespace apc
