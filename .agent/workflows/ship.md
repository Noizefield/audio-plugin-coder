---
description: "PHASE 5: Packaging - Build release and create installers"
---

# Ship Phase

**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

$state = Get-PluginState -PluginPath "plugins\$PluginName"

if ($state.current_phase -ne "code_complete") {
    Write-Error "Implementation not complete. Run /impl first."
    exit 1
}
```

**Execute Skill:**
Load and execute `...agent\skills\skill_packaging\SKILL.md`

**Validation:**
- Verify all formats built (VST3/AU/CLAP)
- Verify tests passed
- Verify installer created in dist/
- Verify GitHub commit successful

**Completion:**
```
🎉 Plugin shipped successfully!

Formats: VST3, AU, CLAP
Location: dist\[Name]-v[version].zip

GitHub: Committed and tagged

Plugin development complete!
```

