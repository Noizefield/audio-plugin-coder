// ApcCanonicalJson.h - tiny JSON tree, strict parser, canonical serializer and
// the small std-only primitives the apc-updater / apc-license / apc-settings
// modules share (SHA-256, HMAC, base64, hex, file helpers, injected seams).
//
// Standard: C++17, std only, NO JUCE. Header-only (everything is `inline`).
// Part of the APC product-standards modules. Brand-agnostic.
//
// ============================================================================
//  CANONICAL JSON  ("apc-canon/1")   -- the bytes that get signed
// ============================================================================
//  The signature of a manifest / license is computed over the canonical bytes
//  of the document WITHOUT its signature member. The Node implementation in
//  scripts/apc-release.js and this header MUST produce byte-identical output;
//  test/fixtures/release/canonical-vectors.json is the shared golden file.
//
//   1. Objects: members sorted by the key's UTF-8 BYTES (== Unicode code point
//      order), ascending. NOT UTF-16 order. Duplicate keys are a parse error.
//   2. No insignificant whitespace at all.
//   3. Strings: UTF-8. Escape only  "  ->  \"   \  ->  \\   and control chars:
//      \b \f \n \r \t use the short form, every other U+0000..U+001F becomes
//      \u00xx with LOWERCASE hex. Nothing else is escaped ('/', DEL, U+2028,
//      non-ASCII are emitted as raw UTF-8).
//   4. Numbers: INTEGERS ONLY, range -(2^53-1)..(2^53-1), written in plain
//      decimal with no '+', no leading zeros, no exponent, never "-0".
//      A document containing a float / exponent / out-of-range integer is
//      REJECTED (parse with allowFloats=false) - floats have no portable
//      canonical form, so signed fields must not use them.
//   5. true / false / null literal, arrays keep their order.
//
//  Parser limits (deliberate): max nesting depth 64, max document 4 MiB
//  (default), UTF-8 input must be well-formed, no BOM (strip it first), no
//  comments, no trailing commas, lone surrogate escapes are rejected, input
//  must be a single value followed only by whitespace. It is NOT a general
//  purpose JSON library: no streaming, no big numbers, no round-trip of the
//  original number spelling (1.0 vs 1) or key order.
//
// ============================================================================
//  ED25519 ADAPTER SKELETONS (NOT compiled here - verify is intentionally not
//  implemented in this module; plug a vetted library behind ISignatureVerifier)
// ============================================================================
//  The public key is bound inside the adapter instance. `message` is the
//  canonical byte string, `signature` is the 64 raw signature bytes.
//
//  libsodium:
//    struct SodiumVerifier : apc::ISignatureVerifier {
//        unsigned char pk[crypto_sign_PUBLICKEYBYTES];            // 32 bytes
//        bool verify(const std::string& m, const std::string& s) const override {
//            return s.size() == 64 &&
//                   crypto_sign_verify_detached((const unsigned char*) s.data(),
//                       (const unsigned char*) m.data(), m.size(), pk) == 0;
//        } };
//
//  Monocypher (use the ED25519 variant - the default EdDSA in Monocypher uses
//  BLAKE2b and is NOT Ed25519-compatible):
//        #include "monocypher-ed25519.h"
//        return s.size() == 64 &&
//               crypto_ed25519_check((const uint8_t*) s.data(), pk,
//                                    (const uint8_t*) m.data(), m.size()) == 0;
//
//  OpenSSL 1.1.1+/3 (EVP_PKEY_new_raw_public_key + one-shot verify):
//        EVP_PKEY* k = EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr, pk, 32);
//        EVP_MD_CTX* c = EVP_MD_CTX_new();
//        bool ok = k && c && EVP_DigestVerifyInit(c, nullptr, nullptr, nullptr, k) == 1
//                  && EVP_DigestVerify(c, (const unsigned char*) s.data(), s.size(),
//                                      (const unsigned char*) m.data(), m.size()) == 1;
//        EVP_MD_CTX_free(c); EVP_PKEY_free(k);
//
//  The update key and the license key are DIFFERENT keys: construct two
//  verifier instances. Never reuse one key for both purposes.
// ============================================================================
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <locale>
#include <sstream>
#include <string>
#include <thread>
#include <type_traits>
#include <vector>

#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif

