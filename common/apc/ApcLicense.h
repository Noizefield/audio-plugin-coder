// ApcLicense.h - vendor-neutral license SEAM for apc-license (state machine,
// gate matrix, component-wise machine match, trial with clock-rollback guard).
// C++17, std only, NO JUCE. Header-only. Brand-agnostic.
//
// ============================================================================
//  STATUS: decisions L-06 and L-07 are DECIDED (2026-11-08).
//    L-07  Two built-in ways to ISSUE the same signed file; this header verifies it either way:
//            A "signed-file"        the developer signs license files (`apc license issue`), no server
//            B "online-activation"  an issuer counts machines per key and returns the signed file
//                                   (API spec + reference issuer: schemas/apc-activation-api.schema.json,
//                                    scripts/lib/license-issuer.js; offline = request code -> website -> .lic)
//          iLok/dongles and third-party licensing SDKs are documented pointers only.
//    L-06  Protection depth "minimal": signed license + machine binding (k-of-n) + in-app deactivation +
//          trial rollback guard. "hardened" is a pointer to external wrappers, not built in.
//  Guide: .agents/guides/licensing-methods.md (decision guide) and licensing-seam.md (this module).
// ============================================================================
//  This header deliberately contains NO backend: no HTTP, no serial format, no
//  seat accounting, no store integration, no obfuscation, no anti-debug. It is
//  the plugin half every method shares:
//      license file text  ->  ISignatureVerifier  ->  LicenseState  ->  gates
//  Ed25519 verify itself is NOT implemented here: inject an
//  ISignatureVerifier adapter over a vetted library (skeletons for libsodium /
//  Monocypher-ed25519 / OpenSSL are in the header comment of
//  ApcCanonicalJson.h). The license key is DIFFERENT from the update key.
//  Cross-checked against files issued by `apc license`:
//  common/apc/tests/test_license_issued.cpp.
//
//  Honest threat model (plans/03-licensing/activation-options.md): a signed
//  license file proves WE issued it; it does not stop sharing. Machine binding
//  and the trial guard are FRICTION for honest users, not protection against
//  a determined cracker. Nothing here should be sold to anyone as DRM.
//
// ----------------------------------------------------------------------------
//  State machine (plans/03-licensing/architecture.md)
//
//     (no license) --trial disabled-------------------------------> DEMO
//     (no license) --trial enabled, record ok, days left----------> TRIAL
//                  --trial over / clock rolled back / record bad--> DEMO
//     valid signed license (not expired, machine matches)----------> LICENSED
//     signed "trial" key (license_type=trial, not expired)---------> TRIAL
//     license expired-----------------------------------------------> DEMO
//     license present but tampered / wrong product / wrong machine -> UNVERIFIED
//     deactivate() -------------------------------------------------> back to the no-license rules
//
//  Every state is a WORKING state (audio is identical in all of them, project
//  recall always works). Only the persistence verbs below are gated, and only
//  in the UI / file-I/O layer - never in the DSP graph.
//
//  Gate matrix (Verb x State):     DEMO   TRIAL   LICENSED   UNVERIFIED
//      PresetSave                   no     yes     yes        policy (default no)
//      PackExport                   no     yes     yes        policy (default no)
//      PackInstall                  no     yes     yes        policy (default no)
//
// ----------------------------------------------------------------------------
//  Real-time rules
//   * evaluate()/activate*/deactivate() do crypto + file I/O: MESSAGE THREAD
//     (or a worker) only, never processBlock().
//   * state() / isAllowed() / isLicensedRT() are ONE std::atomic load - safe in
//     the audio callback. status() takes a mutex: not for the audio thread.
//
// ----------------------------------------------------------------------------
//  License file "apc-license/1.0" (canonical JSON signing, see ApcCanonicalJson.h)
//    {
//      "schema": "apc-license/1.0", "product": "<slug>",
//      "customer_name": "...", "customer_email": "...", "order_id": "...",
//      "issued_at": "2026-10-23T14:30:00Z",
//      "expires_at": null | "2027-10-23T14:30:00Z",
//      "license_type": "commercial_perpetual|subscription|trial|nfr",
//      "allowed_seats": 3,
//      "machine_components": ["a4f89d31e8c7b640", "...", "..."],   // optional
//      "machine_min_match": 2,                                      // optional
//      "signature_ed25519": "<base64 of 64 bytes over canonical JSON w/o this member>"
//    }
//  REPLACES the plan's single fuzzy "machine_hash": an exact signature compare
//  cannot support a fuzzy hash. Instead the license stores N independent
//  component hashes (hex of the first 8 bytes of
//  SHA-256("apc-machine/1" 0x00 product 0x00 label 0x00 raw-value)) and the
//  machine matches when AT LEAST k of them are also produced by the current
//  machine (k = machine_min_match, default config 2, clamped to N). Changing
//  one component (new disk, new NIC) therefore does not invalidate the license.
//  A license without machine_components is unbound (e.g. nfr).
//
//  Trial anti-rollback ("last seen time") lives in a SEPARATE small record, not
//  in settings.json: {"v":1,"first":T0,"last":Tmax,"mac":HMAC-SHA256}. `last`
//  is the monotonic maximum of observed times; now < last - tolerance =>
//  rollback => DEMO (never a lock-out; fixing the clock resumes the trial).
//  The HMAC key is compiled into the plugin, so this stops casual edits of the
//  file ONLY. Deleting the record restarts the trial. Friction, not protection.
// ============================================================================
#pragma once

