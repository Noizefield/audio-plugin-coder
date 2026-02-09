# Visage Setup Validation Script
# Validates that a plugin has proper Visage configuration

param(
    [Parameter(Mandatory=$true)]
    [string]$PluginName
)

$ErrorActionPreference = "Stop"

$RootPath = (Get-Item "$PSScriptRoot\..").FullName
$PluginPath = "plugins\$PluginName"
$SourcePath = "$PluginPath\Source"
$EditorCpp = "$SourcePath\PluginEditor.cpp"
$EditorH = "$SourcePath\PluginEditor.h"
$ControlsH = "$SourcePath\VisageControls.h"
$CMakeLists = "$PluginPath\CMakeLists.txt"
$RootCMake = "$RootPath\CMakeLists.txt"
$StatusJson = "$PluginPath\status.json"

$Issues = @()
$Warnings = @()

Write-Host "Validating Visage setup for plugin: $PluginName" -ForegroundColor Cyan
Write-Host ("=" * 60)

# Check 1: Plugin directory exists
if (-not (Test-Path $PluginPath)) {
    Write-Host "ERROR: Plugin directory not found: $PluginPath" -ForegroundColor Red
    exit 1
}

# Check 2: status.json exists and framework is Visage
if (-not (Test-Path $StatusJson)) {
    $Warnings += "status.json not found - cannot confirm ui_framework"
} else {
    $state = Get-Content $StatusJson -Raw | ConvertFrom-Json
    if ($state.ui_framework -ne "visage") {
        $Warnings += "ui_framework is '$($state.ui_framework)' (expected 'visage')"
    }
}

# Check 3: Root CMake has Visage option and subdirectory
if (-not (Test-Path $RootCMake)) {
    $Issues += "Root CMakeLists.txt not found"
} else {
    $rootContent = Get-Content $RootCMake -Raw
    if ($rootContent -notmatch "APC_ENABLE_VISAGE") {
        $Issues += "Root CMakeLists.txt missing APC_ENABLE_VISAGE option"
    }
    if ($rootContent -notmatch 'add_subdirectory\("\$\{VISAGE_DIR\}"\)') {
        $Warnings += "Root CMakeLists.txt does not add Visage subdirectory (APC_ENABLE_VISAGE may be OFF)"
    }
    if ($rootContent -notmatch "visage::visage") {
        $Warnings += "Root CMakeLists.txt does not create visage::visage alias target"
    }
}

# Check 4: Plugin CMakeLists.txt exists and links Visage
if (-not (Test-Path $CMakeLists)) {
    $Issues += "CMakeLists.txt not found"
} else {
    $cmakeContent = Get-Content $CMakeLists -Raw
    if ($cmakeContent -notmatch "visage::visage") {
        $Issues += "CMakeLists.txt missing 'visage::visage' link"
    }
    if ($cmakeContent -match "NEEDS_WEBVIEW2\\s+TRUE|JUCE_WEB_BROWSER=1|juce::juce_gui_extra") {
        $Warnings += "CMakeLists.txt contains WebView-specific flags/modules"
    }
}

# Check 5: VisageControls.h exists
if (-not (Test-Path $ControlsH)) {
    $Issues += "VisageControls.h not found"
}

# Check 6: PluginEditor includes Visage host
if (-not (Test-Path $EditorH)) {
    $Warnings += "PluginEditor.h not found"
} else {
    $hContent = Get-Content $EditorH -Raw
    if ($hContent -notmatch "VisageJuceHost") {
        $Warnings += "PluginEditor.h does not include VisageJuceHost.h"
    }
    if ($hContent -notmatch "VisagePluginEditor") {
        $Warnings += "PluginEditor.h does not inherit from VisagePluginEditor"
    }
}

if (-not (Test-Path $EditorCpp)) {
    $Warnings += "PluginEditor.cpp not found"
}

# Report results
Write-Host ""
if ($Issues.Count -eq 0 -and $Warnings.Count -eq 0) {
    Write-Host "All checks passed! Visage setup looks correct." -ForegroundColor Green
    exit 0
}

if ($Issues.Count -gt 0) {
    Write-Host "CRITICAL ISSUES FOUND:" -ForegroundColor Red
    foreach ($issue in $Issues) {
        Write-Host "  [X] $issue" -ForegroundColor Red
    }
}

if ($Warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNINGS:" -ForegroundColor Yellow
    foreach ($warning in $Warnings) {
        Write-Host "  [!] $warning" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Validation Summary:" -ForegroundColor Cyan
$issueColor = if ($Issues.Count -gt 0) { "Red" } else { "Green" }
$warningColor = if ($Warnings.Count -gt 0) { "Yellow" } else { "Green" }
Write-Host "  Issues: $($Issues.Count)" -ForegroundColor $issueColor
Write-Host "  Warnings: $($Warnings.Count)" -ForegroundColor $warningColor

if ($Issues.Count -gt 0) {
    Write-Host ""
    Write-Host "See templates in .claude/templates/visage/ for correct implementation" -ForegroundColor Cyan
    exit 1
}

exit 0