namespace apc {

// ---------------------------------------------------------------------------
//  Shared seams (injected, so every state machine is testable without a
//  network, a clock or a crypto library)
// ---------------------------------------------------------------------------

/** Ed25519 signature verification. The public key lives inside the adapter. */
struct ISignatureVerifier {
    virtual ~ISignatureVerifier() = default;
    /** @param message   exact bytes that were signed (canonical JSON)
     *  @param signature the 64 raw signature bytes
     *  @return true only if the signature is valid for the bound public key. */
    virtual bool verify(const std::string& message, const std::string& signature) const = 0;
};

/** Wall clock in whole seconds since the Unix epoch (UTC). */
struct IClock {
    virtual ~IClock() = default;
    virtual int64_t nowUnixSeconds() const = 0;
};

struct SystemClock : IClock {
    int64_t nowUnixSeconds() const override {
        return (int64_t) std::chrono::duration_cast<std::chrono::seconds>(
                   std::chrono::system_clock::now().time_since_epoch()).count();
    }
};

// ---------------------------------------------------------------------------
//  JsonValue
// ---------------------------------------------------------------------------

class JsonValue {
public:
    enum class Type { Null, Bool, Int, Double, String, Array, Object };

    JsonValue() = default;
    JsonValue(std::nullptr_t) {}
    JsonValue(bool b) : type_(Type::Bool), i_(b ? 1 : 0) {}
    template <class T, typename std::enable_if<std::is_integral<T>::value &&
                                               !std::is_same<T, bool>::value, int>::type = 0>
    JsonValue(T v) : type_(Type::Int), i_((int64_t) v) {}
    JsonValue(double d) : type_(Type::Double), d_(d) {}
    JsonValue(const char* s) : type_(Type::String), s_(s ? s : "") {}
    JsonValue(std::string s) : type_(Type::String), s_(std::move(s)) {}

    static JsonValue array()  { JsonValue v; v.type_ = Type::Array;  return v; }
    static JsonValue object() { JsonValue v; v.type_ = Type::Object; return v; }

    Type type() const { return type_; }
    bool isNull()   const { return type_ == Type::Null; }
    bool isBool()   const { return type_ == Type::Bool; }
    bool isInt()    const { return type_ == Type::Int; }
    bool isDouble() const { return type_ == Type::Double; }
    bool isNumber() const { return isInt() || isDouble(); }
    bool isString() const { return type_ == Type::String; }
    bool isArray()  const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }

    bool asBool(bool def = false) const { return isBool() ? i_ != 0 : def; }
    int64_t asInt(int64_t def = 0) const {
        if (isInt()) return i_;
        if (isDouble() && std::isfinite(d_)) return (int64_t) d_;
        return def;
    }
    double asDouble(double def = 0.0) const {
        if (isDouble()) return d_;
        if (isInt()) return (double) i_;
        return def;
    }
    const std::string& asString() const { return s_; }
    std::string asString(const std::string& def) const { return isString() ? s_ : def; }

    // ----- arrays -----
    size_t size() const { return isArray() ? a_.size() : (isObject() ? keys_.size() : 0); }
    const JsonValue& at(size_t i) const { return a_[i]; }
    JsonValue& at(size_t i) { return a_[i]; }
    /** Appends; a non-array value is first replaced by an empty array. */
    JsonValue& push(JsonValue v) {
        if (!isArray()) { *this = array(); }
        a_.push_back(std::move(v));
        return a_.back();
    }

    // ----- objects (members kept sorted by key BYTES) -----
    const std::string& keyAt(size_t i) const { return keys_[i]; }
    const JsonValue& valueAt(size_t i) const { return vals_[i]; }
    JsonValue& valueAt(size_t i) { return vals_[i]; }

    const JsonValue* find(const std::string& key) const {
        if (!isObject()) return nullptr;
        const size_t i = lowerBound(key);
        return (i < keys_.size() && keys_[i] == key) ? &vals_[i] : nullptr;
    }
    JsonValue* find(const std::string& key) {
        return const_cast<JsonValue*>(static_cast<const JsonValue*>(this)->find(key));
    }
    /** Inserts or replaces. A non-object value is first replaced by `{}`. */
    JsonValue& set(const std::string& key, JsonValue v) {
        if (!isObject()) { *this = object(); }
        const size_t i = lowerBound(key);
        if (i < keys_.size() && keys_[i] == key) { vals_[i] = std::move(v); return vals_[i]; }
        keys_.insert(keys_.begin() + (std::ptrdiff_t) i, key);
        vals_.insert(vals_.begin() + (std::ptrdiff_t) i, std::move(v));
        return vals_[i];
    }
    bool erase(const std::string& key) {
        if (!isObject()) return false;
        const size_t i = lowerBound(key);
        if (i >= keys_.size() || keys_[i] != key) return false;
        keys_.erase(keys_.begin() + (std::ptrdiff_t) i);
        vals_.erase(vals_.begin() + (std::ptrdiff_t) i);
        return true;
    }

