// Tests for ApcAtomicFile.h, ApcPaths.h and ApcDefaultsFirst.h.
// Self-contained (no framework). Build + run: see test/apc-cpp-presets.test.js
//   MSVC: cl /nologo /std:c++17 /EHsc /W4 /permissive- test_presets_backend.cpp
//   GCC/Clang: c++ -std=c++17 -Wall -Wextra test_presets_backend.cpp
// Exit code 0 = all passed.

#include "../ApcAtomicFile.h"
#include "../ApcDefaultsFirst.h"
#include "../ApcPaths.h"

#include <cstdio>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>

namespace
{
int g_checks = 0;
int g_failures = 0;
const char* g_test = "";

#define CHECK(cond)                                                                              \
    do {                                                                                         \
        ++g_checks;                                                                              \
        if (! (cond)) {                                                                          \
            ++g_failures;                                                                        \
            std::cout << "  FAIL [" << g_test << "] " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; \
        }                                                                                        \
    } while (0)

#define CHECK_EQ(a, b)                                                                           \
    do {                                                                                         \
        ++g_checks;                                                                              \
        const auto va_ = (a);                                                                    \
        const auto vb_ = (b);                                                                    \
        if (! (va_ == vb_)) {                                                                    \
            ++g_failures;                                                                        \
            std::cout << "  FAIL [" << g_test << "] " << __FILE__ << ":" << __LINE__ << "  " #a " == " #b \
                      << "\n    got:      " << va_ << "\n    expected: " << vb_ << "\n";          \
        }                                                                                        \
    } while (0)

namespace fs = std::filesystem;

fs::path g_tmpRoot;

std::string slurp (const fs::path& p)
{
    std::string s;
    const auto r = apc::readFileToString (p, s);
    return r.ok ? s : std::string ("<unreadable>");
}

bool pathExists (const fs::path& p) { std::error_code ec; return fs::exists (p, ec); }

fs::path freshDir (const char* name)
{
    const fs::path d = g_tmpRoot / name;
    std::error_code ec;
    fs::remove_all (d, ec);
    fs::create_directories (d, ec);
    return d;
}

fs::path tmpFileFor (const fs::path& target)
{
    fs::path t = target;
    t += ".tmp-" + std::to_string (apc::detail::currentPid());
    return t;
}

void run (const char* name, void (*fn)())
{
    g_test = name;
    const int before = g_failures;
    fn();
    std::cout << (g_failures == before ? "[ ok ] " : "[FAIL] ") << name << "\n";
}

// ---------------------------------------------------------------------------------------------

void testSanitize()
{
    using apc::sanitizeFilename;
    CHECK_EQ (sanitizeFilename ("a/b\\c:d*e?f\"g<h>i|j"), std::string ("a-b-c-d-e-f-g-h-i-j"));
    CHECK_EQ (sanitizeFilename (""), std::string ("untitled"));
    CHECK_EQ (sanitizeFilename ("..."), std::string ("untitled"));
    CHECK_EQ (sanitizeFilename ("  lead  "), std::string ("lead"));
    CHECK_EQ (sanitizeFilename ("name. ."), std::string ("name"));
    CHECK_EQ (sanitizeFilename ("CON"), std::string ("_CON"));
    CHECK_EQ (sanitizeFilename ("con.txt"), std::string ("_con.txt"));
    CHECK_EQ (sanitizeFilename ("Lpt9"), std::string ("_Lpt9"));
    CHECK_EQ (sanitizeFilename ("console"), std::string ("console"));
    CHECK_EQ (sanitizeFilename ("Sub Distort 2"), std::string ("Sub Distort 2"));
    CHECK_EQ (sanitizeFilename (std::string ("tab\there")), std::string ("tab-here"));

    // 200 x U+00E9 (2 bytes each): must cut on a code point boundary at <= 120 bytes
    std::string longName;
    for (int i = 0; i < 200; ++i) longName += "\xC3\xA9";
    const std::string cut = sanitizeFilename (longName);
    CHECK (cut.size() <= 120);
    CHECK_EQ (cut.size() % 2, static_cast<std::size_t> (0));
    CHECK ((static_cast<unsigned char> (cut.back()) & 0xC0) == 0x80);   // ends on a continuation byte of a full char
}

void testAtomicWriteBasics()
{
    const fs::path dir = freshDir ("atomic-basics");
    const fs::path f = dir / "sub" / "Preset A.snd";   // parent folder is created on demand

    auto r = apc::atomicWrite (f, "version-1");
    CHECK (r.ok);
    CHECK_EQ (slurp (f), std::string ("version-1"));
    CHECK (! pathExists (tmpFileFor (f)));

    r = apc::atomicWrite (f, "version-2-longer-content");
    CHECK (r.ok);
    CHECK_EQ (slurp (f), std::string ("version-2-longer-content"));

    r = apc::atomicWrite (f, "v3");   // shorter content must not leave a stale tail
    CHECK (r.ok);
    CHECK_EQ (slurp (f), std::string ("v3"));
    CHECK (! pathExists (tmpFileFor (f)));

    // embedded NUL bytes survive
    const std::string bin ("a\0b\0c", 5);
    r = apc::atomicWrite (dir / "bin.dat", bin);
    CHECK (r.ok);
    CHECK_EQ (slurp (dir / "bin.dat"), bin);
}

void testBackup()
{
    const fs::path dir = freshDir ("atomic-backup");
    const fs::path f = dir / "keep.snd";
    apc::AtomicWriteOptions opt;
    opt.keepBackup = true;

    CHECK (apc::atomicWrite (f, "first", opt).ok);
    CHECK (! pathExists (dir / "keep.snd.bak"));          // nothing to back up yet
    CHECK (apc::atomicWrite (f, "second", opt).ok);
    CHECK_EQ (slurp (dir / "keep.snd.bak"), std::string ("first"));
    CHECK (apc::atomicWrite (f, "third", opt).ok);
    CHECK_EQ (slurp (dir / "keep.snd.bak"), std::string ("second"));   // exactly ONE .bak, always the previous
    CHECK_EQ (slurp (f), std::string ("third"));
}

// Kill-mid-save: the process "dies" between the temp write and the rename.
void testFaultInjection()
{
    const fs::path dir = freshDir ("atomic-fault");
    const fs::path f = dir / "precious.snd";
    CHECK (apc::atomicWrite (f, "ORIGINAL-CONTENT").ok);

    const apc::FaultPoint points[] = { apc::FaultPoint::AfterTempCreate, apc::FaultPoint::AfterTempWrite, apc::FaultPoint::BeforeRename };
    const char* names[] = { "AfterTempCreate", "AfterTempWrite", "BeforeRename" };
    for (int i = 0; i < 3; ++i)
    {
        apc::AtomicWriteOptions opt;
        opt.keepBackup = true;
        bool fired = false;
        opt.fault = [&] (apc::FaultPoint p) { if (p == points[i]) { fired = true; return true; } return false; };

        const auto r = apc::atomicWrite (f, "NEW-CONTENT-THAT-MUST-NOT-APPEAR", opt);
        std::cout << "    crash at " << names[i] << ": ok=" << r.ok << " target=" << slurp (f) << "\n";
        CHECK (fired);
        CHECK (! r.ok);                                        // the failure is reported, never silent
        CHECK (! r.error.empty());
        CHECK_EQ (slurp (f), std::string ("ORIGINAL-CONTENT"));   // target intact
        CHECK (pathExists (tmpFileFor (f)));                       // a killed process leaves its temp file behind
        CHECK (! pathExists (dir / "precious.snd.bak"));           // and never got as far as touching the backup

        // the next successful save recovers (reuses/overwrites the orphaned temp file)
        CHECK (apc::atomicWrite (f, "ORIGINAL-CONTENT").ok);
        CHECK (! pathExists (tmpFileFor (f)));
    }

    // a crash while writing a NEW file must not leave a half-written target
    const fs::path fresh = dir / "never-created.snd";
    apc::AtomicWriteOptions opt;
    opt.fault = [] (apc::FaultPoint p) { return p == apc::FaultPoint::BeforeRename; };
    CHECK (! apc::atomicWrite (fresh, "data", opt).ok);
    CHECK (! pathExists (fresh));

    // stale temp cleanup: a 0-second threshold removes the orphan, unrelated files stay
    CHECK (pathExists (tmpFileFor (fresh)));
    CHECK (apc::atomicWrite (dir / "other.txt.tmp-notdigits", "x").ok);
    const int removed = apc::cleanupStaleTemps (dir, 0);
    CHECK_EQ (removed, 1);
    CHECK (! pathExists (tmpFileFor (fresh)));
    CHECK (pathExists (dir / "other.txt.tmp-notdigits"));
    CHECK (pathExists (f));
}

void testErrorReporting()
{
    const fs::path dir = freshDir ("atomic-errors");
    // the "parent folder" is actually a regular file -> cannot create the folder
    CHECK (apc::atomicWrite (dir / "blocker", "x").ok);
    const auto r = apc::atomicWrite (dir / "blocker" / "child.snd", "y");
    CHECK (! r.ok);
    CHECK (r.error.find ("blocker") != std::string::npos);   // message names the failing path (U-13)
    std::string out;
    const auto rr = apc::readFileToString (dir / "missing.snd", out);
    CHECK (! rr.ok);
    CHECK (rr.error.find ("missing.snd") != std::string::npos);
}

void testImportNoClobber()
{
    const fs::path dir = freshDir ("import");
    auto a = apc::importNoClobber (dir, "Kick", ".snd", "one");
    auto b = apc::importNoClobber (dir, "Kick", ".snd", "two");
    auto c = apc::importNoClobber (dir, "Kick", ".snd", "three");
    CHECK (a.ok && b.ok && c.ok);
    CHECK_EQ (a.path.filename().string(), std::string ("Kick.snd"));
    CHECK_EQ (b.path.filename().string(), std::string ("Kick 2.snd"));
    CHECK_EQ (c.path.filename().string(), std::string ("Kick 3.snd"));
    CHECK_EQ (slurp (dir / "Kick.snd"), std::string ("one"));         // never overwritten
    CHECK_EQ (slurp (dir / "Kick 2.snd"), std::string ("two"));
    CHECK_EQ (slurp (dir / "Kick 3.snd"), std::string ("three"));

    // a gap is filled, an existing "Name 2" is never clobbered
    CHECK (apc::atomicWrite (dir / "Snare.snd", "s1").ok);
    CHECK (apc::atomicWrite (dir / "Snare 2.snd", "s2").ok);
    auto s3 = apc::importNoClobber (dir, "Snare", ".snd", "s3");
    CHECK (s3.ok);
    CHECK_EQ (s3.path.filename().string(), std::string ("Snare 3.snd"));
    CHECK_EQ (slurp (dir / "Snare 2.snd"), std::string ("s2"));

    // names are sanitised before touching the filesystem
    auto bad = apc::importNoClobber (dir, "Bad:Na/me?", ".snd", "x");
    CHECK (bad.ok);
    CHECK_EQ (bad.path.filename().string(), std::string ("Bad-Na-me-.snd"));

    // a crash during import leaves existing files alone and creates no target
    apc::AtomicWriteOptions opt;
    opt.fault = [] (apc::FaultPoint p) { return p == apc::FaultPoint::BeforeRename; };
    const auto crash = apc::importNoClobber (dir, "Kick", ".snd", "crash", opt);
    CHECK (! crash.ok);
    CHECK (! pathExists (dir / "Kick 4.snd"));
    CHECK_EQ (slurp (dir / "Kick.snd"), std::string ("one"));

    // no temp files are left after successful imports
    std::set<std::string> names;
    for (const auto& e : fs::directory_iterator (dir)) names.insert (e.path().filename().string());
    for (const auto& n : names) CHECK (n.find (".tmp-") == std::string::npos || n.find ("Kick.snd") != std::string::npos);
}

// ---------------------------------------------------------------------------------------------

apc::EnvLookup envOf (std::map<std::string, std::string> m)
{
    return [m] (const std::string& k) -> std::optional<std::string> {
        const auto it = m.find (k);
        if (it == m.end()) return std::nullopt;
        return it->second;
    };
}

void testPaths()
{
    using apc::DataScope;
    using apc::Os;

    const auto win = apc::makeLayout (Os::Windows, DataScope::PerUser, "Example Audio", "Demo",
                                      envOf ({ { "LOCALAPPDATA", "C:/Users/tester/AppData/Local" }, { "PROGRAMDATA", "C:/ProgramData" } }));
    CHECK (win.valid);
    CHECK_EQ (win.root.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo"));
    CHECK_EQ (win.presets.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/presets"));
    CHECK_EQ (win.wip.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/presets/_wip"));
    CHECK_EQ (win.user.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/presets/User"));
    CHECK_EQ (win.indexFile.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/cache/_index.json"));
    CHECK_EQ (win.settingsFile.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/settings.json"));
    CHECK_EQ (win.userDataFile.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/user-data.json"));
    CHECK_EQ (win.licenseFile.generic_string(), std::string ("C:/Users/tester/AppData/Local/Example Audio/Demo/license.lic"));
    CHECK_EQ (win.factorySeed.generic_string(), std::string ("C:/ProgramData/Example Audio/Demo/factory"));
    CHECK (win.root.generic_string().find ("Program Files") == std::string::npos);

    const auto winMachine = apc::makeLayout (Os::Windows, DataScope::MachineWide, "Example Audio", "Demo", envOf ({ { "PROGRAMDATA", "C:/ProgramData" } }));
    CHECK_EQ (winMachine.root.generic_string(), std::string ("C:/ProgramData/Example Audio/Demo"));

    const auto mac = apc::makeLayout (Os::Mac, DataScope::PerUser, "Example Audio", "Demo", envOf ({ { "HOME", "/Users/tester" } }));
    CHECK_EQ (mac.root.generic_string(), std::string ("/Users/tester/Library/Application Support/Example Audio/Demo"));
    const auto macMachine = apc::makeLayout (Os::Mac, DataScope::MachineWide, "Example Audio", "Demo", envOf ({}));
    CHECK_EQ (macMachine.root.generic_string(), std::string ("/Library/Application Support/Example Audio/Demo"));

    const auto lin = apc::makeLayout (Os::Linux, DataScope::PerUser, "Example Audio", "Demo", envOf ({ { "HOME", "/home/tester" } }));
    CHECK_EQ (lin.root.generic_string(), std::string ("/home/tester/.local/share/Example Audio/Demo"));

    // missing environment is reported, not guessed
    const auto noHome = apc::makeLayout (Os::Linux, DataScope::PerUser, "M", "P", envOf ({}));
    CHECK (! noHome.valid);
    CHECK (! noHome.error.empty());

    // APC_PRESET_ROOT replaces <Base> on every OS; <Manufacturer>/<Plugin> still appended
    const auto ov = apc::makeLayout (Os::Windows, DataScope::PerUser, "Example Audio", "Demo", envOf ({ { "APC_PRESET_ROOT", "D:/portable" } }));
    CHECK (ov.valid && ov.envOverride);
    CHECK_EQ (ov.root.generic_string(), std::string ("D:/portable/Example Audio/Demo"));

    // names that are not filesystem safe are sanitised
    const auto odd = apc::makeLayout (Os::Linux, DataScope::PerUser, "A/B: Audio", "Plug*in", envOf ({ { "HOME", "/h" } }));
    CHECK_EQ (odd.root.generic_string(), std::string ("/h/.local/share/A-B- Audio/Plug-in"));

    // pack folder shapes
    CHECK_EQ (lin.assetDir ("Factory", apc::AssetKind::Sound, false).generic_string(), std::string ("/home/tester/.local/share/Example Audio/Demo/presets/Factory/sounds"));
    CHECK_EQ (lin.assetDir ("Factory", apc::AssetKind::Kit, false).filename().string(), std::string ("kits"));
    CHECK_EQ (lin.assetDir ("Factory", apc::AssetKind::Sequence, false).filename().string(), std::string ("sequences"));
    CHECK_EQ (lin.assetDir ("Factory", apc::AssetKind::Patch, false).filename().string(), std::string ("patches"));
    CHECK_EQ (lin.assetDir ("Factory", apc::AssetKind::Preset, true).filename().string(), std::string ("Factory"));   // flat: in the pack itself
    CHECK_EQ (lin.samplesDir ("Factory").filename().string(), std::string ("samples"));
    CHECK_EQ (lin.manifestFile ("Factory").filename().string(), std::string ("pack.json"));
    CHECK_EQ (lin.assetFile ("Factory", apc::AssetKind::Sound, false, "Sub:Distort", ".snd").filename().string(), std::string ("Sub-Distort.snd"));
    CHECK_EQ (lin.assetFile ("Factory", apc::AssetKind::Preset, true, "Warm Plate", ".preset").parent_path().filename().string(), std::string ("Factory"));
    CHECK_EQ (lin.packDir ("../evil").filename().string(), std::string ("..-evil"));   // pack names cannot traverse

    // the real host environment produces a valid layout (HOME / LOCALAPPDATA exist on CI)
    const auto host = apc::makeHostLayout (DataScope::PerUser, "Example Audio", "Demo");
    CHECK (host.valid);
}

// ---------------------------------------------------------------------------------------------

using apc::ParamDecl;
using apc::ParamKind;
using apc::Value;

std::vector<ParamDecl> manifestV1()
{
    return {
        { "osc1_wave", ParamKind::Choice, std::string ("saw"), 0, 1, { "saw", "square" } },
        { "filter_cutoff_hz", ParamKind::Float, 1000.0, 20.0, 20000.0, {} },
        { "filter_res", ParamKind::Float, 0.2, 0.0, 1.0, {} },
        { "drive_amount", ParamKind::Float, 0.0, 0.0, 1.0, {} },
    };
}

std::vector<ParamDecl> manifestV2()   // v1 + appended choice + appended parameters
{
    auto m = manifestV1();
    m[0].choices.push_back ("pulse");
    m.push_back ({ "osc1_sub_level", ParamKind::Float, 0.25, 0.0, 1.0, {} });
    m.push_back ({ "unison_on", ParamKind::Bool, false, 0, 1, {} });
    return m;
}

// Mirrors test/fixtures/presets/golden/Written_Today.snd (apc-preset/1.0, written with manifest v1)
std::map<std::string, Value> goldenParams()
{
    return {
        { "osc1_wave", std::string ("saw") },
        { "filter_cutoff_hz", 95.5 },
        { "filter_res", 0.35 },
        { "drive_amount", 0.62 },
        { "legacy_removed_param", 1.5 },
    };
}

void testDefaultsFirstGolden()
{
    const auto r = apc::resolveDefaultsFirst (manifestV2(), goldenParams());
    CHECK_EQ (std::get<std::string> (r.values.at ("osc1_wave")), std::string ("saw"));
    CHECK_EQ (std::get<double> (r.values.at ("filter_cutoff_hz")), 95.5);
    CHECK_EQ (std::get<double> (r.values.at ("filter_res")), 0.35);
    CHECK_EQ (std::get<double> (r.values.at ("drive_amount")), 0.62);
    // parameters added after the file was written come up at their declared default
    CHECK_EQ (std::get<double> (r.values.at ("osc1_sub_level")), 0.25);
    CHECK_EQ (std::get<bool> (r.values.at ("unison_on")), false);
    CHECK_EQ (r.values.size(), static_cast<std::size_t> (6));
    CHECK_EQ (r.report.defaulted.size(), static_cast<std::size_t> (2));
    CHECK_EQ (r.report.applied.size(), static_cast<std::size_t> (4));
    CHECK (r.report.invalid.empty());
    // unknown key is preserved, not dropped
    CHECK_EQ (r.report.unknown.size(), static_cast<std::size_t> (1));
    CHECK_EQ (std::get<double> (r.report.unknown.at ("legacy_removed_param")), 1.5);

    // and survives a save round trip
    const auto saved = apc::mergeForSave (r.values, r.report.unknown);
    CHECK_EQ (saved.size(), static_cast<std::size_t> (7));
    CHECK (saved.count ("legacy_removed_param") == 1);

    // the same old file against the OLD manifest too (forward/backward both fine)
    const auto old = apc::resolveDefaultsFirst (manifestV1(), goldenParams());
    CHECK_EQ (old.values.size(), static_cast<std::size_t> (4));

    // empty file -> pure defaults (this is what INIT is)
    const auto init = apc::resolveDefaultsFirst (manifestV2(), {});
    CHECK_EQ (init.report.defaulted.size(), static_cast<std::size_t> (6));
    CHECK_EQ (std::get<double> (init.values.at ("filter_cutoff_hz")), 1000.0);
}

void testDefaultsFirstValidation()
{
    std::map<std::string, Value> stored = {
        { "osc1_wave", 1.0 },                  // an index for a choice: rejected (P-04)
        { "filter_cutoff_hz", 99999.0 },       // out of range: clamped
        { "filter_res", std::string ("loud") },// wrong type: default
        { "unison_on", true },
    };
    const auto r = apc::resolveDefaultsFirst (manifestV2(), stored);
    CHECK_EQ (std::get<std::string> (r.values.at ("osc1_wave")), std::string ("saw"));
    CHECK_EQ (std::get<double> (r.values.at ("filter_cutoff_hz")), 20000.0);
    CHECK_EQ (std::get<double> (r.values.at ("filter_res")), 0.2);
    CHECK_EQ (std::get<bool> (r.values.at ("unison_on")), true);
    CHECK_EQ (r.report.invalid.size(), static_cast<std::size_t> (2));
    CHECK_EQ (r.report.clamped.size(), static_cast<std::size_t> (1));

    // unknown choice label (e.g. file from a NEWER version) falls back to the default and is reported
    std::map<std::string, Value> newer = { { "osc1_wave", std::string ("wavetable") } };
    const auto r2 = apc::resolveDefaultsFirst (manifestV2(), newer);
    CHECK_EQ (std::get<std::string> (r2.values.at ("osc1_wave")), std::string ("saw"));
    CHECK_EQ (r2.report.invalid.size(), static_cast<std::size_t> (1));

    // Int parameters round
    std::vector<ParamDecl> ints = { { "voices", ParamKind::Int, 8.0, 1.0, 16.0, {} } };
    const auto r3 = apc::resolveDefaultsFirst (ints, { { "voices", 4.6 } });
    CHECK_EQ (std::get<double> (r3.values.at ("voices")), 5.0);

    // NaN is not a value
    const auto r4 = apc::resolveDefaultsFirst (ints, { { "voices", std::nan ("") } });
    CHECK_EQ (std::get<double> (r4.values.at ("voices")), 8.0);
    CHECK_EQ (r4.report.invalid.size(), static_cast<std::size_t> (1));
}

void testApplySetterCalledOncePerParam()
{
    int calls = 0;
    std::set<std::string> seen;
    const auto report = apc::applyDefaultsFirst (manifestV2(), goldenParams(), [&] (const ParamDecl& d, const Value&) {
        ++calls;
        seen.insert (d.id);
    });
    CHECK_EQ (calls, 6);
    CHECK_EQ (seen.size(), static_cast<std::size_t> (6));
    CHECK_EQ (report.unknown.size(), static_cast<std::size_t> (1));
}

void testAppendOnly()
{
    // appending a choice and new parameters is fine
    CHECK (apc::checkAppendOnly (manifestV1(), manifestV2()).empty());
    CHECK (apc::checkAppendOnly (manifestV2(), manifestV2()).empty());

    // removed / renamed id
    auto renamed = manifestV2();
    renamed[2].id = "filter_resonance";
    const auto v1 = apc::checkAppendOnly (manifestV1(), renamed);
    CHECK_EQ (v1.size(), static_cast<std::size_t> (1));
    CHECK_EQ (v1[0].id, std::string ("filter_res"));

    // reordered choices
    auto reordered = manifestV2();
    reordered[0].choices = { "square", "saw", "pulse" };
    const auto v2 = apc::checkAppendOnly (manifestV1(), reordered);
    CHECK_EQ (v2.size(), static_cast<std::size_t> (1));
    CHECK (v2[0].reason.find ("reordered") != std::string::npos);

    // removed choice
    auto removed = manifestV2();
    removed[0].choices = { "saw", "pulse" };
    const auto v3 = apc::checkAppendOnly (manifestV1(), removed);
    CHECK_EQ (v3.size(), static_cast<std::size_t> (1));
    CHECK (v3[0].reason.find ("removed") != std::string::npos);

    // changed kind
    auto kind = manifestV2();
    kind[3].kind = ParamKind::Int;
    CHECK_EQ (apc::checkAppendOnly (manifestV1(), kind).size(), static_cast<std::size_t> (1));
}
} // namespace

int main()
{
    std::error_code ec;
    g_tmpRoot = fs::temp_directory_path (ec) / ("apc-cpp-tests-" + std::to_string (apc::detail::currentPid()));
    fs::remove_all (g_tmpRoot, ec);
    fs::create_directories (g_tmpRoot, ec);
    std::cout << "scratch: " << g_tmpRoot.string() << "\n";

    run ("sanitizeFilename", testSanitize);
    run ("atomicWrite basics", testAtomicWriteBasics);
    run ("atomicWrite keepBackup", testBackup);
    run ("kill-mid-save fault injection", testFaultInjection);
    run ("error reporting names the path", testErrorReporting);
    run ("collision-safe import", testImportNoClobber);
    run ("paths (all OS, env override)", testPaths);
    run ("defaults-first golden file", testDefaultsFirstGolden);
    run ("defaults-first validation", testDefaultsFirstValidation);
    run ("applyDefaultsFirst setter contract", testApplySetterCalledOncePerParam);
    run ("append-only manifest check", testAppendOnly);

    fs::remove_all (g_tmpRoot, ec);
    std::cout << g_checks << " checks, " << g_failures << " failure(s)\n";
    return g_failures == 0 ? 0 : 1;
}
