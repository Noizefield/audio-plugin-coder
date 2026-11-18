// ApcSemVer.h - Semantic Versioning 2.0.0 parse / compare. std only, no JUCE.
//
// Accepts an optional leading 'v' ("v1.2.0" as written in status.json).
// Precedence follows semver.org section 11:
//   * major.minor.patch compared numerically;
//   * a version WITH a pre-release is LOWER than the same version without;
//   * pre-release identifiers are compared left to right: numeric identifiers
//     numerically, alphanumeric ones in ASCII order, numeric < alphanumeric,
//     and a longer set wins when all earlier identifiers are equal;
//   * build metadata ("+build.5") is parsed and kept but IGNORED for ordering.
//
// Limits: each numeric part must fit in 31 bits; no leading zeros; the whole
// string must be consumed (no trailing garbage, no whitespace).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace apc {

struct SemVer {
    uint32_t major = 0, minor = 0, patch = 0;
    std::vector<std::string> pre;   // pre-release identifiers
    std::string build;              // build metadata (not compared)

    std::string toString() const {
        std::string s = std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(patch);
        for (size_t i = 0; i < pre.size(); ++i) s += (i ? "." : "-") + pre[i];
        if (!build.empty()) s += "+" + build;
        return s;
    }
};

namespace semver_detail {

inline bool isDigits(const std::string& s) {
    if (s.empty()) return false;
    for (const char c : s) if (c < '0' || c > '9') return false;
    return true;
}
inline bool isIdentChars(const std::string& s) {
    if (s.empty()) return false;
    for (const char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-')) return false;
    return true;
}
inline bool parseNum(const std::string& s, uint32_t& out) {
    if (!isDigits(s) || (s.size() > 1 && s[0] == '0') || s.size() > 9) return false;
    uint64_t v = 0;
    for (const char c : s) v = v * 10 + (uint64_t) (c - '0');
    if (v > 0x7FFFFFFFu) return false;
    out = (uint32_t) v;
    return true;
}
inline std::vector<std::string> split(const std::string& s, char sep) {
    std::vector<std::string> parts;
    size_t start = 0;
    while (true) {
        const size_t p = s.find(sep, start);
        parts.push_back(s.substr(start, p == std::string::npos ? p : p - start));
        if (p == std::string::npos) break;
        start = p + 1;
    }
    return parts;
}

} // namespace semver_detail

/** Parses "1.2.3", "v1.2.3-rc.1+build.7". Returns false on any defect. */
inline bool parseSemVer(const std::string& text, SemVer& out) {
    using namespace semver_detail;
    std::string s = text;
    if (!s.empty() && (s[0] == 'v' || s[0] == 'V')) s.erase(0, 1);
    SemVer v;
    const size_t plus = s.find('+');
    if (plus != std::string::npos) {
        v.build = s.substr(plus + 1);
        s.erase(plus);
        for (const auto& id : split(v.build, '.')) if (!isIdentChars(id)) return false;
    }
    const size_t dash = s.find('-');
    if (dash != std::string::npos) {
        v.pre = split(s.substr(dash + 1), '.');
        s.erase(dash);
        for (const auto& id : v.pre) {
            if (!isIdentChars(id)) return false;
            if (isDigits(id) && id.size() > 1 && id[0] == '0') return false;   // numeric ids: no leading zeros
        }
    }
    const auto nums = split(s, '.');
    if (nums.size() != 3) return false;
    if (!parseNum(nums[0], v.major) || !parseNum(nums[1], v.minor) || !parseNum(nums[2], v.patch)) return false;
    out = std::move(v);
    return true;
}

/** -1 if a < b, 0 if equal precedence, +1 if a > b. Build metadata is ignored. */
inline int compareSemVer(const SemVer& a, const SemVer& b) {
    using namespace semver_detail;
    if (a.major != b.major) return a.major < b.major ? -1 : 1;
    if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch != b.patch) return a.patch < b.patch ? -1 : 1;
    if (a.pre.empty() && b.pre.empty()) return 0;
    if (a.pre.empty()) return 1;     // release > pre-release
    if (b.pre.empty()) return -1;
    const size_t n = a.pre.size() < b.pre.size() ? a.pre.size() : b.pre.size();
    for (size_t i = 0; i < n; ++i) {
        const std::string& x = a.pre[i];
        const std::string& y = b.pre[i];
        const bool xn = isDigits(x), yn = isDigits(y);
        if (xn && yn) {
            // compare numerically without overflow: by length, then lexicographically
            if (x.size() != y.size()) return x.size() < y.size() ? -1 : 1;
            const int c = x.compare(y);
            if (c != 0) return c < 0 ? -1 : 1;
        } else if (xn != yn) {
            return xn ? -1 : 1;      // numeric < alphanumeric
        } else {
            const int c = x.compare(y);
            if (c != 0) return c < 0 ? -1 : 1;
        }
    }
    if (a.pre.size() != b.pre.size()) return a.pre.size() < b.pre.size() ? -1 : 1;
    return 0;
}

/** String convenience: false in `ok` when either side does not parse. */
inline int compareSemVer(const std::string& a, const std::string& b, bool& ok) {
    SemVer x, y;
    ok = parseSemVer(a, x) && parseSemVer(b, y);
    return ok ? compareSemVer(x, y) : 0;
}

/** True when `candidate` has strictly higher precedence than `current`. */
inline bool isNewer(const SemVer& candidate, const SemVer& current) { return compareSemVer(candidate, current) > 0; }

/** True when installing `candidate` over `installed` would be a downgrade. */
inline bool isDowngrade(const SemVer& candidate, const SemVer& installed) { return compareSemVer(candidate, installed) < 0; }

} // namespace apc