    // ----- dotted paths ("ui.theme"); keys containing '.' are not addressable -----
    const JsonValue* getPath(const std::string& path) const {
        const JsonValue* cur = this;
        size_t start = 0;
        while (true) {
            const size_t dot = path.find('.', start);
            const std::string part = path.substr(start, dot == std::string::npos ? dot : dot - start);
            if (part.empty()) return nullptr;
            cur = cur->find(part);
            if (!cur) return nullptr;
            if (dot == std::string::npos) return cur;
            start = dot + 1;
        }
    }
    /** Creates intermediate objects; an existing NON-object on the way is replaced. */
    bool setPath(const std::string& path, JsonValue v) {
        if (path.empty() || path.front() == '.' || path.back() == '.' ||
            path.find("..") != std::string::npos) return false;
        JsonValue* cur = this;
        size_t start = 0;
        while (true) {
            const size_t dot = path.find('.', start);
            const std::string part = path.substr(start, dot == std::string::npos ? dot : dot - start);
            if (dot == std::string::npos) { cur->set(part, std::move(v)); return true; }
            JsonValue* next = cur->isObject() ? cur->find(part) : nullptr;
            if (!next || !next->isObject()) next = &cur->set(part, object());
            cur = next;
            start = dot + 1;
        }
    }
    bool erasePath(const std::string& path) {
        const size_t dot = path.rfind('.');
        if (dot == std::string::npos) return erase(path);
        JsonValue* parent = const_cast<JsonValue*>(getPath(path.substr(0, dot)));
        return parent && parent->erase(path.substr(dot + 1));
    }

    friend bool operator==(const JsonValue& a, const JsonValue& b) {
        if (a.type_ != b.type_) return false;
        switch (a.type_) {
            case Type::Null: return true;
            case Type::Bool: case Type::Int: return a.i_ == b.i_;
            case Type::Double: return a.d_ == b.d_;
            case Type::String: return a.s_ == b.s_;
            case Type::Array: return a.a_ == b.a_;
            case Type::Object: return a.keys_ == b.keys_ && a.vals_ == b.vals_;
        }
        return false;
    }
    friend bool operator!=(const JsonValue& a, const JsonValue& b) { return !(a == b); }

private:
    size_t lowerBound(const std::string& key) const {
        // std::string ordering == byte ordering (char_traits<char> compares unsigned).
        return (size_t) (std::lower_bound(keys_.begin(), keys_.end(), key) - keys_.begin());
    }

    Type type_ = Type::Null;
    int64_t i_ = 0;
    double d_ = 0.0;
    std::string s_;
    std::vector<JsonValue> a_;
    std::vector<std::string> keys_;
    std::vector<JsonValue> vals_;
};

// ---------------------------------------------------------------------------
//  Strict parser
// ---------------------------------------------------------------------------

struct JsonParseOptions {
    bool allowFloats = true;          // false for signed documents
    int maxDepth = 64;
    size_t maxBytes = 4u * 1024u * 1024u;
};

struct JsonParseResult {
    bool ok = false;
    JsonValue value;
    std::string error;                // human readable, includes byte offset
    size_t offset = 0;
};

namespace json_detail {

constexpr int64_t kMaxSafeInt = 9007199254740991LL;   // 2^53 - 1

inline void appendUtf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) out += (char) cp;
    else if (cp < 0x800) { out += (char) (0xC0 | (cp >> 6)); out += (char) (0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) {
        out += (char) (0xE0 | (cp >> 12)); out += (char) (0x80 | ((cp >> 6) & 0x3F));
        out += (char) (0x80 | (cp & 0x3F));
    } else {
        out += (char) (0xF0 | (cp >> 18)); out += (char) (0x80 | ((cp >> 12) & 0x3F));
        out += (char) (0x80 | ((cp >> 6) & 0x3F)); out += (char) (0x80 | (cp & 0x3F));
    }
}

