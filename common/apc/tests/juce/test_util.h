// Shared helpers for the JUCE-side native tests: tiny test registry, temp dirs, fixture copies, a fake
// "plugin" (parameter model behind apc::presets::LiveState). No test framework.
#pragma once

#include "apc/juce/ApcPresetStore.h"

#include <cstdio>
#include <iostream>

#ifndef APC_REPO_ROOT
 #error APC_REPO_ROOT must be defined by CMake
#endif

namespace t
{
namespace fs = std::filesystem;

inline int& checks() { static int n = 0; return n; }
inline int& failures() { static int n = 0; return n; }
inline const char*& currentTest() { static const char* n = ""; return n; }

struct Case { const char* name; void (*fn)(); };
inline std::vector<Case>& registry() { static std::vector<Case> r; return r; }
struct Reg { Reg (const char* n, void (*f)()) { registry().push_back ({ n, f }); } };

#define TEST(name) static void name(); static ::t::Reg reg_##name (#name, name); static void name()

#define CHECK(cond)                                                                                         \
    do {                                                                                                    \
        ++::t::checks();                                                                                    \
        if (! (cond)) {                                                                                     \
            ++::t::failures();                                                                              \
            std::cout << "  FAIL [" << ::t::currentTest() << "] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
        }                                                                                                   \
    } while (0)

#define CHECK_EQ(a, b)                                                                                      \
    do {                                                                                                    \
        ++::t::checks();                                                                                    \
        const auto va_ = (a);                                                                               \
        const auto vb_ = (b);                                                                               \
        if (! (va_ == vb_)) {                                                                               \
            ++::t::failures();                                                                              \
            std::cout << "  FAIL [" << ::t::currentTest() << "] " << __FILE__ << ":" << __LINE__ << "  " #a " == " #b \
                      << "\n    got:      " << ::t::show (va_) << "\n    expected: " << ::t::show (vb_) << "\n"; \
        }                                                                                                   \
    } while (0)

template <class T> std::string show (const T& v) { std::ostringstream o; o << v; return o.str(); }
inline std::string show (const juce::String& v) { return v.toStdString(); }
inline std::string show (const std::vector<std::string>& v) { std::string s = "["; for (auto& x : v) s += x + ","; return s + "]"; }

inline int runAll()
{
    for (const auto& c : registry())
    {
        currentTest() = c.name;
        const int before = failures();
        try { c.fn(); }
        catch (const std::exception& e) { ++failures(); std::cout << "  FAIL [" << c.name << "] exception: " << e.what() << "\n"; }
        std::cout << (failures() == before ? "[ ok ] " : "[FAIL] ") << c.name << "\n";
    }
    std::cout << "\n" << checks() << " check(s), " << failures() << " failure(s)\n";
    return failures() == 0 ? 0 : 1;
}

// ---------------------------------------------------------------- temp dirs / fixtures
inline fs::path& tempRoot()
{
    static fs::path p;
    if (p.empty())
    {
        p = fs::temp_directory_path() / ("apc-juce-tests-" + std::to_string ((long long) apc::sysutil::currentProcessId()) + "-" + std::to_string ((long long) std::time (nullptr)));
        std::error_code ec;
        fs::create_directories (p, ec);
    }
    return p;
}

inline fs::path freshDir (const std::string& name)
{
    const fs::path d = tempRoot() / name;
    std::error_code ec;
    fs::remove_all (d, ec);
    fs::create_directories (d, ec);
    return d;
}

inline fs::path fixtures() { return fs::path (APC_REPO_ROOT) / "test" / "fixtures" / "presets"; }

inline void copyTree (const fs::path& from, const fs::path& to)
{
    std::error_code ec;
    fs::create_directories (to, ec);
    fs::copy (from, to, fs::copy_options::recursive | fs::copy_options::overwrite_existing, ec);
    if (ec) std::cout << "  copyTree failed: " << from << " -> " << to << ": " << ec.message() << "\n";
}

inline std::string slurp (const fs::path& p)
{
    std::string s;
    return apc::readFileToString (p, s).ok ? s : std::string ("<unreadable>");
}
inline bool exists (const fs::path& p) { std::error_code ec; return fs::exists (p, ec); }
inline void writeText (const fs::path& p, const std::string& s) { apc::atomicWrite (p, s); }

// App-data layout rooted in a fresh temp folder: <tmp>/<name>/<Mfr>/<Plug>/{presets,cache,...}
inline apc::PresetLayout layoutIn (const fs::path& base, const std::string& plug = "Plug")
{
    const std::string b = apc::presets::util::pathToUtf8 (base);
    return apc::makeLayout (apc::hostOs(), apc::DataScope::PerUser, "Mfr", plug,
                            [b] (const std::string& k) -> std::optional<std::string>
                            { if (k == "APC_PRESET_ROOT") return b; return std::nullopt; });
}

inline apc::presets::StoreConfig typedConfig (const apc::PresetLayout& l)
{
    apc::presets::StoreConfig c;
    c.layout = l; c.flat = false;
    c.soundExt = ".snd"; c.kitExt = ".kit"; c.seqExt = ".seq"; c.patchExt = ".pat";
    c.pluginName = "FixturePlugin"; c.appVersion = "1.1.0";
    return c;
}
inline apc::presets::StoreConfig flatConfig (const apc::PresetLayout& l)
{
    apc::presets::StoreConfig c;
    c.layout = l; c.flat = true; c.presetExt = ".preset";
    c.pluginName = "FixturePlugin"; c.appVersion = "1.1.0";
    return c;
}

// ---------------------------------------------------------------- a fake plugin behind LiveState
inline apc::ParamDecl floatP (const char* id, double lo, double hi, double def)
{
    apc::ParamDecl d; d.id = id; d.kind = apc::ParamKind::Float; d.minValue = lo; d.maxValue = hi; d.defaultValue = def; return d;
}
inline apc::ParamDecl choiceP (const char* id, std::vector<std::string> ch, const std::string& def)
{
    apc::ParamDecl d; d.id = id; d.kind = apc::ParamKind::Choice; d.choices = std::move (ch); d.defaultValue = def; return d;
}
inline apc::ParamDecl boolP (const char* id, bool def)
{
    apc::ParamDecl d; d.id = id; d.kind = apc::ParamKind::Bool; d.defaultValue = def; return d;
}

// "FixturePlugin" parameter manifest v2 (golden): v1 + osc1_sub_level + unison_on, plus the typed-fixture extras.
inline std::vector<apc::ParamDecl> typedDecls()
{
    return { choiceP ("osc1_wave", { "saw", "square", "pulse" }, "saw"), floatP ("osc1_tune_st", -24, 24, 0),
             floatP ("filter_cutoff_hz", 20, 20000, 1000), floatP ("filter_res", 0, 1, 0.2), floatP ("drive_amount", 0, 1, 0),
             floatP ("amp_env_attack_s", 0, 10, 0.005), floatP ("amp_env_release_s", 0, 10, 0.3),
             floatP ("osc1_sub_level", 0, 1, 0.25), boolP ("unison_on", false) };
}
inline std::vector<apc::ParamDecl> flatDecls()
{
    return { floatP ("decay_s", 0.1, 20, 2), floatP ("predelay_ms", 0, 200, 10), floatP ("lowcut_hz", 20, 1000, 20),
             floatP ("highcut_hz", 1000, 20000, 20000), floatP ("mix_pct", 0, 100, 30), choiceP ("mode", { "plate", "hall", "room" }, "plate") };
}

struct FakeLive
{
    std::vector<apc::ParamDecl> decls;
    std::map<std::string, apc::Value> values;
    juce::var extras = apc::presets::util::newObject();   // the "modulation" etc. of the fake plugin
    juce::var engine;
    juce::var lastRefs;
    int setCalls = 0, batchDepth = 0;
    std::vector<std::string> setOrder;

