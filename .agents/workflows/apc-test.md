---
description: "Run tests on the plugin"
---

# Test Phase
**Preferred model:** Read `apc.config.json` -> `models.phases.test` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName

$state = Get-PluginState -PluginPath $PluginPath

if ($state.current_phase -ne "code_complete" -and $state.current_phase -ne "design_complete") {
    Write-Error "Implementation must be complete first."
    exit 1
}
```

**Execute Skill:**
Load and execute `.agents/skills/skill_testing/SKILL.md`

**UI Contract Gate (WebView only):**
```powershell
if ($state.ui_framework -eq "webview") {
    node bin/apc.js validate ui --plugin $PluginName
    # Then screenshot the rendered UI at scale_range endpoints + midpoint and
    # compare against the approved design shots (Design/shots/ if present):
    # relative geometry must be identical at every scale — same cells, no
    # letterbox margins, no clipped edges.
}
```

**Tests Run:**
- Build verification
- Parameter functionality
- UI rendering (contract gate above + visual check at min/mid/max scale)
- DAW compatibility
- Memory leaks

**Completion:**
```
Γ£à Tests complete!

Results: [Pass/Fail count]

Next step: /apc-ship [Name] if all tests passed
```