/** Validates one UTF-8 sequence starting at s[pos] (>= 0x80). Advances pos. */
inline bool consumeUtf8(const std::string& s, size_t& pos) {
    const unsigned char c = (unsigned char) s[pos];
    int len = 0; uint32_t cp = 0, minCp = 0;
    if (c >= 0xC2 && c <= 0xDF) { len = 2; cp = c & 0x1F; minCp = 0x80; }
    else if (c >= 0xE0 && c <= 0xEF) { len = 3; cp = c & 0x0F; minCp = 0x800; }
    else if (c >= 0xF0 && c <= 0xF4) { len = 4; cp = c & 0x07; minCp = 0x10000; }
    else return false;
    if (pos + (size_t) len > s.size()) return false;
    for (int k = 1; k < len; ++k) {
        const unsigned char cc = (unsigned char) s[pos + (size_t) k];
        if ((cc & 0xC0) != 0x80) return false;
        cp = (cp << 6) | (cc & 0x3F);
    }
    if (cp < minCp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return false;
    pos += (size_t) len;
    return true;
}

class Parser {
public:
    Parser(const std::string& text, const JsonParseOptions& o) : s_(text), opt_(o) {}

    JsonParseResult run() {
        JsonParseResult r;
        if (s_.size() > opt_.maxBytes) { r.error = "document too large"; return r; }
        skipWs();
        if (!parseValue(r.value, 0)) { r.error = err_ + " at byte " + std::to_string(errPos_); r.offset = errPos_; return r; }
        skipWs();
        if (pos_ != s_.size()) { fail("trailing data after JSON value"); r.error = err_ + " at byte " + std::to_string(errPos_); r.offset = errPos_; return r; }
        r.ok = true;
        return r;
    }

private:
    bool fail(const std::string& m) { if (err_.empty()) { err_ = m; errPos_ = pos_; } return false; }
    void skipWs() { while (pos_ < s_.size() && (s_[pos_] == ' ' || s_[pos_] == '\t' || s_[pos_] == '\n' || s_[pos_] == '\r')) ++pos_; }

    bool parseValue(JsonValue& out, int depth) {
        if (depth > opt_.maxDepth) return fail("nesting too deep");
        if (pos_ >= s_.size()) return fail("unexpected end of input");
        const char c = s_[pos_];
        if (c == '{') return parseObject(out, depth);
        if (c == '[') return parseArray(out, depth);
        if (c == '"') { std::string str; if (!parseString(str)) return false; out = JsonValue(std::move(str)); return true; }
        if (c == 't') return literal("true", JsonValue(true), out);
        if (c == 'f') return literal("false", JsonValue(false), out);
        if (c == 'n') return literal("null", JsonValue(), out);
        if (c == '-' || (c >= '0' && c <= '9')) return parseNumber(out);
        return fail("unexpected character");
    }

    bool literal(const char* word, JsonValue v, JsonValue& out) {
        const size_t n = std::char_traits<char>::length(word);
        if (s_.compare(pos_, n, word) != 0) return fail("invalid literal");
        pos_ += n; out = std::move(v); return true;
    }

    bool parseObject(JsonValue& out, int depth) {
        ++pos_; out = JsonValue::object();
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == '}') { ++pos_; return true; }
        while (true) {
            skipWs();
            if (pos_ >= s_.size() || s_[pos_] != '"') return fail("object key must be a string");
            std::string key;
            if (!parseString(key)) return false;
            skipWs();
            if (pos_ >= s_.size() || s_[pos_] != ':') return fail("expected ':'");
            ++pos_; skipWs();
            JsonValue v;
            if (!parseValue(v, depth + 1)) return false;
            if (out.find(key)) return fail("duplicate object key \"" + key + "\"");
            out.set(key, std::move(v));
            skipWs();
            if (pos_ >= s_.size()) return fail("unterminated object");
            if (s_[pos_] == ',') { ++pos_; continue; }
            if (s_[pos_] == '}') { ++pos_; return true; }
            return fail("expected ',' or '}'");
        }
    }

    bool parseArray(JsonValue& out, int depth) {
        ++pos_; out = JsonValue::array();
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == ']') { ++pos_; return true; }
        while (true) {
            skipWs();
            JsonValue v;
            if (!parseValue(v, depth + 1)) return false;
            out.push(std::move(v));
            skipWs();
            if (pos_ >= s_.size()) return fail("unterminated array");
            if (s_[pos_] == ',') { ++pos_; continue; }
            if (s_[pos_] == ']') { ++pos_; return true; }
            return fail("expected ',' or ']'");
        }
    }

    bool hex4(uint32_t& cp) {
        if (pos_ + 4 > s_.size()) return fail("truncated \\u escape");
        cp = 0;
        for (int k = 0; k < 4; ++k) {
            const char h = s_[pos_ + (size_t) k]; cp <<= 4;
            if (h >= '0' && h <= '9') cp |= (uint32_t) (h - '0');
            else if (h >= 'a' && h <= 'f') cp |= (uint32_t) (h - 'a' + 10);
            else if (h >= 'A' && h <= 'F') cp |= (uint32_t) (h - 'A' + 10);
            else return fail("bad hex digit in \\u escape");
        }
        pos_ += 4; return true;
    }

    bool parseString(std::string& out) {
        ++pos_; out.clear();
        while (true) {
            if (pos_ >= s_.size()) return fail("unterminated string");
            const unsigned char c = (unsigned char) s_[pos_];
            if (c == '"') { ++pos_; return true; }
            if (c < 0x20) return fail("raw control character in string");
            if (c == '\\') {
                ++pos_;
                if (pos_ >= s_.size()) return fail("unterminated escape");
                const char e = s_[pos_++];
                switch (e) {
                    case '"': out += '"'; break;  case '\\': out += '\\'; break;
                    case '/': out += '/'; break;  case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break; case 'n': out += '\n'; break;
                    case 'r': out += '\r'; break; case 't': out += '\t'; break;
                    case 'u': {
                        uint32_t cp;
                        if (!hex4(cp)) return false;
                        if (cp >= 0xD800 && cp <= 0xDBFF) {
                            if (pos_ + 2 > s_.size() || s_[pos_] != '\\' || s_[pos_ + 1] != 'u')
                                return fail("lone high surrogate");
                            pos_ += 2;
                            uint32_t lo;
                            if (!hex4(lo)) return false;
                            if (lo < 0xDC00 || lo > 0xDFFF) return fail("invalid low surrogate");
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        } else if (cp >= 0xDC00 && cp <= 0xDFFF) return fail("lone low surrogate");
                        appendUtf8(out, cp);
                        break;
                    }
                    default: --pos_; return fail("invalid escape");
                }
                continue;
            }
            if (c < 0x80) { out += (char) c; ++pos_; continue; }
            const size_t start = pos_;
            if (!consumeUtf8(s_, pos_)) { pos_ = start; return fail("invalid UTF-8"); }
            out.append(s_, start, pos_ - start);
        }
    }

    bool parseNumber(JsonValue& out) {
        const size_t start = pos_;
        bool isFloat = false;
        if (s_[pos_] == '-') ++pos_;
        if (pos_ >= s_.size()) return fail("bad number");
        if (s_[pos_] == '0') { ++pos_; if (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') return fail("leading zero in number"); }
        else if (s_[pos_] >= '1' && s_[pos_] <= '9') { while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_; }
        else return fail("bad number");
        if (pos_ < s_.size() && s_[pos_] == '.') {
            isFloat = true; ++pos_;
            if (pos_ >= s_.size() || s_[pos_] < '0' || s_[pos_] > '9') return fail("bad fraction");
            while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
        }
        if (pos_ < s_.size() && (s_[pos_] == 'e' || s_[pos_] == 'E')) {
            isFloat = true; ++pos_;
            if (pos_ < s_.size() && (s_[pos_] == '+' || s_[pos_] == '-')) ++pos_;
            if (pos_ >= s_.size() || s_[pos_] < '0' || s_[pos_] > '9') return fail("bad exponent");
            while (pos_ < s_.size() && s_[pos_] >= '0' && s_[pos_] <= '9') ++pos_;
        }
        const std::string tok = s_.substr(start, pos_ - start);
        if (isFloat) {
            if (!opt_.allowFloats) { pos_ = start; return fail("floating point numbers are not allowed here"); }
            std::istringstream is(tok); is.imbue(std::locale::classic());
            double d = 0; is >> d;
            if (is.fail() || !std::isfinite(d)) { pos_ = start; return fail("number out of range"); }
            out = JsonValue(d); return true;
        }
        if (tok == "-0") { pos_ = start; return fail("negative zero is not allowed"); }
        // integer: manual accumulate with range check (no locale, no exceptions)
        const bool neg = tok[0] == '-';
        int64_t v = 0;
        for (size_t k = neg ? 1 : 0; k < tok.size(); ++k) {
            v = v * 10 + (tok[k] - '0');
            if (v > kMaxSafeInt) { pos_ = start; return fail("integer exceeds +/-(2^53-1)"); }
        }
        out = JsonValue(neg ? -v : v);
        return true;
    }

    const std::string& s_;
    JsonParseOptions opt_;
    size_t pos_ = 0;
    std::string err_;
    size_t errPos_ = 0;
};

inline void escapeString(const std::string& s, std::string& out) {
    static const char* hexd = "0123456789abcdef";
    out += '"';
    for (const char ch : s) {
        const unsigned char c = (unsigned char) ch;
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { out += "\\u00"; out += hexd[c >> 4]; out += hexd[c & 15]; }
                else out += ch;
        }
    }
    out += '"';
}