#include "ApcCanonicalJson.h"

#include <atomic>
#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

namespace apc {

enum class LicenseState : uint8_t { Demo = 0, Trial = 1, Licensed = 2, Unverified = 3 };

/** Persistence verbs that demo mode gates (decision L-02, exactly these three). */
enum class Verb : uint8_t { PresetSave = 0, PackExport = 1, PackInstall = 2 };

enum class LicenseReason {
    None, NoLicense, TrialActive, TrialExpired, ClockRollback, ClockInvalid, TrialRecordInvalid, TrialUnavailable,
    LicenseValid, LicenseExpired, BadLicenseFile, UnsupportedSchema, WrongProduct, BadSignature, MachineMismatch
};

inline const char* toString(LicenseState s) {
    switch (s) {
        case LicenseState::Demo: return "DEMO";
        case LicenseState::Trial: return "TRIAL";
        case LicenseState::Licensed: return "LICENSED";
        case LicenseState::Unverified: return "UNVERIFIED";
    }
    return "?";
}

struct GatePolicy {
    /** UNVERIFIED (hardware changed / tampered file) gates like DEMO by default. Flip only
     *  with the owner's decision (L-06): a paying customer behind a false positive is a support cost. */
    bool unverifiedAllowsVerbs = false;
};

/** The gate matrix as a pure function. */
inline bool gateAllows(LicenseState s, Verb /*v*/, const GatePolicy& p = {}) noexcept {
    switch (s) {
        case LicenseState::Demo: return false;
        case LicenseState::Trial: return true;
        case LicenseState::Licensed: return true;
        case LicenseState::Unverified: return p.unverifiedAllowsVerbs;
    }
    return false;
}

// ----- time ----------------------------------------------------------------

/** "YYYY-MM-DDTHH:MM:SSZ" (exactly this form, UTC) -> unix seconds. */
inline bool parseIso8601Utc(const std::string& s, int64_t& out) {
    if (s.size() != 20 || s[4] != '-' || s[7] != '-' || s[10] != 'T' || s[13] != ':' || s[16] != ':' || s[19] != 'Z') return false;
    auto num = [&](size_t pos, size_t len, int& v) {
        v = 0;
        for (size_t i = 0; i < len; ++i) { const char c = s[pos + i]; if (c < '0' || c > '9') return false; v = v * 10 + (c - '0'); }
        return true;
    };
    int y, mo, d, h, mi, se;
    if (!num(0, 4, y) || !num(5, 2, mo) || !num(8, 2, d) || !num(11, 2, h) || !num(14, 2, mi) || !num(17, 2, se)) return false;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return false;
    static const int dim[] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    const bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    if (d > dim[mo - 1] + (mo == 2 && leap ? 1 : 0)) return false;
    // days_from_civil (Howard Hinnant)
    const int64_t yy = y - (mo <= 2 ? 1 : 0);
    const int64_t era = (yy >= 0 ? yy : yy - 399) / 400;
    const int64_t yoe = yy - era * 400;
    const int64_t doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    const int64_t days = era * 146097 + doe - 719468;
    out = days * 86400 + h * 3600 + mi * 60 + se;
    return true;
}

inline std::string formatIso8601Utc(int64_t t) {
    int64_t days = t / 86400, rem = t % 86400;
    if (rem < 0) { rem += 86400; --days; }
    const int64_t z = days + 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const int64_t doe = z - era * 146097;
    const int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const int64_t y = yoe + era * 400;
    const int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const int64_t mp = (5 * doy + 2) / 153;
    const int64_t d = doy - (153 * mp + 2) / 5 + 1;
    const int64_t m = mp < 10 ? mp + 3 : mp - 9;
    char buf[32];
    std::snprintf(buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02dZ", (int) (y + (m <= 2 ? 1 : 0)), (int) m, (int) d,
                  (int) (rem / 3600), (int) ((rem % 3600) / 60), (int) (rem % 60));
    return buf;
}

// ----- machine fingerprint ---------------------------------------------------

struct MachineComponent { std::string label; std::string value; };   // e.g. {"cpu","..."} {"machine-id","..."} {"volume","..."}

struct IMachineInfo {
    virtual ~IMachineInfo() = default;
    /** Raw, stable identifiers (CPU model, OS machine id, boot volume id, ...). Never leave the
     *  process in raw form: only the salted hashes below are stored or transmitted. */
    virtual std::vector<MachineComponent> components() const = 0;
};

/** 16 hex chars (64 bit) salted with the product so hashes are not comparable across products. */
inline std::string machineComponentHash(const std::string& product, const MachineComponent& c) {
    return sha256Hex(std::string("apc-machine/1") + '\0' + product + '\0' + c.label + '\0' + c.value).substr(0, 16);
}

inline std::vector<std::string> machineFingerprint(const std::string& product, const IMachineInfo& info) {
    std::vector<std::string> out;
    for (const auto& c : info.components()) out.push_back(machineComponentHash(product, c));
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    return out;
}

/** Number of DISTINCT license components that the current machine also produces. */
inline size_t machineMatchCount(const std::vector<std::string>& licenseComponents, const std::vector<std::string>& machine) {
    std::vector<std::string> lic = licenseComponents;
    std::sort(lic.begin(), lic.end());
    lic.erase(std::unique(lic.begin(), lic.end()), lic.end());
    size_t n = 0;
    for (const auto& c : lic) if (std::binary_search(machine.begin(), machine.end(), c)) ++n;
    return n;
}

/** k-of-n decision. `required` is clamped to [1, n]; n == 0 means "unbound license" => true. */
inline bool machineMatches(const std::vector<std::string>& licenseComponents, const std::vector<std::string>& machine, int required) {
    std::vector<std::string> lic = licenseComponents;
    std::sort(lic.begin(), lic.end());
    lic.erase(std::unique(lic.begin(), lic.end()), lic.end());
    if (lic.empty()) return true;
    size_t k = required < 1 ? 1 : (size_t) required;
    if (k > lic.size()) k = lic.size();
    return machineMatchCount(lic, machine) >= k;
}

// ----- storage seam for the trial record -------------------------------------

struct IBlobStore {
    virtual ~IBlobStore() = default;
    virtual sysutil::ReadStatus read(std::string& out, std::string& err) = 0;
    virtual bool writeAtomic(const std::string& data, std::string& err) = 0;
};

class FileBlobStore : public IBlobStore {
public:
    explicit FileBlobStore(std::filesystem::path p) : path_(std::move(p)) {}
    sysutil::ReadStatus read(std::string& out, std::string& err) override { return sysutil::readWholeFile(path_, out, err, 64 * 1024); }
    bool writeAtomic(const std::string& data, std::string& err) override { return sysutil::writeFileAtomic(path_, data, err); }
private:
    std::filesystem::path path_;
};

// ----- configuration / status ------------------------------------------------

struct LicenseConfig {
    std::string product;                           // must equal license "product"
    bool trialEnabled = false;                     // license.mode trial / demo+trial
    int trialDays = 40;                            // license.trial_days
    int minMatchComponents = 2;                    // default k of the k-of-n machine match
    GatePolicy gate;
    std::string trialMacKey;                       // HMAC key; default derived from product
    int64_t rollbackToleranceSeconds = 3600;       // absorbs NTP / DST / manual fixes
    int64_t trialWriteGranularitySeconds = 900;    // `last` is only rewritten when it advanced this much
    int64_t minPlausibleUnix = 1700000000;         // clocks before this are treated as invalid
};

struct LicenseStatus {
    LicenseState state = LicenseState::Demo;
    LicenseReason reason = LicenseReason::NoLicense;
    std::string message;                 // banner / badge text, always non-empty
    std::string warning;                 // non-fatal problem (e.g. trial record could not be saved)
    int trialDaysLeft = -1;              // -1 = not applicable
    std::string customerName, orderId, licenseType;
    int64_t expiresAt = 0;               // 0 = none
    int allowedSeats = 0;
    size_t matchedComponents = 0, requiredComponents = 0;
};

class LicenseManager {
public:
    LicenseManager(LicenseConfig cfg, const ISignatureVerifier& verifier, const IClock& clock,
                   const IMachineInfo& machine, IBlobStore* trialStore = nullptr)
        : cfg_(std::move(cfg)), verifier_(verifier), clock_(clock), machine_(machine), trial_(trialStore) {
        if (cfg_.trialMacKey.empty()) cfg_.trialMacKey = "apc-trial-key/1|" + cfg_.product;
        publish(assessNoLicenseNoTrial());   // safe initial value until evaluate() runs
    }

