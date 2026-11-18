// test_semver_order.cpp - ApcSemVer.h against the shared golden vectors
// (test/fixtures/release/canonical-vectors.json). Usage: test_semver_order <fixtures-dir>
#include "ApcSemVer.h"
#include "ApcCanonicalJson.h"

#include <cstdio>
#include <iostream>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECK_MSG(c, msg) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s [%s]\n", __FILE__, __LINE__, #c, std::string(msg).c_str()); } } while (0)

static apc::JsonValue loadVectors(const char* dir) {
    std::string raw, err;
    const auto st = apc::sysutil::readWholeFile(std::filesystem::path(dir) / "canonical-vectors.json", raw, err);
    if (st != apc::sysutil::ReadStatus::Ok) { std::fprintf(stderr, "cannot read vectors: %s\n", err.c_str()); std::exit(2); }
    auto pr = apc::parseJson(apc::stripUtf8Bom(raw));
    if (!pr.ok) { std::fprintf(stderr, "vectors do not parse: %s\n", pr.error.c_str()); std::exit(2); }
    return pr.value;
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <fixtures-dir>\n", argv[0]); return 2; }
    const apc::JsonValue v = loadVectors(argv[1]);

    // ordering matrix from the shared vector list
    const apc::JsonValue* order = v.find("semver_order");
    CHECK(order && order->isArray() && order->size() > 5);
    std::vector<apc::SemVer> parsed;
    for (size_t i = 0; i < order->size(); ++i) {
        apc::SemVer s;
        CHECK_MSG(apc::parseSemVer(order->at(i).asString(), s), order->at(i).asString());
        parsed.push_back(s);
    }
    for (size_t i = 0; i < parsed.size(); ++i)
        for (size_t j = 0; j < parsed.size(); ++j) {
            const int want = i < j ? -1 : (i > j ? 1 : 0);
            CHECK_MSG(apc::compareSemVer(parsed[i], parsed[j]) == want, order->at(i).asString() + " vs " + order->at(j).asString());
        }

    // equality (build metadata ignored, 'v' prefix accepted)
    const apc::JsonValue* eq = v.find("semver_equal");
    CHECK(eq && eq->isArray());
    for (size_t i = 0; eq && i < eq->size(); ++i) {
        bool ok = false;
        const int c = apc::compareSemVer(eq->at(i).at(0).asString(), eq->at(i).at(1).asString(), ok);
        CHECK_MSG(ok && c == 0, eq->at(i).at(0).asString());
    }

    // invalid inputs
    const apc::JsonValue* bad = v.find("semver_invalid");
    CHECK(bad && bad->isArray());
    for (size_t i = 0; bad && i < bad->size(); ++i) {
        apc::SemVer s;
        CHECK_MSG(!apc::parseSemVer(bad->at(i).asString(), s), "should be invalid: \"" + bad->at(i).asString() + "\"");
    }

    // newer / downgrade
    apc::SemVer a, b, rc, rel;
    apc::parseSemVer("1.3.0", a); apc::parseSemVer("1.2.9", b);
    apc::parseSemVer("1.3.0-rc.1", rc); apc::parseSemVer("1.3.0", rel);
    CHECK(apc::isNewer(a, b));
    CHECK(!apc::isNewer(b, a));
    CHECK(!apc::isNewer(a, a));
    CHECK(apc::isDowngrade(b, a));
    CHECK(!apc::isDowngrade(a, a));
    CHECK(apc::isDowngrade(rc, rel));      // installing the rc over the release is a downgrade
    CHECK(apc::isNewer(rel, rc));

    // numeric pre-release identifiers longer than any integer type still order correctly
    apc::SemVer big1, big2;
    CHECK(apc::parseSemVer("1.0.0-alpha.99999999999999999999", big1));
    CHECK(apc::parseSemVer("1.0.0-alpha.100000000000000000000", big2));
    CHECK(apc::compareSemVer(big1, big2) < 0);

    // toString round trip
    apc::SemVer r;
    CHECK(apc::parseSemVer("v2.4.6-rc.2+build.5", r));
    CHECK(r.toString() == "2.4.6-rc.2+build.5");
    CHECK(r.major == 2 && r.minor == 4 && r.patch == 6 && r.pre.size() == 2 && r.build == "build.5");

    std::printf("test_semver_order: %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