inline std::string formatDouble(double d) {
    std::string s;
    for (int prec = 15; prec <= 17; ++prec) {
        std::ostringstream os; os.imbue(std::locale::classic());
        os << std::setprecision(prec) << d; s = os.str();
        std::istringstream is(s); is.imbue(std::locale::classic());
        double back = 0; is >> back;
        if (back == d) break;
    }
    if (s.find_first_of(".eE") == std::string::npos) s += ".0";
    return s;
}

inline bool canon(const JsonValue& v, std::string& out, std::string* err) {
    switch (v.type()) {
        case JsonValue::Type::Null: out += "null"; return true;
        case JsonValue::Type::Bool: out += v.asBool() ? "true" : "false"; return true;
        case JsonValue::Type::Int: {
            const int64_t n = v.asInt();
            if (n > kMaxSafeInt || n < -kMaxSafeInt) { if (err) *err = "integer outside +/-(2^53-1)"; return false; }
            out += std::to_string(n); return true;
        }
        case JsonValue::Type::Double:
            if (err) *err = "floating point numbers cannot be canonicalized";
            return false;
        case JsonValue::Type::String: escapeString(v.asString(), out); return true;
        case JsonValue::Type::Array:
            out += '[';
            for (size_t i = 0; i < v.size(); ++i) { if (i) out += ','; if (!canon(v.at(i), out, err)) return false; }
            out += ']'; return true;
        case JsonValue::Type::Object:
            out += '{';
            for (size_t i = 0; i < v.size(); ++i) {
                if (i) out += ',';
                escapeString(v.keyAt(i), out); out += ':';
                if (!canon(v.valueAt(i), out, err)) return false;
            }
            out += '}'; return true;
    }
    return false;
}

