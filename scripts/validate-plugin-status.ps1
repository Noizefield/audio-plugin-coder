<#
.SYNOPSIS
    Validate plugin status.json files for schema compliance and accuracy
.DESCRIPTION
    Checks all plugin status.json files against the standardized schema and verifies
    that current_phase and validation flags match the actual files present.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$PluginName
)

$ErrorActionPreference = "Stop"

# Import state management
. "$PSScriptRoot\state-management.ps1"

function Test-PluginStatusAccuracy {
    param($PluginPath, $PluginName)

    Write-Host "Validating $PluginName..." -ForegroundColor Yellow

    $statusPath = Join-Path $PluginPath "status.json"
    if (-not (Test-Path $statusPath)) {
        Write-Host "  ✗ No status.json found" -ForegroundColor Red
        return $false
    }

    try {
        $status = Get-Content $statusPath -Raw | ConvertFrom-Json
    } catch {
        Write-Host "  ✗ Invalid JSON in status.json" -ForegroundColor Red
        return $false
    }

    $issues = @()

    # Check schema compliance
    $requiredFields = @('plugin_name', 'version', 'current_phase', 'ui_framework', 'complexity_score', 'created_at', 'last_modified', 'phase_history', 'validation', 'framework_selection', 'error_recovery')
    foreach ($field in $requiredFields) {
        if (-not $status.PSObject.Properties.Name.Contains($field)) {
            $issues += "Missing required field: $field"
        }
    }

    # Check current_phase accuracy based on files
    $hasIdeas = Test-Path (Join-Path $PluginPath ".ideas")
    $hasDesign = Test-Path (Join-Path $PluginPath "Design")
    $hasSource = Test-Path (Join-Path $PluginPath "Source")

    $expectedPhase = "ideation"
    if ($hasIdeas -and $hasDesign -and $hasSource) {
        $expectedPhase = "code_complete"
    } elseif ($hasIdeas -and $hasDesign) {
        $expectedPhase = "design_complete"
    } elseif ($hasIdeas) {
        $expectedPhase = "plan_complete"
    }

    if ($status.current_phase -ne $expectedPhase) {
        $issues += "Phase mismatch: status shows '$($status.current_phase)', files suggest '$expectedPhase'"
    }

    # Check validation flags
    if ($status.validation.creative_brief_exists -and -not (Test-Path (Join-Path $PluginPath ".ideas\creative-brief.md"))) {
        $issues += "Validation flag creative_brief_exists is true but file missing"
    }
    if ($status.validation.parameter_spec_exists -and -not (Test-Path (Join-Path $PluginPath ".ideas\parameter-spec.md"))) {
        $issues += "Validation flag parameter_spec_exists is true but file missing"
    }
    if ($status.validation.architecture_defined -and -not (Test-Path (Join-Path $PluginPath ".ideas\architecture.md"))) {
        $issues += "Validation flag architecture_defined is true but file missing"
    }

    if ($issues.Count -eq 0) {
        Write-Host "  ✓ Status accurate and schema compliant" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  ✗ Issues found:" -ForegroundColor Red
        foreach ($issue in $issues) {
            Write-Host "    - $issue" -ForegroundColor Red
        }
        return $false
    }
}

# Main execution
Write-Host "=== Plugin Status Validation ===" -ForegroundColor Cyan

. "$PSScriptRoot\lib\Get-ApcPaths.ps1"
$pluginsPath = (Get-ApcPaths).PluginsDir
$allValid = $true

if ($PluginName) {
    $pluginPath = Join-Path $pluginsPath $PluginName
    if (-not (Test-Path $pluginPath)) {
        Write-Error "Plugin '$PluginName' not found"
        exit 1
    }
    $valid = Test-PluginStatusAccuracy -PluginPath $pluginPath -PluginName $PluginName
    if (-not $valid) { $allValid = $false }
} else {
    # Check all plugins
    $pluginDirs = Get-ChildItem $pluginsPath -Directory -ErrorAction SilentlyContinue
    foreach ($dir in $pluginDirs) {
        $valid = Test-PluginStatusAccuracy -PluginPath $dir.FullName -PluginName $dir.Name
        if (-not $valid) { $allValid = $false }
    }
}

if ($allValid) {
    Write-Host "`n=== All plugins validated successfully ===" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n=== Validation found issues ===" -ForegroundColor Red
    Write-Host "Run this script with -PluginName name to fix individual plugins" -ForegroundColor Yellow
    exit 1
}