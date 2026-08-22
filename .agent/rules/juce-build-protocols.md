# JUCE CRITICAL SYSTEM PROTOCOLS (JUCE 9)
**REQUIRED READING:** strict constraints for Windows 11 / macOS & APC Monorepo.
## 1. ⚠️ GOLDEN BUILD RULES (HIGHEST PRIORITY)
### A. The "One-Script" Rule
- **NEVER** run cmake, msbuild, cl.exe, or xcodebuild manually.
- **NEVER** try to copy VST3/AU files manually.
- **ALWAYS** use the master script for Building, Installing, and Repairing.
- **Windows:** `.\scripts\build-and-install.ps1 -PluginName "TailSync"`
- **macOS:** `bash scripts/build-and-install.sh TailSync`
### B. Monorepo & Path Logic
- **Root Context:** All build operations must happen from the Repository Root.
- **Subdirectories:** NEVER run commands inside plugins/[Name]/.
- **Environment (Windows):**
  - OS: **Windows 11**
  - Shell: **PowerShell**
  - Create Folders: `New-Item -ItemType Directory -Force -Path "..."`
- **Environment (macOS):**
  - OS: **macOS 10.13+**
  - Shell: **Bash/Zsh**
  - Create Folders: `mkdir -p "..."`
  - CMake Generator: **Xcode** (universal binary: x86_64 + arm64)
---
## 2. 📂 FILE STRUCTURE & WEBVIEW
### A. WebView/GUI Architecture (JUCE 9)
- **Location:** HTML/JS/CSS files MUST reside in plugins/[Name]/Source/ui/public/.
- **Forbidden:** Do NOT use plugin-root WebUI/ or Resources/web unless the plugin CMakeLists.txt explicitly embeds that path via juce_add_binary_data.
- **Embedding:** Register web files with juce_add_binary_data([Name]_WebUI ...) and link the target to the plugin.
- **JS Interop:** Copy the JUCE 9 interop drop-in to Source/ui/public/js/juce/index.js from _tools/JUCE/modules/juce_gui_extra/native/typescript/webview-interop/dist/index.js and load it in index.html BEFORE your own js/index.js.
- **window.__JUCE__:** The raw snapshot exists at runtime, but native function calls require the js/juce/index.js interop layer — never rely on window.__JUCE__ directly without it.
- **C++ Pathing:** In PluginEditor.cpp, serve files via WebBrowserComponent .withResourceProvider() over the embedded binary data.
### B. CMake Configuration
- **Root:** The Root CMakeLists.txt loads JUCE.
- **Plugins:** Plugin CMakeLists must **NOT** call juce_add_modules (causes duplicate target errors).
- **Correct Linking:**
  ```cmake
  juce_add_plugin(TailSync FORMATS VST3 PRODUCT_NAME "TailSync" NEEDS_WEB_BROWSER TRUE)
  target_link_libraries(TailSync PRIVATE juce::juce_dsp juce::juce_gui_extra)
  target_compile_definitions(TailSync PUBLIC JUCE_WEB_BROWSER=1)
  ```

---

## 3. 🐧 LINUX/MACOS CRITICAL REQUIREMENTS

### A. WebView Dual-Flag System (JUCE 8)
**CRITICAL:** JUCE 8 has **TWO SEPARATE FLAGS** for WebView plugins:

| Platform | Flag | Purpose |
|----------|------|---------|
| Windows | `NEEDS_WEBVIEW2 TRUE` | Static-links WebView2 SDK |
| **Linux** | **`NEEDS_WEB_BROWSER TRUE`** | Links webkit2gtk + GTK, adds include paths |
| macOS | (neither) | Uses WKWebView (system framework) |

**REQUIRED for Linux:**
```cmake
elseif(UNIX)
    set(NEEDS_WEBVIEW2 FALSE)
    set(NEEDS_WEB_BROWSER TRUE)  # MUST SET THIS
    ...
endif()

juce_add_plugin(PluginName
    NEEDS_WEBVIEW2 ${NEEDS_WEBVIEW2}
    NEEDS_WEB_BROWSER ${NEEDS_WEB_BROWSER}  # MUST PASS THIS
)
```

**Without `NEEDS_WEB_BROWSER TRUE`:** Compiler gets `JUCE_WEB_BROWSER=1` but never receives GTK include paths → `gtk/gtk.h: No such file or directory` → build fails.

### B. Root CMakeLists.txt MUST Enable C Language
```cmake
project(APC_System VERSION 1.0.0 LANGUAGES C CXX)  # C is REQUIRED
```
**Why:** JUCE needs C for Sheenbidi (text rendering) and juceaide (build tool). Without C, `CMAKE_C_COMPILE_OBJECT` will be undefined at generate time → build fails.

### C. Linux CI: xvfb for LV2/Standalone Builds
**Issue:** JUCE's LV2 manifest generator runs POST-LINK to load the plugin and extract metadata. WebView plugins init GTK, which requires X11 display. GitHub Actions runners are headless.

**Solution:** Install `xvfb` and wrap LV2/Standalone builds:
```yaml
- run: sudo apt-get install -y ... xvfb
- run: cmake --build build --target Plugin_VST3  # No xvfb needed
- run: xvfb-run cmake --build build --target Plugin_LV2
- run: xvfb-run cmake --build build --target Plugin_Standalone
```

### D. macOS: NO Per-Target XCODE_ATTRIBUTE_ARCHS
**FORBIDDEN:**
```cmake
# DELETE THIS if present:
if(APPLE)
    set_target_properties(Plugin PROPERTIES
        XCODE_ATTRIBUTE_ARCHS "x86_64;arm64"  # BREAKS BUILD
        XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH NO
    )
endif()
```

**Correct:** Use global flag at configure time:
```bash
cmake -G Xcode -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" ...
```

Per-target `XCODE_ATTRIBUTE_ARCHS` conflicts with global setting, causes Xcode to misinterpret arch list → intermediate libs don't build → linker fails with "libPlugin_SharedCode.a not found".