inline void pretty(const JsonValue& v, std::string& out, int indent, int level) {
    auto nl = [&](int lv) { out += '\n'; out.append((size_t) (lv * indent), ' '); };
    switch (v.type()) {
        case JsonValue::Type::Null: out += "null"; break;
        case JsonValue::Type::Bool: out += v.asBool() ? "true" : "false"; break;
        case JsonValue::Type::Int: out += std::to_string(v.asInt()); break;
        case JsonValue::Type::Double: out += std::isfinite(v.asDouble()) ? formatDouble(v.asDouble()) : "null"; break;
        case JsonValue::Type::String: escapeString(v.asString(), out); break;
        case JsonValue::Type::Array:
            if (v.size() == 0) { out += "[]"; break; }
            out += '[';
            for (size_t i = 0; i < v.size(); ++i) { if (i) out += ','; nl(level + 1); pretty(v.at(i), out, indent, level + 1); }
            nl(level); out += ']'; break;
        case JsonValue::Type::Object:
            if (v.size() == 0) { out += "{}"; break; }
            out += '{';
            for (size_t i = 0; i < v.size(); ++i) {
                if (i) out += ',';
                nl(level + 1); escapeString(v.keyAt(i), out); out += ": ";
                pretty(v.valueAt(i), out, indent, level + 1);
            }
            nl(level); out += '}'; break;
    }
}

} // namespace json_detail

/** Parse a UTF-8 JSON text (no BOM). See header comment for the limits. */
inline JsonParseResult parseJson(const std::string& text, const JsonParseOptions& opt = {}) {
    return json_detail::Parser(text, opt).run();
}

/** Strips a leading UTF-8 BOM (PowerShell / Notepad write one). */
inline std::string stripUtf8Bom(std::string s) {
    if (s.size() >= 3 && (unsigned char) s[0] == 0xEF && (unsigned char) s[1] == 0xBB && (unsigned char) s[2] == 0xBF)
        s.erase(0, 3);
    return s;
}

/** Canonical bytes of `v` (apc-canon/1). Fails on floats / out-of-range ints. */
inline bool canonicalize(const JsonValue& v, std::string& out, std::string* err = nullptr) {
    out.clear();
    return json_detail::canon(v, out, err);
}

/** Canonical bytes of an object WITHOUT the member `member` (the signature). */
inline bool canonicalizeWithout(const JsonValue& obj, const std::string& member,
                                std::string& out, std::string* err = nullptr) {
    if (!obj.isObject()) { if (err) *err = "document is not a JSON object"; return false; }
    JsonValue copy = obj;
    copy.erase(member);
    return canonicalize(copy, out, err);
}

/** Human-readable (2-space) JSON for settings.json. Keys sorted. Doubles allowed. */
inline std::string toJson(const JsonValue& v, int indent = 2) {
    std::string out;
    json_detail::pretty(v, out, indent, 0);
    out += '\n';
    return out;
}

// ---------------------------------------------------------------------------
//  Encoding helpers
// ---------------------------------------------------------------------------

