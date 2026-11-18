// test_update_canonical.cpp - ApcCanonicalJson.h: canonical-JSON golden vectors (byte for byte,
// shared with test/release.test.js), strict parser rejections, SHA-256 / HMAC / base64 vectors,
// JsonValue behaviour. Usage: test_update_canonical <fixtures-dir>
#include "ApcCanonicalJson.h"

#include <cstdio>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
static void checkEq(const std::string& got, const std::string& want, const std::string& what, int line) {
    ++g_checks;
    if (got != want) { ++g_fail; std::fprintf(stderr, "FAIL line %d (%s):\n  got : %s\n  want: %s\n", line, what.c_str(), got.c_str(), want.c_str()); }
}
#define CHECK_EQ(got, want, what) checkEq((got), (want), (what), __LINE__)

static apc::JsonValue loadVectors(const char* dir) {
    std::string raw, err;
    const auto st = apc::sysutil::readWholeFile(std::filesystem::path(dir) / "canonical-vectors.json", raw, err);
    if (st != apc::sysutil::ReadStatus::Ok) { std::fprintf(stderr, "cannot read vectors: %s\n", err.c_str()); std::exit(2); }
    auto pr = apc::parseJson(apc::stripUtf8Bom(raw));
    if (!pr.ok) { std::fprintf(stderr, "vectors do not parse: %s\n", pr.error.c_str()); std::exit(2); }
    return pr.value;
}

