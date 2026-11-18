// test_license_states.cpp - ApcLicense.h: state transitions (DEMO/TRIAL/LICENSED/UNVERIFIED), expiry -> DEMO,
// tamper handling, k-of-n machine match, trial + clock-rollback guard, demo-vs-licensed gate matrix,
// atomic activation / deactivation. The Ed25519 primitive is faked (it is injected, not implemented here).
#include "ApcLicense.h"

#include <cstdio>
#include <memory>
#include <thread>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECK_W(c, what) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s [%s]\n", __FILE__, __LINE__, #c, std::string(what).c_str()); } } while (0)

namespace fs = std::filesystem;
using namespace apc;

static const int64_t T0 = 1800000000;   // 2027-01-15, after minPlausibleUnix
static const int64_t DAY = 86400;

struct FakeVerifier : ISignatureVerifier {
    static std::string sign(const std::string& m) { return sha256Raw("lic-a" + m) + sha256Raw("lic-b" + m); }
    bool verify(const std::string& m, const std::string& s) const override { return s == sign(m); }
};
struct FakeClock : IClock {
    int64_t t = T0;
    int64_t nowUnixSeconds() const override { return t; }
};
struct FakeMachine : IMachineInfo {
    std::vector<MachineComponent> comps;
    std::vector<MachineComponent> components() const override { return comps; }
};
struct MemBlob : IBlobStore {
    std::string data; bool exists = false, failWrite = false, failRead = false; int writes = 0;
    sysutil::ReadStatus read(std::string& out, std::string& err) override {
        if (failRead) { err = "disk error"; return sysutil::ReadStatus::Error; }
        if (!exists) return sysutil::ReadStatus::NotFound;
        out = data; return sysutil::ReadStatus::Ok;
    }
    bool writeAtomic(const std::string& d, std::string& err) override {
        if (failWrite) { err = "read-only volume"; return false; }
        data = d; exists = true; ++writes; return true;
    }
};

static std::vector<MachineComponent> machineA() { return { { "cpu", "CoolCPU 9000" }, { "machine-id", "abc-123" }, { "volume", "VOL-777" } }; }

struct L {
    std::string product = "DemoSynth", type = "commercial_perpetual", name = "Ada Lovelace", schema = "apc-license/1.0", issued = "2026-10-23T14:30:00Z";
    bool hasExpiry = false; std::string expires; std::vector<std::string> comps; bool hasComps = false; int minMatch = 0; bool sign = true;
};
static std::string makeLicense(const L& l) {
    JsonValue d = JsonValue::object();
    d.set("schema", l.schema); d.set("product", l.product); d.set("customer_name", l.name); d.set("customer_email", "ada@example.test");
    d.set("order_id", "ORD-1"); d.set("issued_at", l.issued); d.set("license_type", l.type); d.set("allowed_seats", 3);
    d.set("expires_at", l.hasExpiry ? JsonValue(l.expires) : JsonValue());
    if (l.hasComps) { JsonValue a = JsonValue::array(); for (const auto& c : l.comps) a.push(c); d.set("machine_components", a); }
    if (l.minMatch > 0) d.set("machine_min_match", l.minMatch);
    if (l.sign) { std::string canon; canonicalize(d, canon); d.set("signature_ed25519", base64Encode(FakeVerifier::sign(canon))); }
    return toJson(d);
}
static std::string resign(JsonValue d) {
    d.erase("signature_ed25519");
    std::string canon; canonicalize(d, canon);
    d.set("signature_ed25519", base64Encode(FakeVerifier::sign(canon)));
    return toJson(d);
}

struct Rig {
    FakeVerifier ver; FakeClock clock; FakeMachine machine; MemBlob blob; LicenseConfig cfg;
    Rig() { machine.comps = machineA(); cfg.product = "DemoSynth"; }
    std::unique_ptr<LicenseManager> make(bool withBlob = true) {
        return std::make_unique<LicenseManager>(cfg, ver, clock, machine, withBlob ? &blob : nullptr);
    }
    std::vector<std::string> fp() const { return machineFingerprint(cfg.product, machine); }
};

static fs::path tempDir(const char* tag) {
    static int n = 0;
    fs::path p = fs::temp_directory_path() / ("apc_test_license_" + std::string(tag) + "_" + std::to_string(sysutil::currentProcessId()) + "_" + std::to_string(n++));
    fs::remove_all(p); fs::create_directories(p);
    return p;
}