    // ----- audio-thread-safe reads: a single atomic load -----
    LicenseState state() const noexcept { return (LicenseState) state_.load(std::memory_order_acquire); }
    bool isAllowed(Verb v) const noexcept { return gateAllows(state(), v, cfg_.gate); }
    bool isLicensedRT() const noexcept { return state() == LicenseState::Licensed; }

    // ----- message-thread API -----
    LicenseStatus status() const { std::lock_guard<std::mutex> g(m_); return status_; }

    /** Recompute from license file TEXT. Empty text = "no license file". Publishes the result. */
    LicenseStatus evaluate(const std::string& licenseText) {
        LicenseStatus s = licenseText.empty() ? assessNoLicense() : assessLicenseText(licenseText);
        publish(s);
        return s;
    }

    /** Recompute from <path>. Missing file = no license; unreadable / empty file = UNVERIFIED (visible). */
    LicenseStatus evaluateFile(const std::filesystem::path& path) {
        std::string text, err;
        switch (sysutil::readWholeFile(path, text, err, 256 * 1024)) {
            case sysutil::ReadStatus::NotFound: return evaluate(std::string());
            case sysutil::ReadStatus::Error: {
                LicenseStatus s = make(LicenseState::Unverified, LicenseReason::BadLicenseFile, "The license file could not be read (" + err + "). Re-activate or load your license file again.");
                publish(s); return s;
            }
            case sysutil::ReadStatus::Ok:
                if (text.empty()) {
                    LicenseStatus s = make(LicenseState::Unverified, LicenseReason::BadLicenseFile, "The license file is empty. Re-activate or load your license file again.");
                    publish(s); return s;
                }
                return evaluate(text);
        }
        return evaluate(std::string());
    }

