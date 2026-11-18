// test_license_issued.cpp - ApcLicense.h against licenses ISSUED BY scripts/apc-license.js (the Node tool).
//
// C++17 has no Ed25519, so what this proves depends on the mode:
//
//  GOLDEN mode (always; no Node needed). Reads test/fixtures/license/golden.json: licenses signed by the Node
//   tool with a TEST-ONLY seed, plus the canonical message and the signature Node produced. The test verifier
//   accepts a (message, signature) pair only if it is byte-for-byte the pair in the fixture. So a pass proves:
//     * ApcLicense.h's parser + canonicalizeWithout() turn the Node-issued file into EXACTLY the bytes Node
//       signed (test/license.test.js separately proves, with Node's Ed25519, that those bytes + signature are
//       valid under the public key). Quote/backslash/control/non-BMP/U+2028/DEL escaping included.
//     * machineComponentHash() equals the hashes Node wrote into the license (cross-implementation check).
//     * the state machine reaches LICENSED / DEMO / TRIAL / UNVERIFIED as expected for each issued file.
//   It does NOT prove the Ed25519 math (the fixture verifier is an equality check, not a signature check).
//
//  LIVE mode (--live <dir> --node <node> --helper <verify-bytes.js>; used by test/apc-cpp-license.test.js).
//   <dir>/live.json describes a license freshly issued by the Node tool in this test run. The verifier hands
//   the canonical bytes ApcLicense.h computed to `node verify-bytes.js` which runs a REAL Ed25519 verification
//   under the issuing public key. A pass proves the full chain end to end: bytes computed by C++ verify
//   under a signature produced by Node. A tampered copy must be rejected by the same path.
//
// Usage: test_license_issued <fixtures/release dir> [--live <dir> --node <exe> --helper <js>]
// (the first argument is the convention shared with the other C++ tests; golden.json lives in ../license).
#include "ApcLicense.h"

#include <cstdio>
#include <cstdlib>
#include <memory>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECK_W(c, what) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s [%s]\n", __FILE__, __LINE__, #c, std::string(what).c_str()); } } while (0)

namespace fs = std::filesystem;
using namespace apc;

struct FixedClock : IClock {
    int64_t t;
    explicit FixedClock(int64_t v) : t(v) {}
    int64_t nowUnixSeconds() const override { return t; }
};
struct RawMachine : IMachineInfo {
    std::vector<MachineComponent> comps;
    std::vector<MachineComponent> components() const override { return comps; }
};

/** Accepts exactly the (message, signature) pairs the Node tool produced. */
struct GoldenVerifier : ISignatureVerifier {
    struct Pair { std::string message, signature; };
    std::vector<Pair> pairs;
    mutable int calls = 0, accepted = 0;
    bool verify(const std::string& m, const std::string& s) const override {
        ++calls;
        for (const auto& p : pairs) if (p.message == m && p.signature == s) { ++accepted; return true; }
        return false;
    }
};

/** Real Ed25519 verification by shelling out to Node (test only). */
struct NodeVerifier : ISignatureVerifier {
    std::string node, helper, pubB64;
    fs::path tmp;
    mutable int calls = 0;
    bool verify(const std::string& m, const std::string& s) const override {
        ++calls;
        const fs::path mf = tmp / "msg.bin", sf = tmp / "sig.b64";
        std::string err;
        if (!sysutil::writeFileAtomic(mf, m, err) || !sysutil::writeFileAtomic(sf, base64Encode(s), err)) return false;
        // cmd.exe strips the first and last quote of a /c command line: wrap the whole line in one more pair
        std::string cmd = "\"\"" + node + "\" \"" + helper + "\" \"" + pubB64 + "\" \"" + mf.string() + "\" \"" + sf.string() + "\"\"";
#ifndef _WIN32
        cmd = "\"" + node + "\" \"" + helper + "\" \"" + pubB64 + "\" \"" + mf.string() + "\" \"" + sf.string() + "\"";
#endif
        return std::system(cmd.c_str()) == 0;
    }
};

static bool readFile(const fs::path& p, std::string& out) {
    std::string err;
    return sysutil::readWholeFile(p, out, err, 4 * 1024 * 1024) == sysutil::ReadStatus::Ok;
}
static std::string str(const JsonValue& o, const char* k) {
    const JsonValue* v = o.find(k);
    return v && v->isString() ? v->asString() : std::string();
}
static fs::path tempDir(const char* tag) {
    static int n = 0;
    fs::path p = fs::temp_directory_path() / ("apc_test_license_issued_" + std::string(tag) + "_" + std::to_string(sysutil::currentProcessId()) + "_" + std::to_string(n++));
    fs::remove_all(p); fs::create_directories(p);
    return p;
}