// --------------------------------------------------------------------------------------------

static void testGateMatrix() {
    const Verb verbs[] = { Verb::PresetSave, Verb::PackExport, Verb::PackInstall };
    GatePolicy def, lenient; lenient.unverifiedAllowsVerbs = true;
    for (Verb v : verbs) {
        CHECK(!gateAllows(LicenseState::Demo, v));
        CHECK(gateAllows(LicenseState::Trial, v));
        CHECK(gateAllows(LicenseState::Licensed, v));
        CHECK(!gateAllows(LicenseState::Unverified, v, def));
        CHECK(gateAllows(LicenseState::Unverified, v, lenient));
        CHECK(!gateAllows(LicenseState::Demo, v, lenient));               // policy never unlocks DEMO
    }
    // manager initial state is DEMO and reads through the same matrix
    Rig r; auto m = r.make();
    CHECK(m->state() == LicenseState::Demo && !m->isLicensedRT());
    for (Verb v : verbs) CHECK(!m->isAllowed(v));
    CHECK(!m->status().message.empty());
    static_assert(sizeof(LicenseState) == 1, "single-byte enum for a single atomic load");
}

static void testTimeHelpers() {
    int64_t t = 0;
    CHECK(parseIso8601Utc("1970-01-01T00:00:00Z", t) && t == 0);
    CHECK(parseIso8601Utc("2023-11-14T22:13:20Z", t) && t == 1700000000);
    CHECK(parseIso8601Utc("2000-02-29T00:00:00Z", t) && t == 951782400);
    CHECK(formatIso8601Utc(1700000000) == "2023-11-14T22:13:20Z");
    CHECK(formatIso8601Utc(0) == "1970-01-01T00:00:00Z");
    CHECK(!parseIso8601Utc("2023-02-29T00:00:00Z", t));                   // not a leap year
    CHECK(!parseIso8601Utc("2023-13-01T00:00:00Z", t));
    CHECK(!parseIso8601Utc("2023-11-14 22:13:20Z", t));
    CHECK(!parseIso8601Utc("2023-11-14t22:13:20z", t));
    CHECK(!parseIso8601Utc("2023-11-14T22:13:20+00:00", t));
    CHECK(!parseIso8601Utc("", t));
    for (int64_t x = 0; x < 4102444800LL; x += 86400LL * 37 + 12345) {   // round trip across 1970..2100
        int64_t back = -1;
        CHECK(parseIso8601Utc(formatIso8601Utc(x), back) && back == x);
    }
}

