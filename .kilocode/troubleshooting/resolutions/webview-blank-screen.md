# WebView Blank Screen Troubleshooting Guide

## Problem: Plugin GUI Shows Blank White Screen

When a WebView plugin loads but displays only a blank white screen, follow this systematic troubleshooting guide.

---

## Step 1: Enable DevTools and Check Console

**Enable DevTools in PluginEditor.cpp:**
```cpp
#if JUCE_DEBUG
    webView->setDevToolsEnabled(true);
#endif
```

**Check Console:**
1. Right-click in the blank WebView area
2. Select "Inspect" (opens Edge DevTools)
3. Check Console tab for JavaScript errors

**Common errors:**
- `Failed to load module script` → Missing JUCE frontend library
- `Cannot read property 'backend' of undefined` → Native integration not enabled
- `404 Not Found` → Resource provider not working
- `CORS error` → Resource provider misconfigured

**If errors found:** Fix the specific error (see solutions below)
**If no errors:** Continue to Step 3

---

## Step 2: Verify Resource Provider

**Check PluginEditor.cpp has:**
```cpp
.withResourceProvider([this](const auto& url) {
    return getResource(url);
})
```

**Verify getResource() function:**
```cpp
std::optional<WebBrowserComponent::Resource> PluginEditor::getResource(const String& url)
{
    // Should load from embedded zip file
    if (auto* archive = getZipFile()) {
        // ... implementation
    }
    return std::nullopt;
}
```

**Test in DevTools Network tab:**
1. Open DevTools (right-click → Inspect)
2. Go to Network tab
3. Reload plugin
4. Check if `index.html` loads (should show 200 status)

**If 404:** Resource provider not working - check `getZipFile()` implementation
**If 200:** Continue to Step 4

---

## Step 3: Verify Web Files Are Embedded

**Check CMakeLists.txt:**
```cmake
juce_add_binary_data(YourPlugin_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
)

target_link_libraries(YourPlugin
    PRIVATE
        YourPlugin_WebUI  # Must link this!
        # ... other libraries
)
```

**Verify files exist:**
- `Source/ui/public/index.html` ✓
- `Source/ui/public/js/index.js` ✓
- `Source/ui/public/js/juce/index.js` ✓

**If files missing:** Copy JUCE frontend library:
```powershell
Copy-Item "_tools\JUCE\modules\juce_gui_extra\native\javascript\index.js" "plugins\YourPlugin\Source\ui\public\js\juce\index.js"
```

**Rebuild plugin** after adding files

---

## Step 4: Check WebBrowserComponent Configuration

**Verify all required options are present:**

```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(WebBrowserComponent::Options::Backend::webview2)  // ✓ Required
        .withWinWebView2Options(
            WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(File::getSpecialLocation(
                    File::SpecialLocationType::tempDirectory)))  // ✓ Required
        .withNativeIntegrationEnabled()  // ✓ Required
        .withResourceProvider([this](const auto& url) {
            return getResource(url);  // ✓ Required
        })
);
```

**Missing any of these:** Add the missing option

---

## Step 5: Verify Loading Method

**CORRECT:**
```cpp
webView->goToURL(WebBrowserComponent::getResourceProviderRoot());
```

**WRONG (will cause blank screen):**
```cpp
webView->goToURL("data:text/html;base64,...");  // ❌ Doesn't support modules
webView->loadHTML(htmlString);  // ❌ Can't load external JS
```

**If using wrong method:** Change to `getResourceProviderRoot()`

---

## Step 6: Check HTML File Structure

**Verify index.html has:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script type="module" src="js/index.js"></script>
</head>
<body>
  <!-- Your UI here -->
</body>
</html>
```

**Common issues:**
- Missing `type="module"` → JavaScript won't load
- Wrong path to `js/index.js` → File not found
- Missing closing tags → HTML parsing fails

---

## Step 7: Check JavaScript Initialization

**Verify js/index.js:**
```javascript
import * as Juce from "./juce/index.js";

document.addEventListener("DOMContentLoaded", () => {
    console.log("UI initialized");  // Check if this appears in console
    initializeUI();
});
```

**If console shows errors:**
- Check import path is correct
- Verify `juce/index.js` exists
- Check for syntax errors in JavaScript

---

## Step 8: Verify Parameter Relays Order

**CRITICAL ORDER:**
1. Create parameter relays FIRST
2. Create WebBrowserComponent with relays
3. Create parameter attachments LAST

**Wrong order causes blank screen!**

```cpp
// Step 1: Create relays BEFORE WebBrowserComponent
driveRelay = std::make_unique<WebSliderRelay>(*webView, ParameterIDs::DRIVE);

// Step 2: Create WebBrowserComponent
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withOptionsFrom(*driveRelay)  // Pass relay here
        // ... other options
);

// Step 3: Create attachments AFTER WebBrowserComponent
driveAttachment = std::make_unique<WebSliderParameterAttachment>(...);
```

---

## Step 9: Run Validation Script

**Run automated validation:**
```powershell
.\scripts\validate-webview-setup.ps1 -PluginName YourPlugin
```

**Fix any issues reported by the script**

---

## Quick Diagnostic Checklist

Run through this checklist:

- [ ] WebView2 Runtime installed (`edge://version`)
- [ ] DevTools enabled and Console checked for errors
- [ ] Resource provider function exists and returns valid resources
- [ ] CMakeLists.txt has `juce_add_binary_data()` for web files
- [ ] CMakeLists.txt links the binary data target
- [ ] WebBrowserComponent uses `.withBackend(webview2)`
- [ ] WebBrowserComponent uses `.withUserDataFolder()`
- [ ] WebBrowserComponent uses `.withNativeIntegrationEnabled()`
- [ ] WebBrowserComponent uses `.withResourceProvider()`
- [ ] Uses `getResourceProviderRoot()` not data URI
- [ ] Parameter relays created BEFORE WebBrowserComponent
- [ ] Web files exist: `index.html`, `js/index.js`, `js/juce/index.js`
- [ ] HTML has `<script type="module" src="js/index.js"></script>`
- [ ] JavaScript imports JUCE library correctly
- [ ] Plugin rebuilt after making changes

---

## Common Solutions Summary

| Symptom | Solution |
|---------|----------|
| Blank screen, no console errors | Check WebView2 runtime installation |
| Console: "Failed to load module" | Copy JUCE frontend library to `js/juce/index.js` |
| Console: "404 Not Found" | Fix resource provider or verify files embedded |
| Console: "backend is undefined" | Add `.withNativeIntegrationEnabled()` |
| Console: "CORS error" | Check resource provider implementation |
| Screen loads but no controls | Check parameter relays and attachments |
| Old UI shown | Rebuild plugin (web files compiled into binary) |

---

## Still Not Working?

1. **Compare with working example:**
   - Check `_tools/JUCE/examples/Plugins/WebViewPluginDemo.h`
   - Compare your implementation line-by-line

2. **Use templates:**
   - Copy from `templates/webview/`
   - Replace placeholders with your values

3. **Check build output:**
   - Verify web files are included in binary
   - Check for linker errors related to binary data

4. **Test in standalone mode:**
   - Build standalone version
   - Easier to debug than VST3 in DAW

5. **Enable verbose logging:**
   ```cpp
   #if JUCE_DEBUG
       DBG("WebView URL: " + webView->getURL());
       DBG("Resource provider root: " + WebBrowserComponent::getResourceProviderRoot());
   #endif
   ```

---

## Prevention: Use Validation Script

**Before building, always run:**
```powershell
.\scripts\validate-webview-setup.ps1 -PluginName YourPlugin
```

This catches 90% of common issues before they cause blank screens.

