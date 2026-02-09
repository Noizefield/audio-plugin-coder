<#
.SYNOPSIS
    Instant GUI Preview
#>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PluginName)

$ErrorActionPreference = "Stop"
$RootPath = (Get-Item "$PSScriptRoot\..").FullName
$BuildDir = "$RootPath\build"
$StatusJson = Join-Path $RootPath "plugins\$PluginName\status.json"
$UseVisage = $false

if (Test-Path $StatusJson) {
    try {
        $state = Get-Content $StatusJson -Raw | ConvertFrom-Json
        if ($state.ui_framework -eq "visage") {
            $UseVisage = $true
        }
    } catch {
        Write-Warning "Could not read status.json; proceeding without framework hints."
    }
}

$VisageFlag = @()
if ($UseVisage) { $VisageFlag += "-DAPC_ENABLE_VISAGE:BOOL=ON" }

$FrameworkName = if ($UseVisage) { "visage" } else { "webview" }
Write-Host "Framework: $FrameworkName" -ForegroundColor DarkGray

Write-Host "--- APC PREVIEW: $PluginName ---" -ForegroundColor Cyan

# 1. Configure (ensure correct framework flags)
Write-Host "Configuring..." -ForegroundColor Yellow
cmake -B "$BuildDir" -G "Visual Studio 17 2022" -A x64 --fresh @VisageFlag

if ($UseVisage -and (Test-Path "$BuildDir\CMakeCache.txt")) {
    $cache = Get-Content "$BuildDir\CMakeCache.txt" -Raw
    if ($cache -notmatch "APC_ENABLE_VISAGE:BOOL=ON") {
        throw "APC_ENABLE_VISAGE is OFF in CMakeCache.txt. Reconfigure with -DAPC_ENABLE_VISAGE=ON."
    }
}

# 2. Build Standalone
Write-Host "Compiling Standalone..." -ForegroundColor Gray
cmake --build "$BuildDir" --config Release --target "$($PluginName)_Standalone"
if ($LASTEXITCODE -ne 0) { throw "Build Failed" }

# 3. Launch & Monitor
$Exe = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$($PluginName).exe" | Where-Object { $_.FullName -match "Standalone" } | Select-Object -First 1

if ($Exe) {
    Write-Host "Launching..." -ForegroundColor Green
    $p = Start-Process -FilePath $Exe.FullName -PassThru -Wait
    if ($p.ExitCode -ne 0) {
        Write-Warning "CRASH DETECTED. Check Documents/APC_CRASH_REPORT.txt"
    }
} else {
    Write-Error "Standalone EXE not found."
}