inline std::string base64Encode(const std::string& in) {
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((in.size() + 2) / 3) * 4);
    size_t i = 0;
    while (i + 2 < in.size()) {
        const uint32_t n = ((uint32_t) (unsigned char) in[i] << 16) | ((uint32_t) (unsigned char) in[i + 1] << 8) | (unsigned char) in[i + 2];
        out += tbl[(n >> 18) & 63]; out += tbl[(n >> 12) & 63]; out += tbl[(n >> 6) & 63]; out += tbl[n & 63];
        i += 3;
    }
    if (i + 1 == in.size()) {
        const uint32_t n = (uint32_t) (unsigned char) in[i] << 16;
        out += tbl[(n >> 18) & 63]; out += tbl[(n >> 12) & 63]; out += "==";
    } else if (i + 2 == in.size()) {
        const uint32_t n = ((uint32_t) (unsigned char) in[i] << 16) | ((uint32_t) (unsigned char) in[i + 1] << 8);
        out += tbl[(n >> 18) & 63]; out += tbl[(n >> 12) & 63]; out += tbl[(n >> 6) & 63]; out += '=';
    }
    return out;
}

/** Strict standard-alphabet base64 with padding. Returns false on any defect. */
inline bool base64Decode(const std::string& in, std::string& out) {
    out.clear();
    if (in.size() % 4 != 0) return false;
    auto val = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
    };
    for (size_t i = 0; i < in.size(); i += 4) {
        const bool last = i + 4 == in.size();
        const int a = val(in[i]), b = val(in[i + 1]);
        if (a < 0 || b < 0) return false;
        if (in[i + 2] == '=') {
            if (!last || in[i + 3] != '=') return false;
            out += (char) ((a << 2) | (b >> 4));
            continue;
        }
        const int c = val(in[i + 2]);
        if (c < 0) return false;
        if (in[i + 3] == '=') {
            if (!last) return false;
            out += (char) ((a << 2) | (b >> 4)); out += (char) (((b & 15) << 4) | (c >> 2));
            continue;
        }
        const int d = val(in[i + 3]);
        if (d < 0) return false;
        out += (char) ((a << 2) | (b >> 4)); out += (char) (((b & 15) << 4) | (c >> 2)); out += (char) (((c & 3) << 6) | d);
    }
    return true;
}

inline std::string hexEncode(const std::string& in) {
    static const char* hexd = "0123456789abcdef";
    std::string out;
    for (const char ch : in) { out += hexd[((unsigned char) ch) >> 4]; out += hexd[((unsigned char) ch) & 15]; }
    return out;
}

