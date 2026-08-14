<#
.SYNOPSIS
    Creates a clean ZIP backup of a plugin.
.DESCRIPTION
    1. Copies source to a temporary area.
    2. Removes garbage (.vs, build artifacts, cache).
    3. Zips the result to _backups/PluginName_vX.X_Date.zip
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$PluginName,
    
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib\Get-ApcPaths.ps1"

# 1. Setup Paths
$ApcPaths = Get-ApcPaths
$RootPath = $ApcPaths.RepoRoot
$SourceDir = Join-Path $ApcPaths.PluginsDir $PluginName
$BackupRoot = Join-Path $RootPath "_backups"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmm"

# Strip 'v' prefix if user typed "v1.0"
$CleanVer = $Version -replace "^v", ""
$ZipName = "${PluginName}_v${CleanVer}_${Timestamp}.zip"
$TargetZip = Join-Path $BackupRoot "$PluginName\$ZipName"

# 2. Validation
if (-not (Test-Path $SourceDir)) {
    Write-Host "Error: Plugin '$PluginName' not found." -ForegroundColor Red
    exit 1
}

# 3. Create Temp Staging Area
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "APC_Backup_$([Guid]::NewGuid())"
$StageDir = Join-Path $TempDir $PluginName
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

Write-Host "--- BACKUP: $PluginName ($Version) ---" -ForegroundColor Cyan
Write-Host "Staging files..." -ForegroundColor Gray

# 4. Smart Copy (Robocopy is faster and handles exclusions better)
# We copy everything, then delete the junk, then zip.
Copy-Item -Path "$SourceDir\*" -Destination $StageDir -Recurse

# 5. Clean the Staging Area (Remove Artifacts)
$Exclusions = @(
    "build",
    "cmake-build-*",
    ".vs",
    "*.user",
    "*.suo",
    "*.ncb",
    "*.db",
    "*.ipch"
)

foreach ($exclude in $Exclusions) {
    Get-ChildItem -Path $StageDir -Recurse -Include $exclude | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# 6. Zip It
if (-not (Test-Path "$BackupRoot\$PluginName")) {
    New-Item -ItemType Directory -Path "$BackupRoot\$PluginName" -Force | Out-Null
}

Write-Host "Compressing to: $TargetZip" -ForegroundColor Yellow
Compress-Archive -Path "$StageDir\*" -DestinationPath $TargetZip -Force

# 7. Cleanup
Remove-Item -Path $TempDir -Recurse -Force

Write-Host "SUCCESS! Backup saved." -ForegroundColor Green