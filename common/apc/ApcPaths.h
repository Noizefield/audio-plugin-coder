// ApcPaths.h - on-disk layout of an APC plugin's user data (decision P-03).
//
// Header-only, C++17, NO JUCE dependency. Pure path computation: nothing here touches the
// disk, so it is unit-testable for every OS from any host (inject the environment).
//
//   <Base>/<Manufacturer>/<PluginName>/            <- root
//   |-- presets/
//   |   |-- <Pack>/                                 pack.json + (typed) sounds/ kits/ sequences/ patches/
//   |   |                                           or (flat) <name><preset_ext> directly in the pack
//   |   |-- _wip/                                   staging pack, never shipped
//   |   `-- User/                                   default target of user saves
//   |-- cache/_index.json                           disposable browse index
//   |-- settings.json                               machine-wide UI settings (never in the DAW chunk)
//   |-- user-data.json                              ratings / favorites keyed by asset id
//   `-- license.lic                                 activation file (licensing module)
//
// <Base>: Windows %LOCALAPPDATA% (per-user) or %PROGRAMDATA% (machine-wide);
//         macOS ~/Library/Application Support or /Library/Application Support;
//         Linux ~/.local/share or /usr/local/share.
// Environment override: APC_PRESET_ROOT replaces <Base> (the <Manufacturer>/<PluginName>
// suffix is still appended, so several plugins never collide). Used by tests and portable setups.
//
// Never Program Files / /Applications: those are not user-writable (P-03).
#pragma once

#include "ApcAtomicFile.h"

#include <cstdlib>

#include <functional>
#include <optional>
#include <string>

namespace apc
{
enum class Os { Windows, Mac, Linux };
enum class DataScope { PerUser, MachineWide };
enum class AssetKind { Sound, Kit, Sequence, Patch, Preset };

using EnvLookup = std::function<std::optional<std::string> (const std::string&)>;

#if (defined(_MSVC_LANG) && _MSVC_LANG >= 202002L) || (defined(__cplusplus) && __cplusplus >= 202002L)
 #define APC_PATHS_CPP20 1
#else
 #define APC_PATHS_CPP20 0
#endif

// UTF-8 string -> filesystem path without depending on the active code page.
inline fs::path pathFromUtf8 (const std::string& s)
{
#if APC_PATHS_CPP20
    return fs::path (std::u8string (reinterpret_cast<const char8_t*> (s.data()), s.size()));
#else
    return fs::u8path (s);
#endif
}

inline Os hostOs()
{
#if defined(_WIN32)
    return Os::Windows;
#elif defined(__APPLE__)
    return Os::Mac;
#else
    return Os::Linux;
#endif
}

// Reads the real process environment (getenv / _dupenv_s).
inline EnvLookup systemEnv()
{
    return [] (const std::string& name) -> std::optional<std::string>
    {
#if defined(_MSC_VER)
        char* buf = nullptr;
        std::size_t len = 0;
        if (_dupenv_s (&buf, &len, name.c_str()) != 0 || buf == nullptr) return std::nullopt;
        std::string v (buf);
        std::free (buf);
#else
        const char* raw = std::getenv (name.c_str());
        if (raw == nullptr) return std::nullopt;
        std::string v (raw);
#endif
        if (v.empty()) return std::nullopt;
        return v;
    };
}

inline const char* kindFolder (AssetKind k)
{
    switch (k)
    {
        case AssetKind::Sound:    return "sounds";
        case AssetKind::Kit:      return "kits";
        case AssetKind::Sequence: return "sequences";
        case AssetKind::Patch:    return "patches";
        case AssetKind::Preset:   return "";   // flat mode: directly in the pack folder
    }
    return "";
}

struct PresetLayout
{
    bool valid = false;
    std::string error;          // set when !valid (e.g. HOME / LOCALAPPDATA missing)
    bool envOverride = false;   // APC_PRESET_ROOT was applied