    explicit FakeLive (std::vector<apc::ParamDecl> d) : decls (std::move (d))
    {
        for (const auto& p : decls) values[p.id] = p.defaultValue;
        engine = apc::presets::util::newObject();
        apc::presets::util::set (engine, "oversampling", 2);
        apc::presets::util::set (engine, "quality", "high");
    }

    void user (const std::string& id, apc::Value v) { values[id] = std::move (v); }
    double num (const std::string& id) const { return std::get<double> (values.at (id)); }
    std::string str (const std::string& id) const { return std::get<std::string> (values.at (id)); }

    apc::presets::LiveState make()
    {
        namespace pu = apc::presets::util;
        apc::presets::LiveState ls;
        ls.decls = decls;
        ls.snapshotParams = [this] { return values; };
        ls.setParam = [this] (const apc::ParamDecl& d, const apc::Value& v) { values[d.id] = v; ++setCalls; setOrder.push_back (d.id); };
        ls.snapshotExtras = [this] { return extras.clone(); };
        ls.applyExtras = [this] (const juce::var& doc, const juce::var& refs)
        {
            lastRefs = refs;
            auto e = pu::newObject();
            if (pu::has (doc, "modulation")) pu::set (e, "modulation", pu::get (doc, "modulation"));
            extras = e;
        };
        ls.getEngine = [this] { return engine.clone(); };
        ls.setEngine = [this] (const juce::var& e) { engine = e.clone(); };
        ls.beginBatch = [this] { ++batchDepth; };
        ls.endBatch = [this] { --batchDepth; };
        return ls;
    }
};

inline std::vector<std::string> ids (const juce::var& list)
{
    std::vector<std::string> out;
    if (const auto* a = apc::presets::util::get (list, "items").getArray())
        for (const auto& it : *a) out.push_back (apc::presets::util::getStr (it, "id"));
    return out;
}
inline std::vector<std::string> names (const juce::var& list)
{
    std::vector<std::string> out;
    if (const auto* a = apc::presets::util::get (list, "items").getArray())
        for (const auto& it : *a) out.push_back (apc::presets::util::getStr (it, "name"));
    return out;
}

inline juce::var parseV (const std::string& text)
{
    juce::var v;
    std::string err;
    apc::presets::util::parseJson (text, v, err);
    return v;
}

inline juce::var query (const char* json) { return parseV (json); }

} // namespace t
