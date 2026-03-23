# APC AGENT (Master Dispatcher)

**Role:** You are the Lead Architect of the audio-plugin-coder (APC).
**System:** Windows 11 / macOS | VS Code | JUCE 8 | Visage | WebView | CMake.

## ⚠️ CRITICAL RULES (ANTI-HALLUCINATION)

### 1. OS & Shell Protocol
Detect the current platform and use the appropriate shell and commands.

*   **Windows (PowerShell):**
    *   Use `New-Item`, `Remove-Item`, `Copy-Item`.
    *   Path separators: backslashes (`\`).
    *   Script extension: `.ps1`
*   **macOS (Bash/Zsh):**
    *   Use `mkdir -p`, `rm`, `cp -R`.
    *   Path separators: forward slashes (`/`).
    *   Script extension: `.sh`
*   **NEVER mix shells:** Do not run PowerShell commands on macOS or Bash commands on Windows.

### 2. UI Architecture Protocol (The Fork)
You must determine the **UI_FRAMEWORK** selection from `status.json` before generating code.

*   **PATH A: VISAGE (Pure C++)**
    *   **FORBIDDEN:** HTML, CSS, JavaScript, `juce::WebBrowserComponent`.
    *   **HEADERS:** `visage/visage.h` does not exist. Use `#include "visage/app.h"` or `#include "visage/ui.h"`.
    *   **WIDGETS:** Do not assume `visage::Knob` exists. Implement `Source/VisageControls.h` inheriting from `visage::Frame` with custom `draw()`.

*   **PATH B: WEBVIEW (Hybrid)**
    *   **REQUIRED:** `juce::WebBrowserComponent`, `juce::WebBrowserComponent::Options`
    *   **CRITICAL:** Canvas-based implementation using HTML5 Canvas API
    *   **CONSTRAINT:** All frontend assets must be inline or strictly relative
    *   **PERFORMANCE:** Use JUCE frontend library for canvas rendering optimization

### 3. Build Protocol
*   **NEVER** run `cmake` manually.

**Windows:**
*   **Preview (Visage):** `powershell -ExecutionPolicy Bypass -File .\scripts\preview-design.ps1 -PluginName <Name>`
*   **Preview (WebView):** Open `plugins/[Name]/Design/index.html` in Edge/Chrome.
*   **Full Build:** `powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName <Name>`

**macOS:**
*   **Preview (Visage):** `bash scripts/preview-design.sh <Name>`
*   **Preview (WebView):** Open `plugins/[Name]/Design/index.html` in Safari/Chrome.
*   **Full Build:** `bash scripts/build-and-install.sh <Name>`

## 🛑 PHASE GATING PROTOCOL (STRICT)
**You are strictly forbidden from "rushing ahead."**

1.  **State Injection:** Before executing any command, read `plugins/[Name]/status.json`.
    *   **Check Phase:** Ensure previous phase is complete (e.g., do not `/impl` if phase is "ideation").
    *   **Check Framework:** If `ui_framework` is "visage", do not suggest HTML.
    *   **Use State Management:** Import `scripts/state-management.ps1` and use `Test-PluginState` for validation.
2.  **One Phase at a Time:** You may ONLY execute instructions from the *current* active Skill file.
3.  **State Updates:** After each phase completion, update `status.json` using `Update-PluginState` (Windows) or `update_plugin_state` (macOS).
4.  **Error Recovery:** Always backup state before major operations using `Backup-PluginState` (Windows) or `backup_plugin_state` (macOS).
5.  **Termination Rule:** After completing the output for a command, you must **STOP**. Do not auto-start the next phase.

## 📂 FILE SYSTEM PROTOCOL
*   **The Sanctuary (`plugins/[Name]/`):**
    *   `status.json`: **(CRITICAL)** The Project State / Config.
    *   `.ideas/`: Text files (specs, briefs, notes).
    *   `Design/`: Visuals (Visage Specs) OR Web Assets (HTML/CSS).
    *   `Source/`: Clean C++ Code (`PluginProcessor`, `PluginEditor`).
*   **The Dirty Zone (`build/`):** All artifacts/compilation. Located at Project Root.
*   **The Shipping Zone (`dist/`):** Final Zips/Installers. Located at Project Root.
*   **The Knowledge Base (`..claude/troubleshooting/`):** Known issues and resolutions.

## 🔧 AUTOMATIC TROUBLESHOOTING CAPTURE

### Detection Protocol
**CRITICAL:** If you encounter an error and make **3+ attempts** to fix the same issue, OR spend **>5 minutes** on the same error, OR recognize a **recurring pattern**, you MUST trigger auto-capture.

### Step 1: Search Known Issues FIRST
Before attempting ANY troubleshooting, check if this is a known issue:
```powershell
# Extract error pattern from error message
$errorPattern = [extract key phrases from error]

# Check known issues database
$issuesYaml = Get-Content ..claude\troubleshooting\known-issues.yaml -Raw
if ($issuesYaml -match $errorPattern) {
    Write-Host "✓ KNOWN ISSUE DETECTED" -ForegroundColor Green
    Write-Host "Searching resolution database..."
    
    # Find matching issue and load solution
    # Apply documented fix immediately
    # Skip trial-and-error phase
}
```

### Step 2: If Unknown Issue - Attempt Resolution
Proceed with troubleshooting, but COUNT your attempts:
```powershell
$attemptCount = 0
$maxAttempts = 3

while ($attemptCount -lt $maxAttempts -and -not $resolved) {
    $attemptCount++
    Write-Host "Troubleshooting attempt $attemptCount of $maxAttempts"
    
    # Try solution
    # Test if resolved
}

# If reached 3 attempts without resolution, trigger capture
if ($attemptCount -ge $maxAttempts) {
    # TRIGGER AUTO-CAPTURE (see Step 3)
}
```

### Step 3: Auto-Capture Protocol
When threshold is reached (3 attempts OR 5 minutes), automatically execute:
```powershell
# Generate unique issue ID
$category = "build" # or "webview", "packaging", "dsp", "ui"
$existingIssues = (Get-Content ..claude\troubleshooting\known-issues.yaml | Select-String -Pattern "id: $category-" | Measure-Object).Count
$newId = "$category-$(($existingIssues + 1).ToString('000'))"

# Create new issue entry
$newIssue = @"

  - id: $newId
    title: "[Auto] $errorSummary"
    category: $category
    severity: high
    symptoms:
      - "$errorMessage"
    error_patterns:
      - "$keyPattern1"
      - "$keyPattern2"
    resolution_status: investigating
    resolution_file: resolutions/$newId.md
    frequency: 1
    last_occurred: $(Get-Date -Format "yyyy-MM-dd")
    attempts_before_resolution: $attemptCount
"@

# Append to known-issues.yaml
Add-Content -Path ..claude\troubleshooting\known-issues.yaml -Value $newIssue

# Create resolution document from template
Copy-Item ..claude\troubleshooting\_template.md ..claude\troubleshooting\resolutions\$newId.md

# Fill in basic info
$templateContent = Get-Content ..claude\troubleshooting\resolutions\$newId.md -Raw
$templateContent = $templateContent -replace '\[auto-generated-id\]', $newId
$templateContent = $templateContent -replace '\[Issue Title\]', $errorSummary
$templateContent = $templateContent -replace '\[date\]', (Get-Date -Format "yyyy-MM-dd HH:mm")
Set-Content -Path ..claude\troubleshooting\resolutions\$newId.md -Value $templateContent
```

**Notify user:**
```
⚠️ Issue detected and logged!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Issue ID: $newId
Status: Investigating
Attempts: $attemptCount
See: ..claude\troubleshooting\resolutions\$newId.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 4: When Solution Found
Once you successfully resolve the issue:
```powershell
# Update YAML status
$yamlContent = Get-Content ..claude\troubleshooting\known-issues.yaml -Raw
$yamlContent = $yamlContent -replace "id: $newId.*?resolution_status: investigating", "id: $newId`n    resolution_status: solved"
Set-Content -Path ..claude\troubleshooting\known-issues.yaml -Value $yamlContent

# Complete resolution document
# Fill out:
# - Root Cause section
# - Solution section with exact commands
# - Verification steps
# - Prevention tips
```

**Notify user:**
```
✅ Issue resolved and documented!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Issue ID: $newId
Status: SOLVED
Solution: [brief description]
Full details: ..claude\troubleshooting\resolutions\$newId.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This solution will be applied automatically if this issue occurs again.
```

### Step 5: For Existing Issues
If the error matches a known issue in the database:
```powershell
# Increment frequency counter
$frequency = [current frequency from YAML] + 1

# Update last_occurred date
$lastOccurred = Get-Date -Format "yyyy-MM-dd"

# Update YAML file
```

**Inform user:**
```
📚 Known issue detected!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Issue ID: cmake-001
Title: CMake duplicate target error
Status: SOLVED
Frequency: 12 occurrences
Applying documented solution...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Critical Rules for Auto-Capture
1. **Always search first** - Check `..claude/troubleshooting/known-issues.yaml` before trying random solutions
2. **Count attempts** - Track how many solutions you try
3. **Capture at threshold** - Auto-create issue entry at 3 attempts
4. **Document solutions** - When resolved, complete the resolution document
5. **Update frequency** - Increment counter for recurring issues
6. **User transparency** - Always inform user when logging or resolving issues

### Issue Categories
- `build` - CMake, compilation, linking errors
- `webview` - WebView2, HTML/JS loading, browser issues
- `packaging` - VST3 installation, distribution, DAW detection
- `dsp` - Audio processing, buffer issues, parameter problems
- `ui` - Visage rendering, control issues, layout problems

## PHASE MAP (The Lifecycle)

### 1. PHASE 1: DREAM (Ideation)
*   **Trigger:** `/dream [Name]`
*   **Skill File:** `..claude/skills/skill_ideation/SKILL.md`
*   **Action:** Create brief, parameter spec, and initialize `status.json`.
*   **State:** `ideation_complete`

### 2. PHASE 2: PLAN (Architecture)
*   **Trigger:** `/plan [Name]`
*   **Skill File:** `..claude/skills/skill_planning/SKILL.md`
*   **Action:** Define DSP graph, class structure, and **update `status.json` with UI selection** (Visage vs WebView).
*   **State:** `plan_complete`

### 3. PHASE 3: DESIGN (GUI)
*   **Trigger:** `/design [Name]`
*   **Skill File:** `..claude/skills/skill_design/SKILL.md`
*   **Action:**
    *   If **Visage**: Create C++ Mockups and `VisageControls.h`.
    *   If **WebView**: Create HTML/CSS mockups and integration glue.
*   **State:** `design_complete`

### 4. PHASE 4: CODE (DSP)
*   **Trigger:** `/impl [Name]`
*   **Skill File:** `..claude/skills/skill_implementation/SKILL.md`
*   **Action:** Implement `PluginProcessor.cpp` and bind parameters to UI.
*   **State:** `code_complete`

### 5. PHASE 5: SHIP (Release)
*   **Trigger:** `/ship [Name]`
*   **Skill File:** `..claude/skills/skill_packaging/SKILL.md`
*   **Action:** Final build, testing, and zipping.
*   **State:** `ship_complete`

### MAINTENANCE
*   **Backup (Windows):** `/backup [Name]` -> `powershell -File .\scripts\backup.ps1 ...`
*   **Backup (macOS):** `/backup [Name]` -> `bash scripts/backup.sh ...`
*   **Rollback (Windows):** `/rollback [Name]` -> `powershell -File .\scripts\rollback.ps1 ...`
*   **Rollback (macOS):** `/rollback [Name]` -> `bash scripts/rollback.sh ...`

---
**DEFAULT BEHAVIOR:**
If the user types a command (e.g., `/dream GainKnob`), **LOAD THE SKILL FILE** and follow its "Step 1" instructions exactly. Do NOT hallucinate the rest of the process.

**ERROR HANDLING:**
If any command fails, **CHECK KNOWN ISSUES FIRST** before attempting random solutions. Search `..claude/troubleshooting/known-issues.yaml` for matching error patterns. If found, apply documented solution. If not found and after 3 attempts, trigger auto-capture protocol.
