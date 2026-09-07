<#
.SYNOPSIS
    Copy APC Codex profile templates into the user Codex config directory.
.DESCRIPTION
    Copies scripts/codex/profiles/*.config.toml to ~/.codex/ (or $env:USERPROFILE\.codex).
    Does not overwrite existing files unless -Force is set.
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [string]$RepoRoot = "",
    [string]$CodexHome = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
if (-not $CodexHome) {
    if ($env:CODEX_HOME) {
        $CodexHome = $env:CODEX_HOME
    }
    else {
        $CodexHome = Join-Path $env:USERPROFILE ".codex"
    }
}

$src = Join-Path $RepoRoot "scripts\codex\profiles"
if (-not (Test-Path $src)) {
    throw "Missing profile templates: $src"
}

New-Item -ItemType Directory -Force -Path $CodexHome | Out-Null

Get-ChildItem -Path $src -Filter "*.config.toml" | ForEach-Object {
    $dest = Join-Path $CodexHome $_.Name
    if ((Test-Path $dest) -and -not $Force) {
        Write-Host "Skip existing $($_.Name) (use -Force to overwrite)"
    }
    else {
        Copy-Item -Path $_.FullName -Destination $dest -Force
        Write-Host "Installed $($_.Name) -> $dest"
    }
}

Write-Host "Done. Example: codex exec --profile luna `"Reply with ok`""
