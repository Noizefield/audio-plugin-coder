<#
.SYNOPSIS
    Creates Windows installer for APC plugins using Inno Setup

.DESCRIPTION
    This script generates a Windows installer (.exe) from the Inno Setup template.
    It replaces placeholders in the template with actual plugin information.

.PARAMETER PluginName
    Name of the plugin (must match folder name in plugins/)

.PARAMETER Version
    Version number (e.g., "1.0.0")

.PARAMETER CompanyName
    Company name (default: "APC")

.PARAMETER PluginURL
    Plugin website URL (default: "https://github.com/noizefield/audio-plugin-coder")

.EXAMPLE
    .\create-windows-installer.ps1 -PluginName "CloudWash" -Version "1.0.0"

.EXAMPLE
    .\create-windows-installer.ps1 -PluginName "CloudWash" -Version "1.0.0" -CompanyName "MyCompany"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PluginName,
    [Parameter(Mandatory=$true)][string]$Version,
    [string]$CompanyName = "APC",
    [string]$PluginURL = "https://github.com/noizefield/audio-plugin-coder"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Creating Windows Installer" -ForegroundColor Cyan
Write-Host "  Plugin: $PluginName" -ForegroundColor Cyan
Write-Host "  Version: $Version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# CHECK PREREQUISITES
# ============================================

# Check for Inno Setup
$InnoPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $InnoPath)) {
    Write-Error "Inno Setup not found at: $InnoPath"
    Write-Host "Please download and install Inno Setup from: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Inno Setup found" -ForegroundColor Green

# Check for build artifacts
$BuildDir = "build"
$Vst3Path = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$PluginName.vst3" -ErrorAction SilentlyContinue | Select-Object -First 1
$StandalonePath = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$PluginName.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $Vst3Path) {
    Write-Error "VST3 build not found. Please build the plugin first."
    Write-Host "Run: .\scripts\build-and-install.ps1 -PluginName $PluginName" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Build artifacts found" -ForegroundColor Green
Write-Host "  VST3: $($Vst3Path.FullName)" -ForegroundColor Gray
if ($StandalonePath) {
    Write-Host "  Standalone: $($StandalonePath.FullName)" -ForegroundColor Gray
}

# Check for icon file
$IconPath = "plugins\$PluginName\Assets\icon.ico"
if (-not (Test-Path $IconPath)) {
    Write-Warning "Icon file not found at: $IconPath"
    Write-Host "The installer will use the default Inno Setup icon." -ForegroundColor Yellow
    Write-Host "To add a custom icon, place an icon.ico file in plugins\$PluginName\Assets" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Icon file found" -ForegroundColor Green
    Write-Host "  Icon: $IconPath" -ForegroundColor Gray
}

# ============================================
# CREATE LICENSE FILE
# ============================================

$LicensePath = "dist\LICENSE.txt"
if (-not (Test-Path $LicensePath)) {
    Write-Host "Creating license file..." -ForegroundColor Yellow
    
    $CurrentYear = Get-Date -Format "yyyy"
    $LicenseContent = "================================================================================`n" +
        "                    $PluginName END USER LICENSE AGREEMENT`n" +
        "================================================================================`n" +
        "`n" +
        "IMPORTANT: PLEASE READ THIS LICENSE CAREFULLY BEFORE USING THIS SOFTWARE.`n" +
        "`n" +
        "1. GRANT OF LICENSE`n" +
        "   This software is licensed, not sold. By installing or using this software,`n" +
        "   you agree to be bound by the terms of this agreement.`n" +
        "`n" +
        "2. PERMITTED USE`n" +
        "   - You may install and use this software on multiple computers`n" +
        "   - You may use this software for commercial and non-commercial purposes`n" +
        "   - You may create and distribute audio content using this software`n" +
        "`n" +
        "3. RESTRICTIONS`n" +
        "   - You may not reverse engineer, decompile, or disassemble this software`n" +
        "   - You may not redistribute or resell this software`n" +
        "   - You may not remove or alter any copyright notices`n" +
        "`n" +
        "4. DISCLAIMER OF WARRANTY`n" +
        "   THIS SOFTWARE IS PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND.`n" +
        "`n" +
        "5. LIMITATION OF LIABILITY`n" +
        "   IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY DAMAGES ARISING FROM`n" +
        "   THE USE OF THIS SOFTWARE.`n" +
        "`n" +
        "================================================================================`n" +
        "By installing this software, you acknowledge that you have read, understood,`n" +
        "and agree to be bound by these terms.`n" +
        "`n" +
        "Copyright (c) $CurrentYear $CompanyName`n" +
        "================================================================================"
    
    New-Item -ItemType Directory -Path "dist" -Force | Out-Null
    Set-Content -Path $LicensePath -Value $LicenseContent
    Write-Host "License file created: $LicensePath" -ForegroundColor Green
}

# ============================================
# GENERATE INSTALLER SCRIPT
# ============================================

Write-Host "Generating installer script..." -ForegroundColor Yellow

$TemplatePath = "scripts\installer\installer-template.iss"
if (-not (Test-Path $TemplatePath)) {
    Write-Error "Installer template not found: $TemplatePath"
    exit 1
}

$Template = Get-Content $TemplatePath -Raw

# Get absolute path to icon file
$IconAbsolutePath = (Resolve-Path $IconPath).Path

# Replace placeholders
$IssContent = $Template `
    -replace '{#PluginName}', $PluginName `
    -replace '{#PluginVersion}', $Version `
    -replace '{#CompanyName}', $CompanyName `
    -replace '{#PluginURL}', $PluginURL `
    -replace '{#IconPath}', $IconAbsolutePath

# Create build directory for installer
$InstallerBuildDir = "build\installer"
New-Item -ItemType Directory -Path $InstallerBuildDir -Force | Out-Null

$IssPath = "$InstallerBuildDir\$PluginName-$Version.iss"
Set-Content -Path $IssPath -Value $IssContent

Write-Host "Installer script generated: $IssPath" -ForegroundColor Green

# ============================================
# COMPILE INSTALLER
# ============================================

Write-Host "Compiling installer..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray

try {
    & $InnoPath $IssPath 2>&1 | ForEach-Object {
        if ($_ -match "Error") {
            Write-Host $_ -ForegroundColor Red
        } elseif ($_ -match "Warning") {
            Write-Host $_ -ForegroundColor Yellow
        } else {
            Write-Host $_ -ForegroundColor Gray
        }
    }
    
    $ExitCode = $LASTEXITCODE
    if ($ExitCode -ne 0) {
        throw "Inno Setup compilation failed with exit code $ExitCode"
    }
    
    Write-Host "Installer compiled successfully!" -ForegroundColor Green
} catch {
    Write-Error "Failed to compile installer: $_"
    exit 1
}

# ============================================
# VERIFY OUTPUT
# ============================================

$InstallerPath = "dist\$PluginName-$Version-Windows-Setup.exe"
if (Test-Path $InstallerPath) {
    $FileInfo = Get-Item $InstallerPath
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Installer Created Successfully!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  File: $InstallerPath" -ForegroundColor Yellow
    Write-Host "  Size: $([math]::Round($FileInfo.Length / 1MB, 2)) MB" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Green
    
    # Return path for automation
    return $InstallerPath
} else {
    Write-Error "Installer file not found at expected location: $InstallerPath"
    exit 1
}
