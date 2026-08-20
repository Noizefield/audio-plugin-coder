---
description: "Resume plugin development from current state"
---

# Resume Development
**Preferred model:** Read `apc.config.json` -> `models.phases.resume` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName

$state = Get-PluginState -PluginPath $PluginPath

Write-Host "Resuming plugin: $($state.plugin_name)" -ForegroundColor Cyan
Write-Host "Current phase: $($state.current_phase)"
Write-Host ""

# Suggest next command
$nextCommand = switch ($state.current_phase) {
    "ideation" { "/apc-plan $($state.plugin_name)" }
    "plan_complete" { "/apc-design $($state.plugin_name)" }
    "design_complete" { "/apc-impl $($state.plugin_name)" }
    "code_complete" { "/apc-ship $($state.plugin_name)" }
    "ship_complete" { "Plugin is complete!" }
    default { "/apc-status $($state.plugin_name)" }
}

Write-Host "Next command: $nextCommand" -ForegroundColor Green

# Show any errors
if ($state.error_recovery.error_log.Count -gt 0) {
    Write-Host ""
    Write-Host "ΓÜá∩╕Å  Errors found:" -ForegroundColor Yellow
    $state.error_recovery.error_log | ForEach-Object {
        Write-Host "  - $_"
    }
}
```