static std::string canonOf(const std::string& text, bool* ok = nullptr) {
    apc::JsonParseOptions po; po.allowFloats = false;
    auto pr = apc::parseJson(text, po);
    std::string out, err;
    bool good = pr.ok && apc::canonicalize(pr.value, out, &err);
    if (ok) *ok = good;
    return good ? out : std::string();
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <fixtures-dir>\n", argv[0]); return 2; }
    const apc::JsonValue v = loadVectors(argv[1]);

    // ---- canonical golden vectors, byte for byte ----
    const apc::JsonValue* vecs = v.find("vectors");
    CHECK(vecs && vecs->size() >= 10);
    for (size_t i = 0; vecs && i < vecs->size(); ++i) {
        const auto& e = vecs->at(i);
        bool ok = false;
        const std::string got = canonOf(e.find("input")->asString(), &ok);
        CHECK(ok);
        CHECK_EQ(got, e.find("canonical")->asString(), e.find("name")->asString());
    }

    // ---- everything in "reject" must be refused by the strict, float-free parser ----
    const apc::JsonValue* rej = v.find("reject");
    CHECK(rej && rej->size() >= 15);
    for (size_t i = 0; rej && i < rej->size(); ++i) {
        bool ok = true;
        canonOf(rej->at(i).find("input")->asString(), &ok);
        if (ok) { ++g_fail; std::fprintf(stderr, "FAIL: reject vector accepted: %s\n", rej->at(i).find("name")->asString().c_str()); }
        ++g_checks;
    }

    // ---- hashes / encodings ----
    for (size_t i = 0; i < v.find("sha256")->size(); ++i) {
        const auto& e = v.find("sha256")->at(i);
        CHECK_EQ(apc::sha256Hex(e.find("input")->asString()), e.find("hex")->asString(), "sha256");
    }
    {   // multi-block incremental feeding must equal one-shot
        const std::string big(1000, 'a');
        apc::Sha256 h;
        for (size_t i = 0; i < big.size(); i += 7) h.update(big.data() + i, std::min<size_t>(7, big.size() - i));
        CHECK_EQ(apc::hexEncode(h.finish()), apc::sha256Hex(big), "incremental sha256");
        CHECK_EQ(apc::sha256Hex(std::string(1000000, 'a')), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 of 1e6 'a'");
    }
    for (size_t i = 0; i < v.find("hmac_sha256")->size(); ++i) {
        const auto& e = v.find("hmac_sha256")->at(i);
        CHECK_EQ(apc::hexEncode(apc::hmacSha256(e.find("key")->asString(), e.find("message")->asString())), e.find("hex")->asString(), "hmac");
    }
    for (size_t i = 0; i < v.find("base64")->size(); ++i) {
        const auto& e = v.find("base64")->at(i);
        CHECK_EQ(apc::base64Encode(e.find("input")->asString()), e.find("b64")->asString(), "base64 encode");
        std::string dec;
        CHECK(apc::base64Decode(e.find("b64")->asString(), dec) && dec == e.find("input")->asString());
    }
    {
        std::string d;
        CHECK(!apc::base64Decode("Zg=", d));        // length
        CHECK(!apc::base64Decode("Zg=a", d));       // data after pad
        CHECK(!apc::base64Decode("Z===", d));
        CHECK(!apc::base64Decode("Zm9v\n", d));     // whitespace
        CHECK(!apc::base64Decode("Zm_v", d));       // url-safe alphabet not accepted
        CHECK(!apc::base64Decode("Zg==Zg==", d));   // padding in the middle
    }

    // ---- the signed manifest vector: canonical bytes of document == hand-derived string ----
    {
        const apc::JsonValue* s = v.find("signed");
        CHECK(s != nullptr);
        std::string out, err;
        CHECK(apc::canonicalize(*s->find("document"), out, &err));
        CHECK_EQ(out, s->find("canonical")->asString(), "signed document canonical");
        // the same document WITH a signature member canonicalizes to the same bytes once it is excluded
        apc::JsonValue withSig = *s->find("document");
        withSig.set("signature", s->find("signature_b64")->asString());
        std::string out2;
        CHECK(apc::canonicalizeWithout(withSig, "signature", out2, &err));
        CHECK_EQ(out2, out, "canonicalizeWithout(signature)");
        std::string sig;
        CHECK(apc::base64Decode(s->find("signature_b64")->asString(), sig) && sig.size() == 64);
        std::string pk;
        CHECK(apc::base64Decode(s->find("public_key_b64")->asString(), pk) && pk.size() == 32);
    }

    // ---- JsonValue behaviour ----
    {
        apc::JsonValue o = apc::JsonValue::object();
        o.set("b", 1); o.set("a", "x"); o.set("c", true);
        CHECK(o.size() == 3 && o.keyAt(0) == "a" && o.keyAt(1) == "b" && o.keyAt(2) == "c");   // sorted insert
        CHECK(o.setPath("ui.theme", "night") && o.setPath("ui.scale", 1.5) && o.setPath("engine.deep.er", 3));
        CHECK(o.getPath("ui.theme") && o.getPath("ui.theme")->asString() == "night");
        CHECK(o.getPath("engine.deep.er") && o.getPath("engine.deep.er")->asInt() == 3);
        CHECK(!o.getPath("ui.nope") && !o.getPath("nope.x") && !o.getPath(""));
        CHECK(!o.setPath("a..b", 1) && !o.setPath(".a", 1) && !o.setPath("a.", 1));
        CHECK(o.erasePath("ui.theme") && !o.getPath("ui.theme") && o.getPath("ui.scale"));
        o.setPath("a.child", 1);                                     // "a" was a string: replaced by an object
        CHECK(o.getPath("a.child") && o.getPath("a.child")->asInt() == 1);

        std::string c, err;
        CHECK(!apc::canonicalize(o, c, &err) && err.find("floating") != std::string::npos);   // ui.scale is a double
        o.erasePath("ui.scale");
        CHECK(apc::canonicalize(o, c, &err));

        apc::JsonValue big = apc::JsonValue::object();
        big.set("n", (int64_t) 9007199254740992LL);
        CHECK(!apc::canonicalize(big, c, &err));                    // beyond 2^53-1

        apc::JsonValue arr = apc::JsonValue::array();
        arr.push(1); arr.push("two"); arr.push(apc::JsonValue());
        CHECK(arr.size() == 3 && arr.at(2).isNull());
        CHECK(apc::JsonValue(3) == apc::JsonValue(3) && apc::JsonValue(3) != apc::JsonValue("3"));
    }

    // ---- parser limits ----
    {
        std::string deep;
        for (int i = 0; i < 70; ++i) deep += '[';
        for (int i = 0; i < 70; ++i) deep += ']';
        CHECK(!apc::parseJson(deep).ok);                               // depth > 64
        std::string ok64;
        for (int i = 0; i < 60; ++i) ok64 += '[';
        for (int i = 0; i < 60; ++i) ok64 += ']';
        CHECK(apc::parseJson(ok64).ok);
        apc::JsonParseOptions small; small.maxBytes = 10;
        CHECK(!apc::parseJson("[1,2,3,4,5,6,7,8]", small).ok);
        CHECK(!apc::parseJson("\xEF\xBB\xBF{}").ok);                   // BOM must be stripped by the caller
        CHECK(apc::parseJson(apc::stripUtf8Bom("\xEF\xBB\xBF{}")).ok);
        CHECK(!apc::parseJson("{\"a\":\"\xC3\x28\"}").ok);             // invalid UTF-8 (bad continuation)
        CHECK(!apc::parseJson("{\"a\":\"\xC0\x80\"}").ok);             // overlong NUL
        CHECK(!apc::parseJson("{\"a\":\"\xED\xA0\x80\"}").ok);         // encoded surrogate
        CHECK(apc::parseJson("{\"a\":\"\xF0\x9F\x98\x80\"}").ok);      // U+1F600
        auto fl = apc::parseJson("{\"scale\":1.25,\"n\":2}");
        CHECK(fl.ok && fl.value.find("scale")->isDouble() && fl.value.find("n")->isInt());
    }

    // ---- pretty writer round trip keeps types (settings.json uses it) ----
    {
        apc::JsonValue o = apc::JsonValue::object();
        o.set("scale", 1.0); o.set("n", 1); o.set("s", "a\"b\n\x01"); o.set("arr", apc::JsonValue::array());
        o.setPath("x.y", false);
        const std::string text = apc::toJson(o);
        auto back = apc::parseJson(text);
        CHECK(back.ok && back.value == o);
        CHECK(back.value.find("scale")->isDouble());                  // 1.0 stays a double
        CHECK(text.find("1.0") != std::string::npos);
        CHECK(apc::toJson(apc::JsonValue(0.1)).find("0.1") == 0);
    }

    std::printf("test_update_canonical: %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