    fs::path base;              // <Base>
    fs::path root;              // <Base>/<Manufacturer>/<PluginName>
    fs::path presets;           // root/presets
    fs::path wip;               // presets/_wip
    fs::path user;              // presets/User
    fs::path cacheDir;          // root/cache
    fs::path indexFile;         // root/cache/_index.json
    fs::path settingsFile;      // root/settings.json
    fs::path userDataFile;      // root/user-data.json
    fs::path licenseFile;       // root/license.lic
    fs::path factorySeed;       // shared read-only seed location (option preset.factory_install=shared-seed)

    fs::path packDir (const std::string& pack) const { return presets / pathFromUtf8 (sanitizeFilename (pack)); }
    fs::path manifestFile (const std::string& pack) const { return packDir (pack) / "pack.json"; }
    fs::path samplesDir (const std::string& pack) const { return packDir (pack) / "samples"; }

    // Folder an asset of `kind` lives in: pack/<kind folder> (typed) or the pack itself (flat).
    fs::path assetDir (const std::string& pack, AssetKind kind, bool flat) const
    {
        if (flat || kind == AssetKind::Preset) return packDir (pack);
        return packDir (pack) / kindFolder (kind);
    }

    // Full file path for an asset: sanitised display name + the plugin's configured extension.
    fs::path assetFile (const std::string& pack, AssetKind kind, bool flat,
                        const std::string& displayName, const std::string& extWithDot) const
    {
        return assetDir (pack, kind, flat) / pathFromUtf8 (sanitizeFilename (displayName) + extWithDot);
    }
};

inline PresetLayout makeLayout (Os os, DataScope scope, const std::string& manufacturer, const std::string& pluginName,
                                const EnvLookup& env = systemEnv())
{
    PresetLayout L;
    std::string base;

    if (auto o = env ("APC_PRESET_ROOT"))
    {
        base = *o;
        L.envOverride = true;
    }
    else if (os == Os::Windows)
    {
        auto v = env (scope == DataScope::MachineWide ? "PROGRAMDATA" : "LOCALAPPDATA");
        if (! v) { L.error = scope == DataScope::MachineWide ? "PROGRAMDATA is not set" : "LOCALAPPDATA is not set"; return L; }
        base = *v;
    }
    else if (os == Os::Mac)
    {
        if (scope == DataScope::MachineWide) base = "/Library/Application Support";
        else
        {
            auto home = env ("HOME");
            if (! home) { L.error = "HOME is not set"; return L; }
            base = *home + "/Library/Application Support";
        }
    }
    else
    {
        if (scope == DataScope::MachineWide) base = "/usr/local/share";
        else
        {
            auto home = env ("HOME");
            if (! home) { L.error = "HOME is not set"; return L; }
            base = *home + "/.local/share";
        }
    }

    L.base = pathFromUtf8 (base);
    L.root = L.base / pathFromUtf8 (sanitizeFilename (manufacturer)) / pathFromUtf8 (sanitizeFilename (pluginName));
    L.presets = L.root / "presets";
    L.wip = L.presets / "_wip";
    L.user = L.presets / "User";
    L.cacheDir = L.root / "cache";
    L.indexFile = L.cacheDir / "_index.json";
    L.settingsFile = L.root / "settings.json";
    L.userDataFile = L.root / "user-data.json";
    L.licenseFile = L.root / "license.lic";

    std::string seedBase = os == Os::Windows ? env ("PROGRAMDATA").value_or ("") : os == Os::Mac ? "/Library/Application Support" : "/usr/local/share";
    if (! seedBase.empty())
        L.factorySeed = pathFromUtf8 (seedBase) / pathFromUtf8 (sanitizeFilename (manufacturer)) / pathFromUtf8 (sanitizeFilename (pluginName)) / "factory";
    L.valid = true;
    return L;
}

// Convenience: layout for the OS the code is running on, reading the real environment.
inline PresetLayout makeHostLayout (DataScope scope, const std::string& manufacturer, const std::string& pluginName)
{
    return makeLayout (hostOs(), scope, manufacturer, pluginName, systemEnv());
}

} // namespace apc
