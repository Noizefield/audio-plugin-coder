# Initialize and update submodules, then optionally write a default apc.config.json
param(
    [switch]$WriteDefaultConfig
)

$ErrorActionPreference = "Stop"

Write-Host "Initializing and updating Git submodules..." -ForegroundColor Cyan
git submodule update --init --recursive

if ($WriteDefaultConfig) {
    & "$PSScriptRoot\apc-write-config.ps1" -MarkCompleted -Platform windows
}

Write-Host "Run system check:" -ForegroundColor Cyan
Write-Host "  .\scripts\system-check.ps1 -Human"
Write-Host "Then in your AI agent: /apc-setup" -ForegroundColor Green
Write-Host "Setup script complete." -ForegroundColor Green