inline bool isLowerHex(const std::string& s, size_t len) {
    if (s.size() != len) return false;
    for (const char c : s) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

// ---------------------------------------------------------------------------
//  SHA-256 / HMAC-SHA-256
// ---------------------------------------------------------------------------

class Sha256 {
public:
    Sha256() { reset(); }
    void reset() {
        h_[0] = 0x6a09e667; h_[1] = 0xbb67ae85; h_[2] = 0x3c6ef372; h_[3] = 0xa54ff53a;
        h_[4] = 0x510e527f; h_[5] = 0x9b05688c; h_[6] = 0x1f83d9ab; h_[7] = 0x5be0cd19;
        len_ = 0; fill_ = 0;
    }
    void update(const void* data, size_t n) {
        const unsigned char* p = (const unsigned char*) data;
        len_ += n;
        while (n > 0) {
            const size_t take = std::min(n, (size_t) 64 - fill_);
            std::copy(p, p + take, buf_ + fill_);
            fill_ += take; p += take; n -= take;
            if (fill_ == 64) { block(buf_); fill_ = 0; }
        }
    }
    void update(const std::string& s) { update(s.data(), s.size()); }
    /** Returns the 32 raw digest bytes and resets the object. */
    std::string finish() {
        const uint64_t bits = (uint64_t) len_ * 8;
        const unsigned char one = 0x80, zero = 0;
        update(&one, 1);
        while (fill_ != 56) update(&zero, 1);
        unsigned char lenb[8];
        for (int i = 0; i < 8; ++i) lenb[i] = (unsigned char) (bits >> (56 - 8 * i));
        update(lenb, 8);
        std::string out(32, '\0');
        for (int i = 0; i < 8; ++i) {
            out[(size_t) i * 4] = (char) (h_[i] >> 24); out[(size_t) i * 4 + 1] = (char) (h_[i] >> 16);
            out[(size_t) i * 4 + 2] = (char) (h_[i] >> 8); out[(size_t) i * 4 + 3] = (char) h_[i];
        }
        reset();
        return out;
    }
private:
    static uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
    void block(const unsigned char* p) {
        static const uint32_t K[64] = {
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
        uint32_t w[64];
        for (int i = 0; i < 16; ++i)
            w[i] = ((uint32_t) p[i * 4] << 24) | ((uint32_t) p[i * 4 + 1] << 16) | ((uint32_t) p[i * 4 + 2] << 8) | p[i * 4 + 3];
        for (int i = 16; i < 64; ++i) {
            const uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            const uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }
        uint32_t a = h_[0], b = h_[1], c = h_[2], d = h_[3], e = h_[4], f = h_[5], g = h_[6], h = h_[7];
        for (int i = 0; i < 64; ++i) {
            const uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const uint32_t ch = (e & f) ^ (~e & g);
            const uint32_t t1 = h + S1 + ch + K[i] + w[i];
            const uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
            const uint32_t t2 = S0 + mj;
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }
        h_[0] += a; h_[1] += b; h_[2] += c; h_[3] += d; h_[4] += e; h_[5] += f; h_[6] += g; h_[7] += h;
    }
    uint32_t h_[8];
    unsigned char buf_[64];
    size_t fill_ = 0;
    uint64_t len_ = 0;
};

inline std::string sha256Raw(const std::string& data) { Sha256 s; s.update(data); return s.finish(); }
inline std::string sha256Hex(const std::string& data) { return hexEncode(sha256Raw(data)); }

inline std::string hmacSha256(const std::string& key, const std::string& msg) {
    std::string k = key.size() > 64 ? sha256Raw(key) : key;
    k.resize(64, '\0');
    std::string ipad(64, '\0'), opad(64, '\0');
    for (size_t i = 0; i < 64; ++i) { ipad[i] = (char) (k[i] ^ 0x36); opad[i] = (char) (k[i] ^ 0x5c); }
    return sha256Raw(opad + sha256Raw(ipad + msg));
}

/** Constant-time (length-leaking only) string equality. */
inline bool constantTimeEquals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char d = 0;
    for (size_t i = 0; i < a.size(); ++i) d |= (unsigned char) (a[i] ^ b[i]);
    return d == 0;
}

// ---------------------------------------------------------------------------
//  File helpers (std::filesystem, no JUCE)
// ---------------------------------------------------------------------------

namespace sysutil {

enum class ReadStatus { Ok, NotFound, Error };

inline long currentProcessId() {
#if defined(_WIN32)
    return (long) _getpid();
#else
    return (long) getpid();
#endif
}

inline ReadStatus readWholeFile(const std::filesystem::path& p, std::string& out, std::string& err,
                                size_t maxBytes = 16u * 1024u * 1024u) {
    out.clear(); err.clear();
    std::error_code ec;
    if (!std::filesystem::exists(p, ec)) return ReadStatus::NotFound;
    std::ifstream f(p, std::ios::binary);
    if (!f) { err = "cannot open " + p.string(); return ReadStatus::Error; }
    char buf[8192];
    while (f.read(buf, sizeof buf) || f.gcount() > 0) {
        out.append(buf, (size_t) f.gcount());
        if (out.size() > maxBytes) { out.clear(); err = "file too large: " + p.string(); return ReadStatus::Error; }
    }
    return ReadStatus::Ok;
}

/** temp file + flush + rename over the target. Retries rename briefly because on
 *  Windows a concurrent reader can hold the target open for a few ms. */
inline bool writeFileAtomic(const std::filesystem::path& target, const std::string& data, std::string& err) {
    static std::atomic<unsigned> counter { 0 };
    std::error_code ec;
    if (target.has_parent_path()) std::filesystem::create_directories(target.parent_path(), ec);
    std::filesystem::path tmp = target;
    tmp += ".tmp." + std::to_string(currentProcessId()) + "." + std::to_string(counter.fetch_add(1));
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f) { err = "cannot create " + tmp.string(); return false; }
        f.write(data.data(), (std::streamsize) data.size());
        f.flush();
        if (!f) { err = "write failed: " + tmp.string(); std::filesystem::remove(tmp, ec); return false; }
    }
    for (int attempt = 0; attempt < 100; ++attempt) {
        std::filesystem::rename(tmp, target, ec);
        if (!ec) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    err = "cannot replace " + target.string() + ": " + ec.message();
    std::filesystem::remove(tmp, ec);
    return false;
}

/** SHA-256 (lowercase hex) of a file, plus its size. */
inline bool sha256File(const std::filesystem::path& p, std::string& hexOut, int64_t& sizeOut, std::string& err) {
    std::ifstream f(p, std::ios::binary);
    if (!f) { err = "cannot open " + p.string(); return false; }
    Sha256 h; sizeOut = 0;
    char buf[65536];
    while (f.read(buf, sizeof buf) || f.gcount() > 0) { h.update(buf, (size_t) f.gcount()); sizeOut += (int64_t) f.gcount(); }
    hexOut = hexEncode(h.finish());
    return true;
}

} // namespace sysutil
} // namespace apc