static void testLicenseStates() {
    Rig r;
    L l; l.name = "Ada";
    auto m = r.make();
    LicenseStatus s = m->evaluate(makeLicense(l));
    CHECK(s.state == LicenseState::Licensed && s.reason == LicenseReason::LicenseValid);
    CHECK(s.customerName == "Ada" && s.orderId == "ORD-1" && s.allowedSeats == 3);
    CHECK(s.message == "Licensed to Ada");
    CHECK(m->state() == LicenseState::Licensed && m->isLicensedRT());
    CHECK(m->isAllowed(Verb::PresetSave) && m->isAllowed(Verb::PackExport) && m->isAllowed(Verb::PackInstall));
    CHECK(m->status().state == LicenseState::Licensed);

    // empty text = no license -> back to DEMO
    s = m->evaluate("");
    CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::NoLicense && !m->isAllowed(Verb::PresetSave));
    CHECK(s.message.find("DEMO") != std::string::npos);

    // BOM from an editor is tolerated
    s = m->evaluate(std::string("\xEF\xBB\xBF") + makeLicense(l));
    CHECK(s.state == LicenseState::Licensed);

    // subscription: valid until expiry, then DEMO (not UNVERIFIED, not dead)
    L sub; sub.type = "subscription"; sub.hasExpiry = true; sub.expires = formatIso8601Utc(T0 + 30 * DAY);
    const std::string subText = makeLicense(sub);
    CHECK(m->evaluate(subText).state == LicenseState::Licensed);
    r.clock.t = T0 + 30 * DAY - 1;
    CHECK(m->evaluate(subText).state == LicenseState::Licensed);
    r.clock.t = T0 + 30 * DAY;                                            // boundary: expired AT expires_at
    s = m->evaluate(subText);
    CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::LicenseExpired);
    CHECK(s.message.find(formatIso8601Utc(T0 + 30 * DAY).substr(0, 10)) != std::string::npos);
    CHECK(!m->isAllowed(Verb::PackExport) && !m->isLicensedRT());
    r.clock.t = T0;
    CHECK(m->evaluate(subText).state == LicenseState::Licensed);          // (clock rollback of a LICENSE is not guarded: friction only)

    // nfr / perpetual with null expiry never expire
    L nfr; nfr.type = "nfr";
    r.clock.t = T0 + 3650 * DAY;
    CHECK(m->evaluate(makeLicense(nfr)).state == LicenseState::Licensed);
    r.clock.t = T0;

    // signed time-limited trial key -> TRIAL state with days left
    L tk; tk.type = "trial"; tk.hasExpiry = true; tk.expires = formatIso8601Utc(T0 + 10 * DAY);
    s = m->evaluate(makeLicense(tk));
    CHECK(s.state == LicenseState::Trial && s.trialDaysLeft == 10 && m->isAllowed(Verb::PresetSave));
    r.clock.t = T0 + 10 * DAY;
    CHECK(m->evaluate(makeLicense(tk)).state == LicenseState::Demo);
    r.clock.t = T0;

    // ---- tamper / invalid files -> UNVERIFIED (working state + banner), never a crash ----
    auto expectUnverified = [&](const std::string& text, LicenseReason why, const char* tag) {
        LicenseStatus x = m->evaluate(text);
        CHECK_W(x.state == LicenseState::Unverified, tag);
        CHECK_W(x.reason == why, std::string(tag) + " reason=" + std::to_string((int) x.reason));
        CHECK_W(!x.message.empty(), tag);
        CHECK_W(!m->isAllowed(Verb::PresetSave) && !m->isLicensedRT(), tag);
    };
    const std::string good = makeLicense(l);
    JsonValue gd = parseJson(good).value;
    { JsonValue t = gd; t.set("customer_name", "Mallory"); expectUnverified(toJson(t), LicenseReason::BadSignature, "edited name"); }
    { JsonValue t = gd; t.set("license_type", "nfr"); expectUnverified(toJson(t), LicenseReason::BadSignature, "edited type"); }
    { JsonValue t = gd; t.set("expires_at", JsonValue()); t.set("allowed_seats", 99); expectUnverified(toJson(t), LicenseReason::BadSignature, "edited seats"); }
    { JsonValue t = gd; t.erase("signature_ed25519"); expectUnverified(toJson(t), LicenseReason::BadSignature, "no signature"); }
    { JsonValue t = gd; t.set("signature_ed25519", "!!!"); expectUnverified(toJson(t), LicenseReason::BadSignature, "bad base64"); }
    { JsonValue t = gd; t.set("signature_ed25519", base64Encode("short")); expectUnverified(toJson(t), LicenseReason::BadSignature, "short signature"); }
    { JsonValue t = gd; t.set("schema", "apc-license/9.0"); expectUnverified(toJson(t), LicenseReason::UnsupportedSchema, "schema"); }
    { L w; w.product = "OtherSynth"; expectUnverified(makeLicense(w), LicenseReason::WrongProduct, "wrong product (validly signed)"); }
    { JsonValue t = gd; t.set("license_type", "lifetime-vip"); expectUnverified(resign(t), LicenseReason::BadLicenseFile, "unknown type"); }
    { JsonValue t = gd; t.set("issued_at", "yesterday"); expectUnverified(resign(t), LicenseReason::BadLicenseFile, "bad issued_at"); }
    { JsonValue t = gd; t.set("expires_at", "2030-01-01"); expectUnverified(resign(t), LicenseReason::BadLicenseFile, "bad expires_at"); }
    { JsonValue t = gd; t.erase("expires_at"); expectUnverified(resign(t), LicenseReason::BadLicenseFile, "no expires_at"); }
    { JsonValue t = gd; t.set("machine_components", "notalist"); expectUnverified(resign(t), LicenseReason::BadLicenseFile, "bad machine data"); }
    expectUnverified("not json at all", LicenseReason::BadLicenseFile, "garbage");
    expectUnverified("[1,2,3]", LicenseReason::BadLicenseFile, "array");
    expectUnverified("{\"schema\":\"apc-license/1.0\",\"x\":1.5}", LicenseReason::BadLicenseFile, "float in signed doc");
    expectUnverified(good.substr(0, good.size() / 2), LicenseReason::BadLicenseFile, "truncated");
    CHECK(m->evaluate(good).state == LicenseState::Licensed);              // and the good one still works afterwards
}

