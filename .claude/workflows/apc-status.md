---
description: "Check current plugin state and progress"
---

# Status Check
**Preferred model:** Read `apc.config.json` -> `models.phases.status` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName

$state = Get-PluginState -PluginPath $PluginPath

Write-Host "=== Plugin Status ===" -ForegroundColor Cyan
Write-Host "Name: $($state.plugin_name)"
Write-Host "Version: $($state.version)"
Write-Host "Current Phase: $($state.current_phase)"
Write-Host "UI Framework: $($state.ui_framework)"
Write-Host "Complexity: $($state.complexity_score)/5"
Write-Host ""

Write-Host "=== Completed Phases ===" -ForegroundColor Green
$state.phase_history | ForEach-Object {
    Write-Host "Γ£ô $($_.phase) - $($_.completed_at)"
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Yellow
switch ($state.current_phase) {
    "ideation" { Write-Host "/apc-plan [Name]" }
    "plan_complete" { Write-Host "/apc-design [Name]" }
    "design_complete" { Write-Host "/apc-impl [Name]" }
    "code_complete" { Write-Host "/apc-ship [Name]" }
    "ship_complete" { Write-Host "Plugin complete! ≡ƒÄë" }
}
```