    struct ActivationResult { bool accepted = false; LicenseStatus status; std::string ioError; };

    /** Path B (offline file) and the tail of Path A (server reply): verify FIRST, write the file
     *  atomically only if it verifies, then publish. A rejected file never replaces a good one. */
    ActivationResult activateFromText(const std::string& licenseText, const std::filesystem::path& destPath) {
        ActivationResult r;
        if (licenseText.empty()) {
            r.status = make(LicenseState::Unverified, LicenseReason::BadLicenseFile, "No license data was provided.");
            return r;
        }
        r.status = assessLicenseText(licenseText);
        if (r.status.state != LicenseState::Licensed && r.status.state != LicenseState::Trial) return r;   // not published, not written
        if (!sysutil::writeFileAtomic(destPath, licenseText, r.ioError)) {
            r.status.warning = "The license is valid but could not be saved: " + r.ioError;
            r.accepted = false; return r;
        }
        r.accepted = true;
        publish(r.status);
        return r;
    }

    /** Removes the local license file and falls back to the no-license rules. This is LOCAL only: with
     *  method B (online-activation) the integrator's UI should first call the issuer's POST /v1/deactivate
     *  (schemas/apc-activation-api.schema.json) so the seat is freed, then call this. */
    bool deactivate(const std::filesystem::path& licensePath, std::string& err) {
        std::error_code ec;
        std::filesystem::remove(licensePath, ec);
        if (ec) { err = "Cannot remove " + licensePath.string() + ": " + ec.message(); return false; }
        evaluate(std::string());
        return true;
    }

private:
    LicenseStatus make(LicenseState s, LicenseReason r, std::string msg) const {
        LicenseStatus st; st.state = s; st.reason = r; st.message = std::move(msg); return st;
    }
    void publish(const LicenseStatus& s) {
        { std::lock_guard<std::mutex> g(m_); status_ = s; }
        state_.store((uint8_t) s.state, std::memory_order_release);
    }