static void testMachineMatch() {
    // ---- pure k-of-n ----
    const std::vector<std::string> lic = { "0000000000000001", "0000000000000002", "0000000000000003" };
    auto mach = [](std::initializer_list<const char*> x) { std::vector<std::string> v(x.begin(), x.end()); std::sort(v.begin(), v.end()); return v; };
    CHECK(machineMatches(lic, mach({ "0000000000000001", "0000000000000002", "0000000000000003" }), 2));
    CHECK(machineMatches(lic, mach({ "0000000000000001", "0000000000000003", "00000000000000ff" }), 2));   // one component replaced
    CHECK(!machineMatches(lic, mach({ "0000000000000001", "00000000000000fe", "00000000000000ff" }), 2));  // only one left
    CHECK(!machineMatches(lic, mach({}), 2));
    CHECK(!machineMatches(lic, mach({ "0000000000000001", "0000000000000002" }), 3));
    CHECK(machineMatches(lic, mach({ "0000000000000001" }), 1));
    CHECK(machineMatches(lic, mach({ "0000000000000001", "0000000000000002" }), 0));   // k < 1 clamps to 1
    CHECK(machineMatches({ "0000000000000001" }, mach({ "0000000000000001" }), 2));    // k > n clamps to n
    CHECK(!machineMatches({ "0000000000000001" }, mach({ "0000000000000002" }), 2));
    CHECK(machineMatches({}, mach({}), 2));                                              // unbound license
    CHECK(machineMatchCount({ "0000000000000001", "0000000000000001" }, mach({ "0000000000000001" })) == 1);   // distinct

    // ---- hashing: salted by product and label, stable, 16 hex ----
    MachineComponent c { "cpu", "CoolCPU 9000" };
    const std::string h1 = machineComponentHash("DemoSynth", c);
    CHECK(h1.size() == 16 && isLowerHex(h1, 16));
    CHECK(h1 == machineComponentHash("DemoSynth", c));
    CHECK(h1 != machineComponentHash("OtherSynth", c));
    CHECK(h1 != machineComponentHash("DemoSynth", { "volume", "CoolCPU 9000" }));
    CHECK(h1 != machineComponentHash("DemoSynth", { "cpu", "CoolCPU 9001" }));

    // ---- end to end through the manager ----
    Rig r;
    L l; l.hasComps = true; l.comps = r.fp(); CHECK(l.comps.size() == 3);
    const std::string text = makeLicense(l);
    auto m = r.make();
    CHECK(m->evaluate(text).state == LicenseState::Licensed);

    r.machine.comps[1].value = "new-board";                               // 1 of 3 changed (new motherboard)
    LicenseStatus s = m->evaluate(text);
    CHECK(s.state == LicenseState::Licensed && s.matchedComponents == 2 && s.requiredComponents == 2);

    r.machine.comps[2].value = "new-disk";                                // 2 of 3 changed
    s = m->evaluate(text);
    CHECK(s.state == LicenseState::Unverified && s.reason == LicenseReason::MachineMismatch);
    CHECK(s.matchedComponents == 1 && s.requiredComponents == 2 && !s.message.empty());
    CHECK(!m->isAllowed(Verb::PackInstall));

    r.machine.comps = { { "cpu", "totally" }, { "machine-id", "different" } };
    CHECK(m->evaluate(text).reason == LicenseReason::MachineMismatch);

    // license-specified k overrides the config default
    r.machine.comps = machineA();
    L strict = l; strict.minMatch = 3; r.machine.comps[0].value = "swapped-cpu";
    CHECK(m->evaluate(makeLicense(strict)).state == LicenseState::Unverified);
    L loose = l; loose.minMatch = 1; r.machine.comps = { machineA()[0] };
    CHECK(m->evaluate(makeLicense(loose)).state == LicenseState::Licensed);

    // config default k = 3 makes the 1-changed case fail
    r.machine.comps = machineA(); r.machine.comps[1].value = "new-board";
    r.cfg.minMatchComponents = 3;
    auto m3 = r.make();
    CHECK(m3->evaluate(text).state == LicenseState::Unverified);
    r.cfg.minMatchComponents = 2;

    // an unbound license (no machine_components) works anywhere
    L nb; r.machine.comps = { { "cpu", "other box" } };
    CHECK(r.make()->evaluate(makeLicense(nb)).state == LicenseState::Licensed);

    // recovery: hardware changed -> UNVERIFIED -> a freshly issued license for the new machine -> LICENSED
    r.machine.comps = machineA();
    auto mr = r.make();
    L old = l; CHECK(mr->evaluate(makeLicense(old)).state == LicenseState::Licensed);
    r.machine.comps = { { "cpu", "n1" }, { "machine-id", "n2" }, { "volume", "n3" } };
    CHECK(mr->evaluate(makeLicense(old)).state == LicenseState::Unverified);
    L fresh = l; fresh.comps = r.fp();
    CHECK(mr->evaluate(makeLicense(fresh)).state == LicenseState::Licensed);
}

