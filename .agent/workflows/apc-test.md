---
description: "Run tests on the plugin"
---

# Test Phase
**Preferred model:** Read `apc.config.json` -> `models.phases.test` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

$state = Get-PluginState -PluginPath "plugins\$PluginName"

if ($state.current_phase -ne "code_complete" -and $state.current_phase -ne "design_complete") {
    Write-Error "Implementation must be complete first."
    exit 1
}
```

**Execute Skill:**
Load and execute `..agent\skills\skill_testing\SKILL.md`

**Tests Run:**
- Build verification
- Parameter functionality
- UI rendering
- DAW compatibility
- Memory leaks

**Completion:**
```
Γ£à Tests complete!

Results: [Pass/Fail count]

Next step: /apc-ship [Name] if all tests passed
```
