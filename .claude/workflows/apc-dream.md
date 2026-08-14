---
description: "PHASE 1: Ideation - Create creative brief and parameter spec"
---

# Dream Phase
**Preferred model:** Read `apc.config.json` -> `models.phases.dream` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**Prerequisites:**
- None (entry point)

**State Check:**
```powershell
# Check if plugin already exists
if (Test-Path "plugins\$PluginName") {
    Write-Warning "Plugin already exists. Use /apc-resume to continue existing plugin."
    exit 1
}
```

**Execute Skill:**
Load and execute `..claude\skills\dream\SKILL.md`

**Validation:**
- Verify `plugins\[Name]\status.json` exists
- Verify `current_phase` = "ideation"
- Verify creative brief and parameter spec exist

**Completion:**
Stop and inform user:
```
Γ£à Dream phase complete!

Files created:
- plugins/[Name]/.ideas/creative-brief.md
- plugins/[Name]/.ideas/parameter-spec.md
- plugins/[Name]/apc-status.json

Next step: /apc-plan [Name]
```

---
description: "PHASE 2: Architecture - Define structure and select UI framework"
---

# Plan Phase

**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

if (-not (Test-PluginState -PluginPath "plugins\$PluginName" -RequiredPhase "ideation" -RequiredFiles @(".ideas/creative-brief.md", ".ideas/parameter-spec.md"))) {
    Write-Error "Prerequisites not met. Complete /apc-dream first."
    exit 1
}
```

**Execute Skill:**
Load and execute `..claude\skills\plan\SKILL.md`

**Critical Decision Point:**
This phase MUST determine and set `ui_framework` in status.json:
- "visage" for pure C++ (Visage)
- "webview" for hybrid HTML/Canvas

**Validation:**
- Verify `ui_framework` is NOT "pending"
- Verify architecture.md exists
- Verify complexity_score is set

**Completion:**
```
Γ£à Plan phase complete!

Framework selected: [Visage/WebView]
Complexity score: [N]/5

Files created:
- plugins/[Name]/.ideas/architecture.md
- plugins/[Name]/.ideas/apc-plan.md

Next step: /apc-design [Name]
```