// --------------------------------------------------------------------------------------------

static void goldenMode(const fs::path& goldenFile) {
    std::string text;
    CHECK_W(readFile(goldenFile, text), goldenFile.string());
    if (text.empty()) return;
    JsonParseOptions po; po.allowFloats = false; po.maxBytes = 4 * 1024 * 1024;
    const JsonParseResult pr = parseJson(stripUtf8Bom(text), po);
    CHECK_W(pr.ok, pr.error);
    if (!pr.ok) return;
    const JsonValue& g = pr.value;
    const std::string product = str(g, "product");
    const JsonValue* clk = g.find("clock_unix");
    CHECK(clk && clk->isInt());
    const JsonValue* mach = g.find("machine");
    const JsonValue* cases = g.find("cases");
    CHECK(mach && mach->isArray() && cases && cases->isArray());
    if (!clk || !mach || !cases) return;

    // machineComponentHash() must reproduce the hashes Node computed
    RawMachine machine;
    for (size_t i = 0; i < mach->size(); ++i) {
        const JsonValue& m = mach->at(i);
        MachineComponent c { str(m, "label"), str(m, "value") };
        CHECK_W(machineComponentHash(product, c) == str(m, "hash"), c.label);
        machine.comps.push_back(c);
    }
    CHECK(machine.comps.size() == 3);

    GoldenVerifier ver;
    for (size_t i = 0; i < cases->size(); ++i) {
        std::string sig;
        CHECK(base64Decode(str(cases->at(i), "signature_b64"), sig) && sig.size() == 64);
        ver.pairs.push_back({ str(cases->at(i), "canonical"), sig });
    }
    CHECK(ver.pairs.size() == cases->size() && ver.pairs.size() >= 5);

    FixedClock clock(clk->asInt());
    LicenseConfig cfg; cfg.product = product;

    for (size_t i = 0; i < cases->size(); ++i) {
        const JsonValue& c = cases->at(i);
        const std::string name = str(c, "name"), licText = str(c, "license_text"), expect = str(c, "expect_state");

        // 1. the bytes C++ canonicalises the issued file to == the bytes Node signed
        const JsonParseResult lp = parseJson(licText, [] { JsonParseOptions o; o.allowFloats = false; return o; }());
        CHECK_W(lp.ok, name + ": " + lp.error);
        if (lp.ok) {
            std::string canon, cerr;
            CHECK_W(canonicalizeWithout(lp.value, "signature_ed25519", canon, &cerr), name + ": " + cerr);
            CHECK_W(canon == str(c, "canonical"), name + ": canonical bytes differ from what Node signed");
        }

        // 2. the manager reaches the expected state through the Node-signed file
        LicenseManager m(cfg, ver, clock, machine);
        const LicenseStatus s = m.evaluate(licText);
        CHECK_W(std::string(toString(s.state)) == expect, name + ": got " + toString(s.state) + " expected " + expect + " (" + s.message + ")");
        if (name == "bound-perpetual") {
            CHECK(s.reason == LicenseReason::LicenseValid && s.allowedSeats == 3 && s.matchedComponents == 3 && s.requiredComponents == 2);
            CHECK(s.customerName.find("Countess") != std::string::npos && s.customerName.find("\xE6\x97\xA5") != std::string::npos);
            CHECK(m.isAllowed(Verb::PresetSave) && m.isLicensedRT());

            // k-of-n against the Node-written components: 1 changed raw value => 2 of 3 => still licensed
            RawMachine one = machine; one.comps[2].value = "VOL-NEW";
            LicenseManager m1(cfg, ver, clock, one);
            CHECK(m1.evaluate(licText).state == LicenseState::Licensed);
            RawMachine two = machine; two.comps[1].value = "other"; two.comps[2].value = "VOL-NEW";
            LicenseManager m2(cfg, ver, clock, two);
            const LicenseStatus s2 = m2.evaluate(licText);
            CHECK(s2.state == LicenseState::Unverified && s2.reason == LicenseReason::MachineMismatch && s2.matchedComponents == 1);

            // tamper: any edit changes the canonical bytes, so the exact-pair verifier (and a real one) rejects it
            std::string edited = licText;
            const size_t at = edited.find("\"allowed_seats\": 3");
            CHECK(at != std::string::npos);
            if (at != std::string::npos) edited.replace(at, 18, "\"allowed_seats\": 9");
            const LicenseStatus st = LicenseManager(cfg, ver, clock, machine).evaluate(edited);
            CHECK(st.state == LicenseState::Unverified && st.reason == LicenseReason::BadSignature);
        } else if (name == "subscription-expired") {
            CHECK(s.reason == LicenseReason::LicenseExpired && !m.isAllowed(Verb::PackExport));
        } else if (name == "signed-trial") {
            CHECK(s.reason == LicenseReason::LicenseValid && s.trialDaysLeft == 17 && m.isAllowed(Verb::PackInstall));
        } else if (name == "wrong-product") {
            CHECK(s.reason == LicenseReason::WrongProduct && !m.isAllowed(Verb::PresetSave));
        } else if (name == "unbound-nfr") {
            CHECK(s.reason == LicenseReason::LicenseValid && s.licenseType == "nfr" && s.requiredComponents == 0);
        }
    }
    CHECK(ver.calls > 0 && ver.accepted > 0);
}

