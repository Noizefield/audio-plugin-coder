<#
.SYNOPSIS
    Validate APC State Management System
.DESCRIPTION
    Tests all state management functions and validates integration with skills.
    RUN AS ADMINISTRATOR RECOMENDED FOR FILE OPERATIONS.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$TestPluginName = "TestPlugin"
)

$ErrorActionPreference = "Stop"

# --- HELPER: Resolve Root Directory ---
# Assumes this script is in /scripts/ or /.kilocode/scripts/
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Write-Host "Repo Root detected at: $RepoRoot" -ForegroundColor Gray

function Test-StateManagementSystem {
    Write-Host "=== APC State Management Validation ===" -ForegroundColor Cyan

    # 1. Test State Management Module Loading
    Write-Host "1. Testing module loading..." -ForegroundColor Yellow
    # Try local folder first, then scripts folder
    $modulePath = Join-Path $PSScriptRoot "state-management.ps1"
    if (-not (Test-Path $modulePath)) {
        # Fallback for standard structure
        $modulePath = Join-Path $RepoRoot "scripts\state-management.ps1"
    }

    if (-not (Test-Path $modulePath)) {
        Write-Error "State management module not found. Searched in:`n$PSScriptRoot`n$RepoRoot\scripts"
        return $false
    }

    try {
        . $modulePath
        Write-Host "✓ Module loaded successfully" -ForegroundColor Green
    } catch {
        Write-Error "Failed to load module: $($_.Exception.Message)"
        return $false
    }

    # 2. Test Template File
    Write-Host "2. Testing template file..." -ForegroundColor Yellow
    # Adjust logic: Look in .kilocode/templates or root/templates
    $templatePath = Join-Path $RepoRoot ".kilocode\templates\status-template.json"
    if (-not (Test-Path $templatePath)) {
        # Fallback
        $templatePath = Join-Path $RepoRoot "templates\status-template.json"
    }

    if (-not (Test-Path $templatePath)) {
        Write-Error "Template file not found at expected locations."
        return $false
    }

    try {
        $jsonContent = Get-Content $templatePath -Raw
        $template = $jsonContent | ConvertFrom-Json
        Write-Host "✓ Template loaded successfully" -ForegroundColor Green
    } catch {
        Write-Error "Failed to load template: $($_.Exception.Message)"
        return $false
    }

    # 3. Test Schema Validation
    Write-Host "3. Testing schema validation..." -ForegroundColor Yellow
    $requiredFields = @(
        'plugin_name', 'version', 'current_phase', 'ui_framework', 
        'complexity_score', 'created_at', 'last_modified', 'phase_history', 
        'validation', 'framework_selection', 'error_recovery'
    )

    # Robust property check for PS 5.1 and PS 7+
    $props = $template.PSObject.Properties.Name
    foreach ($field in $requiredFields) {
        if ($props -notcontains $field) {
            Write-Error "Missing required field: $field"
            return $false
        }
    }
    Write-Host "✓ All required fields present" -ForegroundColor Green

    # 4. Test Function Availability
    Write-Host "4. Testing function availability..." -ForegroundColor Yellow
    $requiredFunctions = @(
        'New-PluginState', 'Update-PluginState', 'Test-PluginState', 
        'Test-StateSchema', 'Backup-PluginState', 'Restore-PluginState',
        'Get-PluginState', 'Add-StateError'
    )

    foreach ($func in $requiredFunctions) {
        if (-not (Get-Command $func -ErrorAction SilentlyContinue)) {
            Write-Error "Function not available: $func"
            return $false
        }
    }
    Write-Host "✓ All functions available" -ForegroundColor Green

    # 5. Test Plugin State Creation
    Write-Host "5. Testing plugin state creation..." -ForegroundColor Yellow
    . (Join-Path $RepoRoot "scripts\lib\Get-ApcPaths.ps1")
    $testPluginPath = Get-ApcPluginPath -PluginName $TestPluginName -RepoRoot $RepoRoot
    
    # Clean previous run
    if (Test-Path $testPluginPath) { 
        Write-Host "  Cleanling old test data..." -ForegroundColor Gray
        Remove-Item $testPluginPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $testPluginPath -Force | Out-Null

    try {
        $state = New-PluginState -PluginName $TestPluginName -PluginPath $testPluginPath
        if (-not $state) {
            Write-Error "Failed to create plugin state (Object is null)"
            return $false
        }
        
        # Verify file actually exists
        if (-not (Test-Path (Join-Path $testPluginPath "status.json"))) {
             Write-Error "status.json was not created on disk."
             return $false
        }

        Write-Host "✓ Plugin state created" -ForegroundColor Green
    } catch {
        Write-Error "Failed to create state: $($_.Exception.Message)"
        return $false
    }

    # 6. Test State Updates
    Write-Host "6. Testing state updates..." -ForegroundColor Yellow
    try {
        # Ensure we pass the path, not the object, to simulate fresh implementation
        $result = Update-PluginState -PluginPath $testPluginPath -Phase "ideation_complete" -Updates @{
            "validation.creative_brief_exists" = $true
            "validation.parameter_spec_exists" = $true
        }
        
        if (-not $result) {
            Write-Error "Update-PluginState returned false/null"
            return $false
        }

        # Verify the update actually stuck
        $check = Get-PluginState -PluginPath $testPluginPath
        if ($check.current_phase -ne "ideation_complete") {
            Write-Error "Phase did not update correctly. Got: $($check.current_phase)"
            return $false
        }

        Write-Host "✓ State updated successfully" -ForegroundColor Green
    } catch {
        Write-Error "Failed to update state: $($_.Exception.Message)"
        return $false
    }

    # 7. Test State Validation
    Write-Host "7. Testing state validation..." -ForegroundColor Yellow
    try {
        $isValid = Test-PluginState -PluginPath $testPluginPath -RequiredPhase "ideation_complete" -RequiredFiles @()
        if (-not $isValid) {
            Write-Error "State validation failed (Should have passed)"
            return $false
        }
        Write-Host "✓ State validation passed" -ForegroundColor Green
    } catch {
        Write-Error "State validation error: $($_.Exception.Message)"
        return $false
    }

    # 8. Test Backup and Restore
    Write-Host "8. Testing backup and restore..." -ForegroundColor Yellow
    try {
        $backupFile = Backup-PluginState -PluginPath $testPluginPath
        if (-not $backupFile -or -not (Test-Path $backupFile)) {
            Write-Error "Backup failed to produce a file"
            return $false
        }
        Write-Host "✓ Backup created: $backupFile" -ForegroundColor Green
        
        # Test restore
        $restoreResult = Restore-PluginState -PluginPath $testPluginPath -BackupFile $backupFile
        if (-not $restoreResult) {
            Write-Error "Restore-PluginState returned false"
            return $false
        }
        Write-Host "✓ Restore successful" -ForegroundColor Green
    } catch {
        Write-Error "Backup/restore error: $($_.Exception.Message)"
        return $false
    }

    # 9. Test Error Recovery
    Write-Host "9. Testing error recovery..." -ForegroundColor Yellow
    try {
        Add-StateError -PluginPath $testPluginPath -ErrorMessage "Test error message"
        $state = Get-PluginState -PluginPath $testPluginPath
        
        # Handle array count safely (works in PS5 and PS7)
        $count = 0
        if ($state.error_recovery.error_log) { $count = $state.error_recovery.error_log.Count }

        if ($count -eq 0) {
            Write-Error "Error not logged in status.json"
            return $false
        }
        Write-Host "✓ Error recovery working" -ForegroundColor Green
    } catch {
        Write-Error "Error recovery test failed: $($_.Exception.Message)"
        return $false
    }

    # 10. Test Framework Selection (The Fork)
    Write-Host "10. Testing framework selection..." -ForegroundColor Yellow
    try {
        $result = Update-PluginState -PluginPath $testPluginPath -Phase "plan_complete" -Framework "visage" -Updates @{
            "complexity_score" = 3
            "framework_selection.rationale" = "Test rationale"
        }
        
        if (-not $result) {
            Write-Error "Framework selection failed"
            return $false
        }
        
        $state = Get-PluginState -PluginPath $testPluginPath
        if ($state.ui_framework -ne "visage") {
            Write-Error "Framework not set correctly. Expected 'visage', got '$($state.ui_framework)'"
            return $false
        }
        Write-Host "✓ Framework selection working" -ForegroundColor Green
    } catch {
        Write-Error "Framework selection error: $($_.Exception.Message)"
        return $false
    }

    # Cleanup (CRITICAL FIX FOR FILE LOCKING)
    Write-Host "11. Cleaning up test files..." -ForegroundColor Yellow
    
    # 1. Nullify variables holding file handles
    $state = $null
    $template = $null
    $check = $null
    
    # 2. Force Garbage Collection
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    
    # 3. Remove
    if (Test-Path $testPluginPath) {
        try {
            Remove-Item $testPluginPath -Recurse -Force -ErrorAction Stop
            Write-Host "✓ Cleanup complete" -ForegroundColor Green
        } catch {
            Write-Warning "Could not fully remove test directory. (File lock persists). Manual cleanup required for: $testPluginPath"
        }
    }

    return $true
}

# Main execution
try {
    $success = Test-StateManagementSystem
    
    if ($success) {
        Write-Host ""
        Write-Host "=== VALIDATION COMPLETE ===" -ForegroundColor Green
        Write-Host "All state management functions are working correctly!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host ""
        Write-Host "=== VALIDATION FAILED ===" -ForegroundColor Red
        Write-Host "Review errors above."
        exit 1
    }
} catch {
    Write-Error "Critical Script Failure: $($_.Exception.Message)"
    exit 1
}