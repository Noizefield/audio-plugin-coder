<#
.SYNOPSIS
    Restores a plugin from a ZIP backup.
.DESCRIPTION
    1. Finds the latest ZIP backup for the specific version.
    2. Wipes the current plugin folder.
    3. Unzips the backup into place.
.PARAMETER PluginName
    Name of the plugin.
.PARAMETER Version
    The version string to search for (e.g. "1.0" or "v1.0").
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$PluginName,
    
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# 1. Setup Paths
. "$PSScriptRoot\lib\Get-ApcPaths.ps1"
$RootPath = (Get-ApcRepoRoot)
$PluginDir = Get-ApcPluginPath -PluginName $PluginName -RepoRoot $RootPath
$BackupRoot = Join-Path $RootPath "_backups\$PluginName"

# Strip 'v' for cleaner matching
$CleanVer = $Version -replace "^v", ""

Write-Host "--- ROLLBACK: $PluginName to v$CleanVer ---" -ForegroundColor Cyan

# 2. Find the Backup Zip
if (-not (Test-Path $BackupRoot)) {
    Write-Error "No backups found for $PluginName."
    exit 1
}

# Find zips matching the version. Sort by Date Descending (Newest first).
$TargetZip = Get-ChildItem -Path $BackupRoot -Filter "*v${CleanVer}*.zip" | 
             Sort-Object LastWriteTime -Descending | 
             Select-Object -First 1

if (-not $TargetZip) {
    Write-Error "Could not find a backup zip for version $CleanVer in $BackupRoot"
    exit 1
}

Write-Host "Found Backup: $($TargetZip.Name)" -ForegroundColor Yellow

# 3. Safety Confirmation (Optional - remove if you want 100% auto)
# Write-Warning "This will DELETE the current source code in: $PluginDir"
# $Confirm = Read-Host "Are you sure? (y/n)"
# if ($Confirm -ne 'y') { exit }

# 4. Perform Rollback
try {
    # Remove current folder if it exists
    if (Test-Path $PluginDir) {
        Write-Host "Clearing current source..." -ForegroundColor Gray
        Remove-Item -Path $PluginDir -Recurse -Force
    }

    # Re-create empty folder
    New-Item -ItemType Directory -Path $PluginDir -Force | Out-Null

    # Unzip
    Write-Host "Restoring from Zip..." -ForegroundColor Gray
    Expand-Archive -Path $TargetZip.FullName -DestinationPath $PluginDir -Force

    # Fix: Expand-Archive creates the folder structure inside. 
    # If the zip contains "PluginName/Source/...", we are good. 
    # If the zip created a nested "PluginName" folder inside "PluginName", move it up.
    if (Test-Path "$PluginDir\$PluginName\Source") {
        Write-Host "Adjusting folder structure..." -ForegroundColor Gray
        Move-Item -Path "$PluginDir\$PluginName\*" -Destination $PluginDir -Force
        Remove-Item -Path "$PluginDir\$PluginName" -Recurse -Force
    }

    Write-Host "SUCCESS! $PluginName rolled back to v$CleanVer" -ForegroundColor Green
}
catch {
    Write-Error "Rollback Failed: $_"
    exit 1
}