static void testTrial() {
    Rig r; r.cfg.trialEnabled = true; r.cfg.trialDays = 40;
    auto m = r.make();

    // trial disabled -> plain DEMO, no record touched
    { Rig d; auto md = d.make(); LicenseStatus s = md->evaluate(""); CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::NoLicense); CHECK(d.blob.writes == 0); }

    LicenseStatus s = m->evaluate("");
    CHECK(s.state == LicenseState::Trial && s.reason == LicenseReason::TrialActive && s.trialDaysLeft == 40);
    CHECK(s.message == "[TRIAL 40 d]" && r.blob.writes == 1 && r.blob.exists);
    CHECK(m->isAllowed(Verb::PresetSave) && m->isAllowed(Verb::PackExport) && m->isAllowed(Verb::PackInstall));
    CHECK(!m->isLicensedRT());                                            // TRIAL is not LICENSED

    // record is self-authenticating and contains nothing but times
    auto rec = parseJson(r.blob.data);
    CHECK(rec.ok && rec.value.find("first")->asInt() == T0 && rec.value.find("last")->asInt() == T0 && rec.value.find("mac")->asString().size() == 64);

    // days tick down; the write granularity avoids rewriting on every launch
    r.clock.t = T0 + 600;   CHECK(m->evaluate("").trialDaysLeft == 40 && r.blob.writes == 1);
    r.clock.t = T0 + 2000;  CHECK(m->evaluate("").state == LicenseState::Trial && r.blob.writes == 2);
    r.clock.t = T0 + 10 * DAY;
    s = m->evaluate(""); CHECK(s.state == LicenseState::Trial && s.trialDaysLeft == 30);
    r.clock.t = T0 + 39 * DAY + DAY / 2;
    s = m->evaluate(""); CHECK(s.state == LicenseState::Trial && s.trialDaysLeft == 1);
    r.clock.t = T0 + 40 * DAY - 1;
    CHECK(m->evaluate("").state == LicenseState::Trial);
    r.clock.t = T0 + 40 * DAY;
    s = m->evaluate("");
    CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::TrialExpired && s.trialDaysLeft == 0);
    CHECK(!m->isAllowed(Verb::PresetSave) && s.message.find("still play") != std::string::npos);   // degraded, not dead
    r.clock.t = T0 + 400 * DAY; CHECK(m->evaluate("").state == LicenseState::Demo);               // stays expired

    // buying unlocks in place
    L l; l.hasExpiry = false;
    CHECK(m->evaluate(makeLicense(l)).state == LicenseState::Licensed);
    // deactivation falls back to the no-license rules (here: expired trial -> DEMO)
    CHECK(m->evaluate("").state == LicenseState::Demo);

    // a valid-but-expired license wins over a running trial (documented: expiry -> DEMO)
    { Rig q; q.cfg.trialEnabled = true; auto mq = q.make(); mq->evaluate("");
      L sub; sub.hasExpiry = true; sub.expires = formatIso8601Utc(T0 - DAY); sub.type = "subscription";
      CHECK(mq->evaluate(makeLicense(sub)).reason == LicenseReason::LicenseExpired); }
}

