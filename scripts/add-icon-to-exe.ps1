# Add icon to Windows executable using rcedit
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [Parameter(Mandatory=$true)][string]$IconPath
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Adding Icon to Executable" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check if files exist
if (-not (Test-Path $ExePath)) {
    Write-Error "Executable not found: $ExePath"
    exit 1
}

if (-not (Test-Path $IconPath)) {
    Write-Error "Icon file not found: $IconPath"
    exit 1
}

Write-Host "  EXE: $ExePath" -ForegroundColor Gray
Write-Host "  Icon: $IconPath" -ForegroundColor Gray
Write-Host ""

# Download rcedit if not present
$RceditPath = "scripts\rcedit-x64.exe"
if (-not (Test-Path $RceditPath)) {
    Write-Host "Downloading rcedit..." -ForegroundColor Yellow

    $RceditUrl = "https://github.com/electron/rcedit/releases/download/v1.1.1/rcedit-x64.exe"

    try {
        New-Item -ItemType Directory -Path "scripts" -Force | Out-Null
        Invoke-WebRequest -Uri $RceditUrl -OutFile $RceditPath -UseBasicParsing
        Write-Host "rcedit downloaded successfully" -ForegroundColor Green
    } catch {
        Write-Error "Failed to download rcedit: $_"
        exit 1
    }
}

# Add icon to exe
Write-Host "Adding icon to executable..." -ForegroundColor Yellow

try {
    & $RceditPath $ExePath --set-icon $IconPath

    if ($LASTEXITCODE -ne 0) {
        throw "rcedit failed with exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Icon Added Successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} catch {
    Write-Error "Failed to add icon: $_"
    exit 1
}
