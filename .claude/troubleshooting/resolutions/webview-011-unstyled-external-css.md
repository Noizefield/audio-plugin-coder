# WebView UI Loads but Looks Messy / Unstyled (External CSS)

**Issue ID:** webview-011
**Category:** webview
**Severity:** High
**Status:** SOLVED
**First Detected:** 2026-08-13
**Date Resolved:** 2026-08-13
**Plugin:** Organik (also applies to any Hackerbridge / Design-to-WebUI conversion)

---

## Lessons learned (read this first)

JUCE WebView2 is **not a browser**. A Design `index.html` that looks perfect in Edge will look like **raw HTML** in the plugin if stylesheets are loaded with `<link rel="stylesheet" href="css/...">`.

**Do this for every WebView plugin:**

1. **Inline all CSS and JS in `index.html`** (CloudWash pattern). External `.css` / `.js` files are optional copies for browser preview only.
2. **`getResource()` must map BinaryData by basename AND path.** `juce_add_binary_data` stores `tokens.css`, not `css/tokens.css`. Never rewrite unknown URLs to `index.html`.
3. **Do not ship Design preview chrome in the plugin.** `.preview-stage`, `.hint`, and `fit() * 0.96` are for the browser mockup. In the plugin, add `html.plugin-host` when `window.__JUCE__` exists.
4. **Stop the running Standalone before rebuild.** VST3 can update while `Organik.exe` stays locked and stale. Search **both** binaries for a unique HTML marker after build.

This is **not** webview-007 (black screen / no HTML) and **not** webview-010 (resource provider never called). HTML and JS loaded; **CSS did not apply**.

---

## Problem description

Plugin / Standalone window opens at the correct size. Structure is visible (tabs, buttons, sequencer labels) but the UI looks messy: default OS/WebView buttons, overlapping absolute layout, broken logo, Windows scrollbar, no Hackerbridge chrome.

Browser Design preview (`Design/v9-test.html`) looks correct.

---

## Symptoms

- HTML is clearly loading (text, buttons, some canvas drawing)
- Default white/grey form controls instead of Hackerbridge `.btn` / cards
- Overlapping rows (absolute Design layout without CSS)
- Broken image icon for `assets/logo.svg`
- Footer hint like `ORGANIK · Hackerbridge v6 · 954×810` still visible
- Vertical scrollbar on a 954×810 editor
- No black screen (that would be webview-007 / webview-010)

**Organik 2026-08-13:** Standalone showed unstyled HTML; Design v9 in Edge was fine.

---

## Root cause

Several failures stacked:

### 1. External stylesheets (primary)

Design HTML uses:

```html
<link rel="stylesheet" href="css/tokens.css" />
<link rel="stylesheet" href="css/hackerbridge_style.css" />
```

That works in a normal browser. In JUCE WebView2, linked CSS often **never applies** (same class of failure as ES6 modules / webview-008). CloudWash inlines CSS in `index.html` for this reason.

### 2. `getResource()` URL collapse

Typical conversion code:

```cpp
auto path = url.fromFirstOccurrenceOf (
    juce::WebBrowserComponent::getResourceProviderRoot(), false, false);
if (path.isEmpty() || path == "/")
    path = "index.html";
```

`String::fromFirstOccurrenceOf` returns **empty** if the substring is missing. Relative requests such as `css/tokens.css` then become **`index.html`**. The stylesheet request gets HTML; WebView discards it; the page stays unstyled.

`juce_add_binary_data` original filenames are **basenames only** (`tokens.css`, `logo.svg`), not `css/tokens.css` / `assets/logo.svg`. Matching must accept both.

### 3. Design preview wrapper left in production

`.preview-stage` (centering + 0.96 scale), `.hint`, and `fit()` assuming a browser window make the plugin layout look cropped or “floating” even after CSS works.

### 4. Stale Standalone binary

`build-and-install.ps1` can rebuild VST3 while a running Standalone **locks `Organik.exe`**. Next launch still uses the old unstyled HTML. Verify:

```powershell
Select-String -Path "...\Standalone\Organik.exe" -Pattern "organik-embedded-css" -Encoding utf8
Select-String -Path "...\VST3\...\Organik.vst3" -Pattern "organik-embedded-css" -Encoding utf8
```

(Or search file bytes for the marker.) If VST3 has the marker and EXE does not: kill the process and rebuild Standalone.

---

## Solution

### A. Inline CSS (required)

In `plugins/<Name>/WebUI/index.html` (APC protocol path; not `Source/ui/public`):

