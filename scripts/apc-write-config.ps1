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
    [hashtable]$PhaseModels
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib\Get-ApcPaths.ps1"

$RepoRoot = Get-ApcRepoRoot
$example = Join-Path $RepoRoot "apc.config.example.json"
if (Test-Path $example) {
    $cfg = Get-Content $example -Raw | ConvertFrom-Json
} else {
    $cfg = Get-ApcDefaultConfig | ConvertTo-Json -Depth 10 | ConvertFrom-Json
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

Write-Host "Wrote $path" -ForegroundColor Green
Write-Host "Plugins: $($paths.PluginsDir)"
Write-Host "Build:   $($paths.BuildDir)"
Write-Host "Release: $($paths.ReleaseDir)"
