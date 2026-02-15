# WebView Plugin Templates

These templates provide a **working foundation** for JUCE plugins with WebView2 UIs on Windows.

## Usage

When implementing a WebView plugin, copy these templates and replace the placeholders:

- `{{PLUGIN_NAME}}` - Your plugin class name (e.g., `MyReverb`)
- `{{PLUGIN_NAME_LOWER}}` - Lowercase plugin name (e.g., `myreverb`)
- `{{COMPANY_NAME}}` - Your company name
- `{{MANUFACTURER_CODE}}` - JUCE manufacturer code (4 chars)
- `{{PLUGIN_CODE}}` - JUCE plugin code (4 chars)
- `{{PLUGIN_DISPLAY_NAME}}` - Display name for the plugin
- `{{PARAMETER_RELAYS}}` - Parameter relay declarations
- `{{CREATE_PARAMETER_RELAYS}}` - Code to create parameter relays
- `{{WITH_OPTIONS_FROM_RELAYS}}` - `.withOptionsFrom()` calls for each relay
- `{{CREATE_PARAMETER_ATTACHMENTS}}` - Code to create parameter attachments

## Critical Requirements

### 1. WebBrowserComponent Configuration
**MUST include:**
- `.withBackend(webview2)` - Explicitly use WebView2 backend
- `.withUserDataFolder()` - Required for Windows plugins
- `.withNativeIntegrationEnabled()` - Enables JS ↔ C++ communication
- `.withResourceProvider()` - Serves embedded web files

### 2. Parameter Relays Order
**CRITICAL:** Create relays BEFORE WebBrowserComponent, attachments AFTER.

```cpp
// Step 1: Create relays
driveRelay = std::make_unique<WebSliderRelay>(*webView, ParameterIDs::DRIVE);

// Step 2: Create WebBrowserComponent with relays
webView = std::make_unique<WebBrowserComponent>(...);

// Step 3: Create attachments
driveAttachment = std::make_unique<WebSliderParameterAttachment>(...);
```

### 3. CMakeLists.txt Requirements
**MUST include:**
- `juce_add_binary_data()` to embed web files
- Link the binary data target to your plugin
- `JUCE_WEB_BROWSER=1` compile definition
- `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1` compile definition

### 4. Web File Structure
**Required structure:**
```
Source/ui/public/
├── index.html
├── js/
│   ├── index.js
│   └── juce/
│       └── index.js  (Copy from JUCE modules)
```

### 5. Loading Web Content
**DO:**
```cpp
webView->goToURL(WebBrowserComponent::getResourceProviderRoot());
```

**DON'T:**
```cpp
webView->goToURL("data:text/html;base64,...");  // WRONG!
webView->loadHTML(htmlString);  // WRONG!
```

## Resource Provider Approaches

### Approach 1: BinaryData (Recommended for Simple Cases)

Use JUCE's BinaryData namespace directly:

```cpp
#include "BinaryData.h"

std::optional<WebBrowserComponent::Resource> getResource(const String& url) {
    // Map URL to BinaryData resource name
    // Iterate through BinaryData::namedResourceList to find by original filename
    // See TestWebView plugin for full implementation
}
```

**Pros:**
- Simpler - no zip file needed
- Works directly with `juce_add_binary_data()`
- No additional build steps

**Cons:**
- Resource names are mangled (need to iterate to find by filename)
- Slightly more complex lookup logic

### Approach 2: Zip File (JUCE Example Pattern)

Create a zip file manually and embed it:

```cpp
static ZipFile* getZipFile() {
    static auto stream = createAssetInputStream("plugin_webui.zip", AssertAssetExists::no);
    if (stream == nullptr) return nullptr;
    static ZipFile f { stream.get(), false };
    return &f;
}
```

**Pros:**
- Matches JUCE example pattern exactly
- Cleaner resource lookup (by filename)
- Better for complex web apps with many files

**Cons:**
- Requires manual zip creation step
- Additional build complexity

**Recommendation:** Use BinaryData approach for templates (simpler), but document zip approach for advanced use cases.

1. **Using data URIs** - Web files must be embedded via `juce_add_binary_data`
2. **Missing resource provider** - Without it, web files won't load
3. **Wrong relay order** - Relays must exist before WebBrowserComponent
4. **Missing WebView2 backend** - Default backend may not work on Windows
5. **No user data folder** - Required for WebView2 to initialize
6. **Missing JUCE frontend library** - Copy `juce_gui_extra/native/javascript/index.js` to `js/juce/index.js`

## Validation

Run the validation script to check your implementation:
```powershell
.\scripts\validate-webview-setup.ps1 -PluginName YourPlugin
```

## Example: Converting Template

**Before (template):**
```cpp
{{CREATE_PARAMETER_RELAYS}}
```

**After (actual code):**
```cpp
driveRelay = std::make_unique<WebSliderRelay>(*webView, ParameterIDs::DRIVE);
cutoffRelay = std::make_unique<WebSliderRelay>(*webView, ParameterIDs::CUTOFF);
resonanceRelay = std::make_unique<WebSliderRelay>(*webView, ParameterIDs::RESONANCE);
```

## Troubleshooting

If your GUI doesn't display:
1. Check WebView2 runtime is installed (`edge://version` in Edge browser)
2. Verify resource provider returns valid resources
3. Check browser DevTools (right-click in WebView → Inspect)
4. Ensure web files are in correct location
5. Verify CMakeLists.txt embeds files correctly