static void testTrialRollbackGuard() {
    Rig r; r.cfg.trialEnabled = true;
    auto m = r.make();
    m->evaluate("");                                                      // day 0: record created
    r.clock.t = T0 + 10 * DAY; CHECK(m->evaluate("").state == LicenseState::Trial);   // last_seen = day 10

    // clock set back 5 days -> DEMO (degrade, never lock out), reason says why
    r.clock.t = T0 + 5 * DAY;
    LicenseStatus s = m->evaluate("");
    CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::ClockRollback && !s.message.empty());
    CHECK(!m->isAllowed(Verb::PresetSave));
    // rolling back again further does not help either
    r.clock.t = T0 + 1 * DAY; CHECK(m->evaluate("").reason == LicenseReason::ClockRollback);
    // the record never moved backwards (monotonic max)
    CHECK(parseJson(r.blob.data).value.find("last")->asInt() == T0 + 10 * DAY);
    // fixing the clock RESUMES the trial: no lockout, and the rolled-back period gained nothing
    r.clock.t = T0 + 10 * DAY + 3600;
    s = m->evaluate(""); CHECK(s.state == LicenseState::Trial && s.trialDaysLeft == 30);

    // small corrections (NTP / DST sized) inside the tolerance are absorbed and gain nothing
    r.clock.t = T0 + 10 * DAY + 3600 - 1800;
    s = m->evaluate(""); CHECK(s.state == LicenseState::Trial && s.trialDaysLeft == 30);

    // rollback after expiry cannot revive the trial
    r.clock.t = T0 + 45 * DAY; CHECK(m->evaluate("").reason == LicenseReason::TrialExpired);
    r.clock.t = T0 + 20 * DAY; s = m->evaluate("");
    CHECK(s.state == LicenseState::Demo);                                 // rollback (or expired) - either way DEMO
    CHECK(s.state != LicenseState::Trial);

    // a bogus clock (before the plausibility floor) pauses the trial and writes nothing
    Rig z; z.cfg.trialEnabled = true; z.clock.t = 1000; auto mz = z.make();
    s = mz->evaluate("");
    CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::ClockInvalid && z.blob.writes == 0 && !z.blob.exists);
}

static void testTrialTamper() {
    Rig r; r.cfg.trialEnabled = true;
    auto m = r.make();
    m->evaluate("");
    r.clock.t = T0 + 20 * DAY;
    m->evaluate("");
    const std::string good = r.blob.data;

    auto expectInvalid = [&](const std::string& data, const char* tag) {
        r.blob.data = data;
        LicenseStatus s = m->evaluate("");
        CHECK_W(s.state == LicenseState::Demo && s.reason == LicenseReason::TrialRecordInvalid, tag);
        CHECK_W(!s.message.empty(), tag);
        CHECK_W(r.blob.data == data, std::string("record must not be silently rewritten: ") + tag);
    };
    JsonValue g = parseJson(good).value;
    { JsonValue t = g; t.set("first", T0 + 19 * DAY); expectInvalid(toJson(t), "first moved later (trial extension)"); }
    { JsonValue t = g; t.set("last", T0 + 1 * DAY); expectInvalid(toJson(t), "last moved earlier (rollback guard defeat)"); }
    { JsonValue t = g; t.set("last", T0 + 90 * DAY); expectInvalid(toJson(t), "last moved later"); }
    { JsonValue t = g; t.erase("mac"); expectInvalid(toJson(t), "no mac"); }
    { JsonValue t = g; t.set("mac", std::string(64, '0')); expectInvalid(toJson(t), "wrong mac"); }
    { JsonValue t = g; t.set("v", 2); expectInvalid(toJson(t), "unknown version"); }
    expectInvalid("garbage", "garbage");
    expectInvalid("", "empty");
    expectInvalid("{\"first\":1.5}", "float");
    // a record issued for ANOTHER product (different MAC key material) is not accepted
    { Rig o; o.cfg.product = "OtherSynth"; o.cfg.trialEnabled = true; auto mo = o.make(); mo->evaluate("");
      expectInvalid(o.blob.data, "record copied from another product"); }
    // a different compiled-in key rejects records written under the old key
    r.blob.data = good; r.cfg.trialMacKey = "different-build-key";
    CHECK(r.make()->evaluate("").reason == LicenseReason::TrialRecordInvalid);
    r.cfg.trialMacKey.clear();

    // HONEST LIMIT (documented in the header): deleting the record restarts the trial. Friction, not protection.
    r.blob.exists = false; r.blob.data.clear();
    CHECK(r.make()->evaluate("").state == LicenseState::Trial);

    // storage failures are visible, not silent
    { Rig w; w.cfg.trialEnabled = true; w.blob.failWrite = true; auto mw = w.make();
      LicenseStatus s = mw->evaluate(""); CHECK(s.state == LicenseState::Trial && !s.warning.empty()); }
    { Rig w; w.cfg.trialEnabled = true; w.blob.failRead = true; auto mw = w.make();
      LicenseStatus s = mw->evaluate(""); CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::TrialRecordInvalid && s.message.find("disk error") != std::string::npos); }
    { Rig w; w.cfg.trialEnabled = true; auto mw = w.make(false);
      LicenseStatus s = mw->evaluate(""); CHECK(s.state == LicenseState::Demo && s.reason == LicenseReason::TrialUnavailable); }
}

