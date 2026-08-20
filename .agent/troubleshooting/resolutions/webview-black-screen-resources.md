# WebView Black Screen - Embedded Resources Not Loaded

**Issue ID:** webview-007
**Category:** webview
**Severity:** High
**Status:** SOLVED
**Date Resolved:** 2026-01-25

---

## Summary

Plugin loads in DAW but displays only a black screen with no UI elements. The WebView component is created successfully but the HTML/JS resources fail to load because the resource provider is trying to load from the file system using an incorrect working directory.

---

## Symptoms

1. Plugin compiles and builds successfully
2. Plugin loads in DAW without errors
3. Plugin window opens but shows only black screen
4. No UI elements (knobs, buttons, etc.) are visible
5. No error messages in console or DAW

**Common scenario:** Plugin works during development (when working directory is project root) but fails when loaded in DAW (different working directory).

---

## Root Cause

The resource provider implementation tries to load web files from the file system using:
```cpp
juce::File::getCurrentWorkingDirectory()
    .getChildFile("plugins")
    .getChildFile("CloudWash")
    .getChildFile("Source")
    .getChildFile("ui")
    .getChildFile("public");
```

**Problem:** When running in a DAW, `getCurrentWorkingDirectory()` is the DAW's directory (e.g., `C:\Program Files\Reaper`), not the plugin development directory. The files don't exist there, so resources fail to load.

**Why BinaryData wasn't being used:** The `getResource()` function was written to load from file system for development convenience, but never switched to using the embedded `BinaryData` that CMake generated.

---

## Solution

Use the embedded `BinaryData` resources that CMake automatically creates from the web files.

### Step 1: Include BinaryData.h

```cpp
#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"  // ← Add this
```

### Step 2: Rewrite getResource() to Use Embedded Data

**❌ WRONG (File system loading):**
```cpp
std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url)
{
    // This fails in DAW because working directory is wrong
    juce::File sourceDir = juce::File::getCurrentWorkingDirectory()
        .getChildFile("plugins")
        .getChildFile("CloudWash")
        .getChildFile("Source")
        .getChildFile("ui")
        .getChildFile("public");

    juce::File requestedFile = sourceDir.getChildFile(resourcePath.substring(1));

    // ... file loading code that won't work in DAW
}
```

**✅ CORRECT (Embedded BinaryData):**
```cpp
std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url)
{
    auto resourcePath = url.fromFirstOccurrenceOf(
        juce::WebBrowserComponent::getResourceProviderRoot(), false, false);

    // Handle root request
    if (resourcePath.isEmpty() || resourcePath == "/")
        resourcePath = "/index.html";

    // Map URL paths to BinaryData resources
    const char* resourceData = nullptr;
    int resourceSize = 0;
    juce::String mimeType;

    auto path = resourcePath.substring(1);  // Remove leading slash

    if (path == "index.html")
    {
        resourceData = BinaryData::index_html;
        resourceSize = BinaryData::index_htmlSize;
        mimeType = "text/html";
    }
    else if (path == "js/index.js")
    {
        resourceData = BinaryData::index_js;
        resourceSize = BinaryData::index_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/juce/index.js")
    {
        resourceData = BinaryData::index_js2;  // Note: CMake mangles name
        resourceSize = BinaryData::index_js2Size;
        mimeType = "text/javascript";
    }
    else if (path == "js/juce/check_native_interop.js")
    {
        resourceData = BinaryData::check_native_interop_js;
        resourceSize = BinaryData::check_native_interop_jsSize;
        mimeType = "text/javascript";
    }

    // Convert to std::vector<std::byte> (JUCE 8 requirement)
    if (resourceData != nullptr && resourceSize > 0)
    {
        std::vector<std::byte> data(resourceSize);
        std::memcpy(data.data(), resourceData, resourceSize);

        return juce::WebBrowserComponent::Resource {
            std::move(data),
            mimeType
        };
    }

    // Resource not found - return error page
    return std::nullopt;
}
```

