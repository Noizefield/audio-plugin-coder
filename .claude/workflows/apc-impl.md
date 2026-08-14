---
description: "PHASE 4: Implementation - Build DSP and UI code"
---

# Implementation Phase
**Preferred model:** Read `apc.config.json` -> `models.phases.impl` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

$state = Get-PluginState -PluginPath "plugins\$PluginName"

if ($state.current_phase -ne "design_complete") {
    Write-Error "Design phase not complete. Run /apc-design first."
    exit 1
}

# Backup before major operation
Backup-PluginState -PluginPath "plugins\$PluginName"
```

**Execute Skill:**
Load and execute `..claude\skills\impl\SKILL.md`

**Key Steps:**
1. **Design Conversion:** Convert approved design specs to framework-specific code (WebView HTML/JS or Visage C++)
2. **User Approval:** Test the converted UI before proceeding
3. **DSP Implementation:** Build audio processing engine
4. **Integration:** Connect parameters to UI controls

**Framework Routing:**
- **WebView:** Use templates in `templates/webview/` and run WebView validation scripts.
- **Visage:** Use templates in `templates/visage/`. Do NOT generate HTML.

**Pre-Build Validation (Visage):**
```powershell
# If Visage framework, validate Visage setup
if ($state.ui_framework -eq "visage") {
    .\scripts\validate-visage-setup.ps1 -PluginName $PluginName
}
```

**Pre-Build Validation (WebView Only):**
```powershell
# If WebView framework, validate member declaration order
if ($state.ui_framework -eq "webview") {
    Write-Host "Validating WebView member declaration order..." -ForegroundColor Yellow

    # Check if validation script exists
    if (Test-Path ".\scripts\validate-webview-member-order.ps1") {
        $validationResult = & ".\scripts\validate-webview-member-order.ps1" -PluginName $PluginName

        if (-not $validationResult) {
            Write-Error @"
? CRITICAL: Member declaration order is incorrect!

WebView must be declared AFTER relays to prevent DAW crashes.

Expected order in PluginEditor.h:
1. Relays (e.g., juce::WebSliderRelay)
2. WebView (std::unique_ptr<WebBrowserComponent>)
3. Attachments (std::unique_ptr<...Attachment>)

See: .claude/troubleshooting/resolutions/webview-member-order-crash.md

Fix the order before building to avoid crashes on plugin unload.
"@
            exit 1
        }
        Write-Host "? Member order validated successfully" -ForegroundColor Green
    } else {
        Write-Warning "Validation script not found, skipping member order check"
        Write-Host "IMPORTANT: Verify member order manually:" -ForegroundColor Yellow
        Write-Host "  Relays ? WebView ? Attachments" -ForegroundColor Yellow
    }
}
```

**Build & Test:**
```powershell
# Run build script
.\scripts\build-and-install.ps1 -PluginName $PluginName
```

**Validation:**
- Verify ui/ folder contains WebView files (for WebView framework)
- Verify Source/ folder contains PluginProcessor.cpp/.h
- Verify Source/ folder contains PluginEditor.cpp/.h
- Verify build completed successfully
- Verify plugin loads in DAW

**Error Recovery:**
If build fails:
```powershell
Restore-PluginState -PluginPath "plugins\$PluginName"
```

**Completion:**
```
Γ£à Implementation phase complete!

Plugin built successfully!
Location: build\[Name]\Debug\VST3\[Name].vst3

Next step: /apc-test [Name] or /apc-ship [Name]
```

## Error Handling Protocol

**Before starting implementation:**
```powershell
# Check for common issues related to this phase
$phaseIssues = Get-Content ..claude\troubleshooting\known-issues.yaml | 
    ConvertFrom-Yaml | 
    Where-Object { $_.category -eq "implementation" }

if ($phaseIssues) {
    Write-Host "≡ƒôÜ Known issues for this phase:"
    $phaseIssues | ForEach-Object {
        Write-Host "  - $($_.title) [$($_.resolution_status)]"
    }
}
```

**If error occurs during build:**
1. Capture error message
2. Search known-issues.yaml
3. If found: Apply documented solution
4. If not found: Attempt resolution + auto-capture
```

---

## **Where to Put Your Current Document:**

Your "JUCE 8 CRITICAL SYSTEM PROTOCOLS" should go in **two places**:

### **1. As a Rule** (`..claude/rules/juce-build-protocols.md`)
Because these are **constraints that always apply**

### **2. As Known Issues** (`..claude/troubleshooting/resolutions/`)
Break it into individual issue files:
```
..claude\troubleshooting\resolutions\
Γö£ΓöÇΓöÇ cmake-duplicate-target.md          # Section 2B from your doc
Γö£ΓöÇΓöÇ webview-path-structure.md          # Section 2A from your doc
Γö£ΓöÇΓöÇ monorepo-build-context.md          # Section 1B from your doc
ΓööΓöÇΓöÇ manual-build-forbidden.md          # Section 1A from your doc
```

---

## **Example Auto-Capture Flow:**
```
AI encounters error: "CMake Error: Target 'juce_core' already exists"
    Γöé
    Γû╝
AI tries fix #1: Remove duplicate juce_add_modules ΓåÆ Fails
    Γöé
    Γû╝
AI tries fix #2: Clean build folder ΓåÆ Fails
    Γöé
    Γû╝
AI tries fix #3: Check CMakeLists.txt hierarchy ΓåÆ Success!
    Γöé
    Γû╝
AI triggers auto-capture:
    Γö£ΓöÇΓöÇ Updates known-issues.yaml (frequency++)
    Γö£ΓöÇΓöÇ Creates/updates resolution doc
    ΓööΓöÇΓöÇ Notifies user: "Issue logged as cmake-001"
    Γöé
    Γû╝
Next time same error occurs:
    Γö£ΓöÇΓöÇ AI searches known-issues.yaml first
    Γö£ΓöÇΓöÇ Finds cmake-001 with solution
    ΓööΓöÇΓöÇ Applies fix immediately (no trial/error)
```

---

## **Benefits:**

1. Γ£à **Self-improving system** - Gets smarter over time
2. Γ£à **Faster resolution** - Known issues solved in seconds
3. Γ£à **Knowledge preservation** - Solutions aren't lost between sessions
4. Γ£à **Pattern detection** - Frequency tracking shows common pain points
5. Γ£à **User transparency** - User sees what was tried and why

---

## **Summary:**

**Create these files:**
```
..claude\troubleshooting\
Γö£ΓöÇΓöÇ known-issues.yaml           # ΓåÉ Machine-readable database
Γö£ΓöÇΓöÇ _template.md                # ΓåÉ Template for new issues
ΓööΓöÇΓöÇ resolutions\                # ΓåÉ Detailed solution docs
    Γö£ΓöÇΓöÇ cmake-duplicate-target.md
    Γö£ΓöÇΓöÇ webview-path-error.md
    ΓööΓöÇΓöÇ vst3-install-failed.md