    LicenseStatus assessNoLicenseNoTrial() const {
        return make(LicenseState::Demo, LicenseReason::NoLicense, "[DEMO] Saving presets and exporting or installing packs are locked. Activate to keep your work.");
    }
    LicenseStatus assessNoLicense() { return cfg_.trialEnabled ? assessTrial() : assessNoLicenseNoTrial(); }

    // ---- signed license ----
    LicenseStatus assessLicenseText(const std::string& raw) const {
        const std::string text = stripUtf8Bom(raw);
        auto bad = [&](LicenseReason r, const std::string& m) { return make(LicenseState::Unverified, r, m); };
        JsonParseOptions po; po.allowFloats = false; po.maxBytes = 256 * 1024;
        const JsonParseResult pr = parseJson(text, po);
        if (!pr.ok || !pr.value.isObject())
            return bad(LicenseReason::BadLicenseFile, "The license file is damaged (" + (pr.ok ? std::string("not an object") : pr.error) + "). Re-activate or load your license file again.");
        const JsonValue& doc = pr.value;
        const JsonValue* schema = doc.find("schema");
        if (!schema || !schema->isString() || schema->asString() != "apc-license/1.0")
            return bad(LicenseReason::UnsupportedSchema, "This license file uses a format this version does not understand.");

        const JsonValue* sv = doc.find("signature_ed25519");
        std::string sig;
        if (!sv || !sv->isString() || !base64Decode(sv->asString(), sig) || sig.size() != 64)
            return bad(LicenseReason::BadSignature, "The license file is not signed correctly. Re-activate or load your license file again.");
        std::string canon, cerr;
        if (!canonicalizeWithout(doc, "signature_ed25519", canon, &cerr))
            return bad(LicenseReason::BadLicenseFile, "The license file is malformed (" + cerr + ").");
        if (!verifier_.verify(canon, sig))
            return bad(LicenseReason::BadSignature, "The license file failed its signature check (it was modified or is not genuine). Re-activate or load your license file again.");

        // signed => fields are as issued; still validate shape defensively
        auto strField = [&](const char* k, std::string& out) { const JsonValue* v = doc.find(k); if (v && v->isString()) out = v->asString(); };
        std::string product, type, issued;
        strField("product", product); strField("license_type", type); strField("issued_at", issued);
        if (product != cfg_.product)
            return bad(LicenseReason::WrongProduct, "This license is for a different product (\"" + product + "\").");
        if (type != "commercial_perpetual" && type != "subscription" && type != "trial" && type != "nfr")
            return bad(LicenseReason::BadLicenseFile, "The license file has an unknown license type.");
        int64_t issuedAt = 0;
        if (!parseIso8601Utc(issued, issuedAt))
            return bad(LicenseReason::BadLicenseFile, "The license file has an invalid issue date.");

        LicenseStatus st;
        strField("customer_name", st.customerName); strField("order_id", st.orderId);
        st.licenseType = type;
        if (const JsonValue* seats = doc.find("allowed_seats")) st.allowedSeats = seats->isInt() ? (int) seats->asInt() : 0;

        const JsonValue* exp = doc.find("expires_at");
        if (!exp) return bad(LicenseReason::BadLicenseFile, "The license file has no expiry field.");
        int64_t expiresAt = 0;
        if (exp->isString()) {
            if (!parseIso8601Utc(exp->asString(), expiresAt)) return bad(LicenseReason::BadLicenseFile, "The license file has an invalid expiry date.");
        } else if (!exp->isNull()) return bad(LicenseReason::BadLicenseFile, "The license file has an invalid expiry date.");
        st.expiresAt = expiresAt;

        const int64_t now = clock_.nowUnixSeconds();
        if (expiresAt != 0 && now >= expiresAt) {
            st.state = LicenseState::Demo; st.reason = LicenseReason::LicenseExpired;
            st.message = "[DEMO] Your license expired on " + formatIso8601Utc(expiresAt).substr(0, 10) + ". Renew to unlock saving and exporting - your audio and projects keep working.";
            return st;
        }

        // machine binding: k-of-n components
        std::vector<std::string> comps;
        if (const JsonValue* mc = doc.find("machine_components")) {
            if (!mc->isArray()) return bad(LicenseReason::BadLicenseFile, "The license file has invalid machine data.");
            for (size_t i = 0; i < mc->size(); ++i) {
                if (!mc->at(i).isString() || !isLowerHex(mc->at(i).asString(), 16))
                    return bad(LicenseReason::BadLicenseFile, "The license file has invalid machine data.");
                comps.push_back(mc->at(i).asString());
            }
        }
        int k = cfg_.minMatchComponents;
        if (const JsonValue* mm = doc.find("machine_min_match")) { if (mm->isInt() && mm->asInt() >= 1 && mm->asInt() <= 64) k = (int) mm->asInt(); }
        const auto machine = machineFingerprint(cfg_.product, machine_);
        std::sort(comps.begin(), comps.end()); comps.erase(std::unique(comps.begin(), comps.end()), comps.end());
        st.matchedComponents = machineMatchCount(comps, machine);
        st.requiredComponents = comps.empty() ? 0 : std::min<size_t>((size_t) std::max(k, 1), comps.size());
        if (!machineMatches(comps, machine, k)) {
            st.state = LicenseState::Unverified; st.reason = LicenseReason::MachineMismatch;
            st.message = "This license is registered to different hardware. Re-activate this machine online, load a fresh license file, or contact support.";
            return st;
        }

        if (type == "trial") {   // signed time-limited trial key
            st.state = LicenseState::Trial; st.reason = LicenseReason::LicenseValid;
            if (expiresAt != 0) st.trialDaysLeft = (int) ((expiresAt - now + 86399) / 86400);
            st.message = "[TRIAL" + (st.trialDaysLeft >= 0 ? " " + std::to_string(st.trialDaysLeft) + " d" : std::string()) + "]";
            return st;
        }
        st.state = LicenseState::Licensed; st.reason = LicenseReason::LicenseValid;
        st.message = st.customerName.empty() ? std::string("Licensed") : "Licensed to " + st.customerName;
        return st;
    }

