---
description: "Run tests on the plugin"
---

# Test Phase

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
Load and execute `...agent\skills\skill_testing\SKILL.md`

**Tests Run:**
- Build verification
- Parameter functionality
- UI rendering
- DAW compatibility
- Memory leaks

**Completion:**
```
✅ Tests complete!

Results: [Pass/Fail count]

Next step: /ship [Name] if all tests passed
```