static void liveMode(const fs::path& liveDir, const std::string& node, const std::string& helper) {
    std::string text;
    CHECK_W(readFile(liveDir / "live.json", text), "live.json");
    if (text.empty()) return;
    JsonParseOptions po; po.allowFloats = false;
    const JsonParseResult pr = parseJson(stripUtf8Bom(text), po);
    CHECK_W(pr.ok, pr.error);
    if (!pr.ok) return;
    const JsonValue& j = pr.value;
    const std::string product = str(j, "product");

    RawMachine machine;
    const JsonValue* mach = j.find("machine");
    CHECK(mach && mach->isArray());
    if (!mach) return;
    for (size_t i = 0; i < mach->size(); ++i) machine.comps.push_back({ str(mach->at(i), "label"), str(mach->at(i), "value") });

    NodeVerifier ver; ver.node = node; ver.helper = helper; ver.pubB64 = str(j, "public_key_b64"); ver.tmp = tempDir("node");
    SystemClock clock;
    LicenseConfig cfg; cfg.product = product;

    // the .lic file exactly as `apc license issue` wrote it, through the real file path of the manager
    LicenseManager m(cfg, ver, clock, machine);
    const LicenseStatus s = m.evaluateFile(liveDir / str(j, "license_file"));
    CHECK_W(s.state == LicenseState::Licensed, std::string("live license: ") + toString(s.state) + " - " + s.message);
    CHECK(s.reason == LicenseReason::LicenseValid && s.matchedComponents == 3 && ver.calls >= 1);

    // a license served by the reference issuer (HTTP response body written to a file by the test)
    if (!str(j, "issuer_license_file").empty()) {
        LicenseManager mi(cfg, ver, clock, machine);
        const LicenseStatus si = mi.evaluateFile(liveDir / str(j, "issuer_license_file"));
        CHECK_W(si.state == LicenseState::Licensed, std::string("issuer license: ") + toString(si.state) + " - " + si.message);
    }

    // tampered copy -> real Ed25519 verification must fail
    LicenseManager mt(cfg, ver, clock, machine);
    const LicenseStatus st = mt.evaluateFile(liveDir / str(j, "tampered_file"));
    CHECK_W(st.state == LicenseState::Unverified && st.reason == LicenseReason::BadSignature, std::string("tampered: ") + toString(st.state));

    // wrong public key -> rejected
    NodeVerifier other = ver; other.pubB64 = str(j, "other_public_key_b64");
    LicenseManager mo(cfg, other, clock, machine);
    CHECK(mo.evaluateFile(liveDir / str(j, "license_file")).state == LicenseState::Unverified);

    // activateFromText: verify first, then write atomically
    std::string licText; CHECK(readFile(liveDir / str(j, "license_file"), licText));
    const fs::path dest = ver.tmp / "installed" / "license.lic";
    LicenseManager ma(cfg, ver, clock, machine);
    const auto ar = ma.activateFromText(licText, dest);
    CHECK(ar.accepted && fs::exists(dest) && ma.state() == LicenseState::Licensed);
    std::error_code ec; fs::remove_all(ver.tmp, ec);
}

int main(int argc, char** argv) {
    fs::path releaseFixtures = argc > 1 ? fs::path(argv[1]) : fs::path("test/fixtures/release");
    fs::path live, node, helper;
    for (int i = 2; i + 1 < argc; i += 2) {
        const std::string k = argv[i];
        if (k == "--live") live = argv[i + 1];
        else if (k == "--node") node = argv[i + 1];
        else if (k == "--helper") helper = argv[i + 1];
    }
    goldenMode(releaseFixtures.parent_path() / "license" / "golden.json");
    if (!live.empty()) {
        CHECK(!node.empty() && !helper.empty());
        liveMode(live, node.string(), helper.string());
    }
    std::printf("test_license_issued: %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