### Step 3: Verify CMakeLists.txt Embeds Files

Ensure your CMakeLists.txt has:
```cmake
# Embed web UI files as binary data
juce_add_binary_data(CloudWash_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)

# Link binary data to plugin
target_link_libraries(CloudWash
    PRIVATE
        CloudWash_WebUI  # ← Must link this
        ...
)
```

### Step 4: Check BinaryData Variable Names

CMake may mangle filenames. Check `build/plugins/CloudWash/juce_binarydata_CloudWash_WebUI/JuceLibraryCode/BinaryData.h` to see actual variable names:

```cpp
namespace BinaryData
{
    extern const char* index_html;        // from index.html
    extern const char* index_js;          // from js/index.js
    extern const char* index_js2;         // from js/juce/index.js (mangled!)
    extern const char* check_native_interop_js;  // from js/juce/check_native_interop.js
}
```

**Important:** File paths with same basename get numbered (e.g., `index_js2`).

---

## Verification Steps

### 1. Rebuild Plugin
```bash
cmake --build build --config Release --target CloudWash_VST3
```

### 2. Check BinaryData Generated
```bash
ls build/plugins/CloudWash/juce_binarydata_CloudWash_WebUI/JuceLibraryCode/
```

Should see:
- BinaryData.h
- BinaryData1.cpp
- BinaryData2.cpp
- etc.

### 3. Test in DAW
1. Reload plugin in DAW
2. Open plugin window
3. **Should see UI** with knobs, meters, and controls
4. **No more black screen**

### 4. Test Resource Loading
Add debug fallback HTML to verify resource provider is working:
```cpp
if (resourceData == nullptr)
{
    // Return error page showing what was requested
    juce::String fallbackHtml = "<html><body>Resource not found: " + path + "</body></html>";
    // ... convert to Resource and return
}
```

---

## Common Mistakes

### ❌ Forgetting to Link BinaryData
```cmake
target_link_libraries(CloudWash
    PRIVATE
        # CloudWash_WebUI  ← Missing! Won't compile
        juce::juce_audio_processors
)
```

**Error:** Undefined reference to `BinaryData::index_html`

### ❌ Wrong Variable Names
```cpp
// Using index_js for both files
resourceData = BinaryData::index_js;  // js/index.js ✓
resourceData = BinaryData::index_js;  // js/juce/index.js ✗ (should be index_js2)
```

**Result:** Wrong file loaded, UI breaks

### ❌ Still Using File System Loading
```cpp
// Mixing file system and BinaryData
if (File::getCurrentWorkingDirectory().exists())
    // Load from file...  ✗
else
    // Load from BinaryData...  ✗
```

**Problem:** Works during development, fails in DAW

---

## Prevention

### For All WebView Plugins:

1. **Always use embedded BinaryData for production**
   - File system loading is only for rapid development iteration
   - Switch to BinaryData before testing in DAW

2. **Test in DAW early**
   - Don't wait until "finished" to test in DAW
   - Embedded resource issues show up immediately

3. **Check BinaryData.h after build**
   - Verify all resources are embedded
   - Check variable name mangling

4. **Add fallback error page**
   - Shows which resource failed to load
   - Helps debug resource path issues

### Development Workflow:

**During Development:**
```cpp
#if JUCE_DEBUG
    // Load from file system for fast iteration
    return loadFromFileSystem(path);
#else
    // Load from embedded BinaryData for release
    return loadFromBinaryData(path);
#endif
```

**For Production:**
- Always use embedded BinaryData
- Remove file system loading code entirely

---

## Related Issues

- **webview-001:** WebView path errors (different issue - serving wrong path)
- **webview-005:** JUCE 8 API changes (affects Resource type)
- **webview-006:** Resource type must be std::vector<std::byte>

---

## Notes

This is one of the most common WebView issues. The black screen provides no error messages, making it hard to diagnose. Always remember:

**The plugin runs in the DAW's working directory, not yours.**

Embedded BinaryData solves this by packaging all resources inside the .vst3 file itself.