    // ---- built-in trial with rollback guard ----
    std::string mac(int64_t first, int64_t last) const {
        return hexEncode(hmacSha256(cfg_.trialMacKey, "apc-trial/1|" + cfg_.product + "|" + std::to_string(first) + "|" + std::to_string(last)));
    }
    std::string recordText(int64_t first, int64_t last) const {
        JsonValue o = JsonValue::object();
        o.set("v", 1); o.set("first", first); o.set("last", last); o.set("mac", mac(first, last));
        std::string out; canonicalize(o, out);
        return out;
    }

    LicenseStatus assessTrial() {
        if (!trial_) return make(LicenseState::Demo, LicenseReason::TrialUnavailable, "[DEMO] The trial is unavailable on this system (no place to keep the trial record).");
        const int64_t now = clock_.nowUnixSeconds();
        if (now < cfg_.minPlausibleUnix)
            return make(LicenseState::Demo, LicenseReason::ClockInvalid, "[DEMO] The system clock looks wrong, so the trial is paused. Set the correct date and time.");

        std::string raw, err;
        int64_t first = 0, last = 0;
        const auto rs = trial_->read(raw, err);
        if (rs == sysutil::ReadStatus::Error)
            return make(LicenseState::Demo, LicenseReason::TrialRecordInvalid, "[DEMO] The trial record could not be read (" + err + ").");
        if (rs == sysutil::ReadStatus::NotFound) {
            first = last = now;
            LicenseStatus st = trialStatus(first, now);
            std::string werr;
            if (!trial_->writeAtomic(recordText(first, last), werr))
                st.warning = "The trial start could not be saved (" + werr + "); the trial may restart next time.";
            return st;
        }
        // existing record: parse + authenticate
        JsonParseOptions po; po.allowFloats = false; po.maxBytes = 4096;
        const JsonParseResult pr = parseJson(stripUtf8Bom(raw), po);
        auto invalid = [&]() { return make(LicenseState::Demo, LicenseReason::TrialRecordInvalid, "[DEMO] The trial record is damaged or was modified, so the trial is not available. Activate a license to unlock everything."); };
        if (!pr.ok || !pr.value.isObject()) return invalid();
        const JsonValue* f = pr.value.find("first"); const JsonValue* l = pr.value.find("last"); const JsonValue* m = pr.value.find("mac");
        const JsonValue* v = pr.value.find("v");
        if (!f || !l || !m || !v || !f->isInt() || !l->isInt() || !m->isString() || !v->isInt() || v->asInt() != 1) return invalid();
        first = f->asInt(); last = l->asInt();
        if (first <= 0 || last < first || !constantTimeEquals(m->asString(), mac(first, last))) return invalid();

        if (now + cfg_.rollbackToleranceSeconds < last)
            return make(LicenseState::Demo, LicenseReason::ClockRollback, "[DEMO] The system clock is earlier than a time this plugin has already seen, so the trial is paused. Correct the date and time to continue.");

        const int64_t effective = std::max(now, last);       // monotonic max of observed times
        LicenseStatus st = trialStatus(first, effective);
        if (effective - last >= cfg_.trialWriteGranularitySeconds) {
            std::string werr;
            if (!trial_->writeAtomic(recordText(first, effective), werr))
                st.warning = "The trial record could not be updated (" + werr + ").";
        }
        return st;
    }

    LicenseStatus trialStatus(int64_t first, int64_t effectiveNow) const {
        const int64_t total = (int64_t) cfg_.trialDays * 86400;
        const int64_t elapsed = effectiveNow - first;
        if (cfg_.trialDays <= 0 || elapsed >= total) {
            LicenseStatus st = make(LicenseState::Demo, LicenseReason::TrialExpired, "[DEMO] Your trial has ended. Everything still plays; saving and exporting are locked until you activate.");
            st.trialDaysLeft = 0; return st;
        }
        LicenseStatus st = make(LicenseState::Trial, LicenseReason::TrialActive, std::string());
        st.trialDaysLeft = (int) ((total - elapsed + 86399) / 86400);
        st.message = "[TRIAL " + std::to_string(st.trialDaysLeft) + " d]";
        return st;
    }

    LicenseConfig cfg_;
    const ISignatureVerifier& verifier_;
    const IClock& clock_;
    const IMachineInfo& machine_;
    IBlobStore* trial_;

    mutable std::mutex m_;
    LicenseStatus status_;
    std::atomic<uint8_t> state_ { (uint8_t) LicenseState::Demo };
};

static_assert(std::atomic<uint8_t>::is_always_lock_free, "audio-thread license read must be lock-free");

} // namespace apc
