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
    Write-Host "✓ $($_.phase) - $($_.completed_at)"
}

Write-Host ""
Write-Host "=== Generation Timeline ===" -ForegroundColor Green
$generations = @($state.generations | ForEach-Object {
    $codename = if ($_.codename) { " `"$($_.codename)`"" } else { "" }
    "$($_.version)$codename ($($_.kind), $($_.status))"
})
if ($state.current_generation -and $state.current_generation.status -eq "open") {
    $g = $state.current_generation
    $generations += "$($g.version) ($($g.kind), OPEN @ $($state.current_phase))"
}
if ($generations.Count -eq 0) {
    Write-Host "(single initial generation - no patch/evolve history yet)"
} else {
    Write-Host ($generations -join " -> ")
}
if (($state.current_phase -eq "ship_complete" -or $state.current_phase -eq "complete") -and -not ($state.current_generation -and $state.current_generation.status -eq "open")) {
    Write-Host "Read-only: v$($state.version) is shipped. New work: /apc-patch (bug) or /apc-evolve (feature)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Yellow
switch ($state.current_phase) {
    "ideation" { Write-Host "/apc-plan [Name]" }
    "dream" { Write-Host "/apc-plan [Name]" }
    "plan" { Write-Host "/apc-design [Name]" }
    "plan_complete" { Write-Host "/apc-design [Name]" }
    "design" { Write-Host "/apc-impl [Name]" }
    "design_complete" { Write-Host "/apc-impl [Name]" }
    "code" { Write-Host "/apc-impl [Name] (finish implementation), then /apc-test [Name]" }
    "impl" { Write-Host "/apc-impl [Name] (finish implementation), then /apc-test [Name]" }
    "test" { Write-Host "/apc-test [Name] (finish validation), then /apc-ship [Name]" }
    "code_complete" { Write-Host "/apc-test [Name] (validate), then /apc-ship [Name]" }
    "ship" { Write-Host "/apc-ship [Name] (finish packaging)" }
    "debug" { Write-Host "/apc-debug [Name] (resolve open issues, then re-run current phase)" }
    "ship_complete" { Write-Host "Plugin complete! 🎉" }
    default { Write-Host "Current phase '$($state.current_phase)' is not a standard phase name - check status.json and phase_history for next steps" }
}
```