- Replace `<link rel="stylesheet" href="css/...">` with `<style>` containing `tokens.css` + `hackerbridge_style.css`.
- Fix `@font-face` URLs from `url('../fonts/...')` to `url('fonts/...')` (page root, not CSS-relative).
- Keep JS inlined (webview-008). Stub `js/index.js` is fine if unused.

Working reference: `plugins/CloudWash/Source/ui/public/index.html`.

### B. Explicit BinaryData map (required)

Do **not** funnel every miss to `index.html`. Map known files; return `nullopt` otherwise.

```cpp
const auto root = juce::WebBrowserComponent::getResourceProviderRoot();
juce::String path = url;
if (path.startsWithIgnoreCase (root))
    path = path.substring (root.length());
else if (auto scheme = path.indexOf ("://"); scheme >= 0)
    path = path.substring (scheme + 3).fromFirstOccurrenceOf ("/", false, false);

while (path.startsWithChar ('/'))
    path = path.substring (1);

const auto base = path.fromLastOccurrenceOf ("/", false, false);

if (path == "css/tokens.css" || base == "tokens.css")
    /* BinaryData::tokens_css, "text/css" */;
else if (path == "assets/logo.svg" || base == "logo.svg")
    /* BinaryData::logo_svg, "image/svg+xml" */;
// ... fonts, html, js
```

Confirm names in `build/plugins/<Name>/juce_binarydata_<Name>_WebUI/JuceLibraryCode/BinaryData.h`.

### C. Plugin-host layout

```js
if (typeof window.__JUCE__ !== 'undefined')
  document.documentElement.classList.add('plugin-host');
```

Hide `.hint`, drop browser-only scale, fill the WebView. Scale with `pad = 1.0` in the plugin, `0.96` only in browser preview.

### D. Rebuild both formats

Stop Standalone, then:

```powershell
.\scripts\build-and-install.ps1 -PluginName Organik -SkipTests
```

Confirm **Standalone and VST3** timestamps and the HTML marker. Clear `%TEMP%\EBWebView` if WebView2 looks cached.

---

## Troubleshooting decision tree

| What you see | Issue | First check |
| :--- | :--- | :--- |
| Pure black window, no controls | webview-007 / webview-010 | Constructor order; `getResource` called; BinaryData |
| HTML/buttons visible, default OS chrome, overlap | **webview-011 (this)** | `<link rel="stylesheet">`; CSS URL → `index.html`; stale EXE |
| HTML structure, knobs are dots, no arcs | webview-008 | ES6 `type="module"` / external JS |
| UI correct in VST3, messy in Standalone | stale EXE | Kill process; rebuild Standalone; compare file times |

**Validator:** `.\scripts\validate-webview-setup.ps1 -PluginName <Name>` flags external stylesheets.

**Screenshot:** Open Standalone, capture the window, compare to `plugins/<Name>/Design/v9-test.html` (or latest approved Design). If Design is styled and plugin is not, this issue.

---

## Verification

- [ ] `WebUI/index.html` has no `<link rel="stylesheet">`
- [ ] CSS lives in `<style>` (search for a unique class like `.h-nav-btn`)
- [ ] `getResource` maps basename + path; does not default CSS URLs to `index.html`
- [ ] Logo/fonts load (no broken-image icon)
- [ ] No Design hint footer in plugin
- [ ] Standalone **and** VST3 contain the new HTML (marker / file time)
- [ ] Screenshot matches approved Design (Hackerbridge cards, not default buttons)

---

## Prevention (for agents converting Design → WebUI)

1. Read this file and webview-008 **before** copying `Design/index.html` into `WebUI/`.
2. Do not treat “HTML appeared” as “UI is done.” Unstyled HTML is a failed conversion.
3. CloudWash is the production pattern: **one HTML file, CSS+JS inline**.
4. `juce_add_binary_data` still lists CSS/fonts/svg if you keep them for preview, but the plugin page must not depend on `<link>` / `<script src>`.
5. After rebuild, if Standalone looks old: the exe was locked. Kill it and rebuild.

---

## Related issues

- **webview-008:** ES6 modules / external JS fail (same “inline everything” rule)
- **webview-007:** Black screen — BinaryData / filesystem paths
- **webview-010:** Black screen — `getResource()` never called (constructor order)
- **webview-001:** Path / 404
- CloudWash: `plugins/CloudWash/Source/ui/public/index.html`
- Organik production: `plugins/Organik/WebUI/index.html`, `Source/PluginEditor.cpp` `getResource()`

---

## Tags

`webview` `css` `inline` `BinaryData` `hackerbridge` `organik` `standalone-stale`

---

**Created by:** Cursor agent (Organik /impl)
**Resolved:** 2026-08-13
**Attempts before resolution:** 2 (constructor-order fix first; CSS/resource/stale-exe second)
