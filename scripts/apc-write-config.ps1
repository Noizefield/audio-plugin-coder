<#
.SYNOPSIS
    Write or update apc.config.json from parameters (used by /apc-setup).
#>
[CmdletBinding()]
param(
    [string]$PluginsDir = "plugins",
    [string]$BuildDir = "build",
    [string]$ReleaseDir = "release",
    [ValidateSet("webview", "visage")][string]$UiPreference = "webview",
    [switch]$EnableVisage,
    [ValidateSet("quality", "balanced", "budget")][string]$ModelProfile = "balanced",
    [string]$Platform = "windows",
    [switch]$MarkCompleted,
    [hashtable]$PhaseModels,
    [switch]$EnableCodexOrchestration,
    [switch]$EnableCodexEscalation,
    [switch]$InstallCodexProfiles
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib\Get-ApcPaths.ps1"

$RepoRoot = Get-ApcRepoRoot
$example = Join-Path $RepoRoot "apc.config.example.json"
$existingPath = Join-Path $RepoRoot "apc.config.json"

# Prefer merging into an existing local config so re-running setup does not wipe custom values.
if (Test-Path $existingPath) {
    $cfg = Get-Content $existingPath -Raw | ConvertFrom-Json
}
elseif (Test-Path $example) {
    $cfg = Get-Content $example -Raw | ConvertFrom-Json
}
else {
    $cfg = Get-ApcDefaultConfig | ConvertTo-Json -Depth 10 | ConvertFrom-Json
}

# Ensure models.codex exists (shipped in example; merge for older local configs).
if (Test-Path $example) {
    $exampleCfg = Get-Content $example -Raw | ConvertFrom-Json
    if ($exampleCfg.models -and $exampleCfg.models.codex) {
        if (-not $cfg.models) {
            $cfg | Add-Member -NotePropertyName models -NotePropertyValue ([pscustomobject]@{}) -Force
        }
        if (-not $cfg.models.codex) {
            $cfg.models | Add-Member -NotePropertyName codex -NotePropertyValue $exampleCfg.models.codex -Force
        }
    }
}

$cfg.paths.plugins_dir = $PluginsDir
$cfg.paths.build_dir = $BuildDir
$cfg.paths.release_dir = $ReleaseDir
$cfg.defaults.ui_framework_preference = $UiPreference
$cfg.defaults.enable_visage = [bool]$EnableVisage
$cfg.models.profile = $ModelProfile

if ($PhaseModels) {
    if (-not $cfg.models.phases) {
        $cfg.models | Add-Member -NotePropertyName phases -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    foreach ($key in $PhaseModels.Keys) {
        $cfg.models.phases | Add-Member -NotePropertyName $key -NotePropertyValue $PhaseModels[$key] -Force
    }
}

if ($cfg.models.codex) {
    $cfg.models.codex.enabled = [bool]$EnableCodexOrchestration
    if (-not $cfg.models.codex.escalation) {
        $cfg.models.codex | Add-Member -NotePropertyName escalation -NotePropertyValue ([pscustomobject]@{
            enabled = $false
            order = @("luna", "terra", "sol", "astra")
            on_build_fail = $true
            verify_command = $null
        }) -Force
    }
    $cfg.models.codex.escalation.enabled = [bool]$EnableCodexEscalation
}

if ($MarkCompleted) {
    $cfg.setup.completed = $true
    $cfg.setup.completed_at = (Get-Date).ToString("o")
    $cfg.setup.platform = $Platform
}

$path = Write-ApcConfig -Config $cfg -RepoRoot $RepoRoot

# Ensure directories exist
$paths = Get-ApcPaths -RepoRoot $RepoRoot
foreach ($dir in @($paths.PluginsDir, $paths.BuildDir, $paths.ReleaseDir)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

if ($InstallCodexProfiles -or $EnableCodexOrchestration) {
    $installer = Join-Path $RepoRoot "scripts\codex\install-profiles.ps1"
    if (Test-Path $installer) {
        & $installer
    }
}

Write-Host "Wrote $path" -ForegroundColor Green
Write-Host "Plugins: $($paths.PluginsDir)"
Write-Host "Build:   $($paths.BuildDir)"
Write-Host "Release: $($paths.ReleaseDir)"
if ($cfg.models.codex) {
    Write-Host "Codex orchestration: enabled=$($cfg.models.codex.enabled) escalation=$($cfg.models.codex.escalation.enabled)"
}