static void testActivationFiles() {
    const fs::path dir = tempDir("act");
    const fs::path lic = dir / "data" / "license.lic";
    Rig r; r.cfg.trialEnabled = true;
    auto m = r.make();
    CHECK(m->evaluateFile(lic).state == LicenseState::Trial);              // missing file = no license (-> trial here)

    L l; l.hasComps = true; l.comps = r.fp();
    const std::string good = makeLicense(l);

    // a rejected file is NOT written and does not disturb the current state
    L bad = l; bad.sign = false;
    auto rej = m->activateFromText(makeLicense(bad), lic);
    CHECK(!rej.accepted && rej.status.state == LicenseState::Unverified && !fs::exists(lic));
    CHECK(m->state() == LicenseState::Trial);
    auto rej2 = m->activateFromText("", lic);
    CHECK(!rej2.accepted && !fs::exists(lic));

    // accepted: written atomically, published, survives a "restart"
    auto ok = m->activateFromText(good, lic);
    CHECK(ok.accepted && ok.status.state == LicenseState::Licensed && fs::exists(lic) && m->state() == LicenseState::Licensed);
    std::string back, err; sysutil::readWholeFile(lic, back, err);
    CHECK(back == good);
    for (const auto& e : fs::directory_iterator(lic.parent_path())) CHECK_W(e.path().filename() == "license.lic", "temp file left behind: " + e.path().string());
    auto m2 = r.make();
    CHECK(m2->evaluateFile(lic).state == LicenseState::Licensed);

    // a later bad file must not replace the good one
    auto rej3 = m->activateFromText(makeLicense(bad), lic);
    CHECK(!rej3.accepted);
    sysutil::readWholeFile(lic, back, err); CHECK(back == good && m->state() == LicenseState::Licensed);

    // someone edits license.lic on disk -> UNVERIFIED on next load
    { std::ofstream f(lic, std::ios::binary | std::ios::trunc); f << back.substr(0, back.size() - 20); }
    CHECK(m2->evaluateFile(lic).state == LicenseState::Unverified);
    { std::ofstream f(lic, std::ios::binary | std::ios::trunc); }          // empty file
    LicenseStatus es = m2->evaluateFile(lic);
    CHECK(es.state == LicenseState::Unverified && es.reason == LicenseReason::BadLicenseFile && !es.message.empty());
    CHECK(m2->evaluateFile(dir).state == LicenseState::Unverified);       // a directory where the file should be

    // deactivate: file removed, falls back to the no-license rules
    { std::ofstream f(lic, std::ios::binary | std::ios::trunc); f << good; }
    CHECK(m2->evaluateFile(lic).state == LicenseState::Licensed);
    std::string derr;
    CHECK(m2->deactivate(lic, derr) && !fs::exists(lic));
    CHECK(m2->state() == LicenseState::Trial);                             // trial still running -> back to TRIAL
    CHECK(m2->deactivate(lic, derr));                                      // idempotent

    std::error_code ec; fs::remove_all(dir, ec);
}

static void testAudioThreadRead() {
    // evaluate() on one thread while another hammers the audio-thread API: only valid enum values, no tearing.
    Rig r; r.cfg.trialEnabled = true;
    auto m = r.make();
    L l; const std::string good = makeLicense(l);
    std::atomic<bool> stop { false }; std::atomic<int> bad { 0 }; std::atomic<long> reads { 0 };
    std::thread reader([&] {
        while (!stop) {
            const LicenseState s = m->state();
            if ((int) s < 0 || (int) s > 3) ++bad;
            (void) m->isAllowed(Verb::PresetSave);
            ++reads;
        }
    });
    for (int i = 0; i < 300; ++i) { m->evaluate(i % 2 ? good : ""); r.clock.t += 1; }
    stop = true; reader.join();
    CHECK(bad == 0 && reads > 0);
}

int main() {
    testGateMatrix();
    testTimeHelpers();
    testLicenseStates();
    testMachineMatch();
    testTrial();
    testTrialRollbackGuard();
    testTrialTamper();
    testActivationFiles();
    testAudioThreadRead();
    std::printf("test_license_states: %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
