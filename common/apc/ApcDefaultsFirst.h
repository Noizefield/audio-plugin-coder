// ApcDefaultsFirst.h - defaults-first state restore + append-only checks (decision P-07, X-01).
//
// Header-only, C++17, NO JUCE dependency, no JSON dependency: the plugin converts its
// parsed file/chunk (juce::var, nlohmann, ...) into a key->Value map and back.
//
// Restore algorithm (the only safe way to load files written by older versions):
//   1. every DECLARED parameter starts at its declared default;
//   2. every key found in the file is applied on top (validated, clamped);
//   3. keys the plugin does not declare are NOT dropped - they are returned in
//      RestoreReport::unknown so the caller can write them back on the next save
//      (a preset saved by a newer version survives a round trip through an older one).
// Missing parameters (added since the file was written) therefore come up neutral and
// old files load forever.
//
// Value rules (P-04): real-world units, never normalized; a choice parameter is stored as its
// LABEL string - a number for a choice is rejected (falls back to the default and is reported).
//
// NOTE std::variant pitfall: Value("saw") picks bool on some compilers. Always write
// Value(std::string("saw")).
//
// Append-only (X-01/P-07): parameter ids are immutable and choice lists may only grow at the end.
// checkAppendOnly() compares the manifest of the last RELEASED build with the current one; run it
// in a unit test so a violating change fails CI instead of silently corrupting user presets.
#pragma once

#include <cmath>
#include <map>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace apc
{
using Value = std::variant<double, bool, std::string>;

enum class ParamKind { Float, Int, Bool, Choice };

struct ParamDecl
{
    std::string id;                   // immutable, lowercase snake_case (unit suffix: _hz _s _st _db ...)
    ParamKind kind = ParamKind::Float;
    Value defaultValue = 0.0;         // double / bool / choice label (string)
    double minValue = 0.0;            // Float / Int
    double maxValue = 1.0;
    std::vector<std::string> choices; // Choice: ordered, APPEND-ONLY
};

struct RestoreReport
{
    std::vector<std::string> applied;     // taken from the file
    std::vector<std::string> defaulted;   // not in the file -> declared default
    std::vector<std::string> clamped;     // applied after clamping into [min,max]
    std::vector<std::pair<std::string, std::string>> invalid;   // id, reason -> default used
    std::map<std::string, Value> unknown; // in the file but not declared: preserved for the next save
};

struct RestoreResult
{
    std::map<std::string, Value> values;  // one entry per declared parameter
    RestoreReport report;
};

namespace detail
{
inline bool isFiniteNumber (double v) { return std::isfinite (v); }
} // namespace detail

// Pure resolution step (no side effects) - ideal for unit tests.
inline RestoreResult resolveDefaultsFirst (const std::vector<ParamDecl>& decls, const std::map<std::string, Value>& stored)
{
    RestoreResult out;
    std::map<std::string, bool> declared;

    for (const auto& d : decls)
    {
        declared[d.id] = true;
        out.values[d.id] = d.defaultValue;

        const auto it = stored.find (d.id);
        if (it == stored.end()) { out.report.defaulted.push_back (d.id); continue; }
        const Value& v = it->second;

        switch (d.kind)
        {
            case ParamKind::Choice:
            {
                if (const auto* s = std::get_if<std::string> (&v))
                {
                    bool known = false;
                    for (const auto& c : d.choices) known = known || c == *s;
                    if (known) { out.values[d.id] = *s; out.report.applied.push_back (d.id); }
                    else out.report.invalid.emplace_back (d.id, "unknown choice label \"" + *s + "\"");
                }
                else out.report.invalid.emplace_back (d.id, "choice must be stored as its label string, not an index");
                break;
            }
            case ParamKind::Bool:
            {
                if (const auto* b = std::get_if<bool> (&v)) { out.values[d.id] = *b; out.report.applied.push_back (d.id); }
                else out.report.invalid.emplace_back (d.id, "expected a boolean");
                break;
            }
            case ParamKind::Float:
            case ParamKind::Int:
            {
                const auto* n = std::get_if<double> (&v);
                if (n == nullptr || ! detail::isFiniteNumber (*n)) { out.report.invalid.emplace_back (d.id, "expected a finite number"); break; }
                double x = d.kind == ParamKind::Int ? std::round (*n) : *n;
                bool clamped = false;
                if (x < d.minValue) { x = d.minValue; clamped = true; }
                if (x > d.maxValue) { x = d.maxValue; clamped = true; }
                out.values[d.id] = x;
                out.report.applied.push_back (d.id);
                if (clamped) out.report.clamped.push_back (d.id);
                break;
            }
        }
    }

    for (const auto& kv : stored)
        if (declared.find (kv.first) == declared.end())
            out.report.unknown[kv.first] = kv.second;
    return out;
}

// Resolve, then hand every declared parameter to `set(const ParamDecl&, const Value&)` exactly
// once, in declaration order. `set` converts the real-world value to the host's representation
// (e.g. normalised value + notifyHost) - the file format never sees that conversion.
template <class Setter>
RestoreReport applyDefaultsFirst (const std::vector<ParamDecl>& decls, const std::map<std::string, Value>& stored, Setter&& set)
{
    RestoreResult r = resolveDefaultsFirst (decls, stored);
    for (const auto& d : decls)
        set (d, r.values.at (d.id));
    return std::move (r.report);
}

// Combine the live parameter values with the unknown keys preserved by the last restore,
// for writing. Declared parameters always win over a stale preserved key.
inline std::map<std::string, Value> mergeForSave (const std::map<std::string, Value>& current,
                                                   const std::map<std::string, Value>& preservedUnknown)
{
    std::map<std::string, Value> out = preservedUnknown;
    for (const auto& kv : current) out[kv.first] = kv.second;
    return out;
}

struct AppendOnlyViolation
{
    std::string id;
    std::string reason;
};

// released = manifest of the last shipped build, current = this build.
// Allowed: new parameters, new choices APPENDED. Forbidden: removed/renamed id, changed kind,
// removed/renamed/reordered choice. Same rules as `apc presets check-manifest`.
inline std::vector<AppendOnlyViolation> checkAppendOnly (const std::vector<ParamDecl>& released, const std::vector<ParamDecl>& current)
{
    std::vector<AppendOnlyViolation> out;
    for (const auto& r : released)
    {
        const ParamDecl* c = nullptr;
        for (const auto& cand : current) if (cand.id == r.id) { c = &cand; break; }
        if (c == nullptr) { out.push_back ({ r.id, "removed or renamed (parameter ids are immutable)" }); continue; }
        if (c->kind != r.kind) { out.push_back ({ r.id, "parameter kind changed" }); continue; }
        if (r.kind != ParamKind::Choice) continue;
        for (std::size_t i = 0; i < r.choices.size(); ++i)
        {
            if (i >= c->choices.size() || c->choices[i] != r.choices[i])
            {
                bool still = false;
                for (const auto& cc : c->choices) still = still || cc == r.choices[i];
                out.push_back ({ r.id, still ? "choice \"" + r.choices[i] + "\" reordered"
                                             : "choice \"" + r.choices[i] + "\" removed or renamed" });
                break;
            }
        }
    }
    return out;
}

} // namespace apc
