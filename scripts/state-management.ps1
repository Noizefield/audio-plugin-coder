<#
.SYNOPSIS
    APC State Management Module
.DESCRIPTION
    Provides standardized state management for APC plugin development workflow
#>

# --- PATH RESOLUTION ---
# Establish the root so we can find templates reliably
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

# Expose Get-ApcPaths / Get-ApcPluginPath so workflows can resolve custom plugins_dir
$apcPathsLib = Join-Path $PSScriptRoot "lib\Get-ApcPaths.ps1"
if (Test-Path $apcPathsLib) {
    . $apcPathsLib
}

$Script:StateSchema = @{
    required = @(
        'plugin_name', 'version', 'current_phase', 'ui_framework', 
        'complexity_score', 'created_at', 'last_modified', 'phase_history', 
        'validation', 'framework_selection', 'error_recovery'
    )
    phases = @('ideation', 'plan', 'design', 'code', 'ship', 'complete')
    frameworks = @('visage', 'webview', 'pending')
    validation_fields = @(
        'creative_brief_exists', 'parameter_spec_exists', 'architecture_defined',
        'ui_framework_selected', 'design_complete', 'code_complete', 
        'tests_passed', 'ship_ready'
    )
}

function New-PluginState {
<#
.SYNOPSIS
    Initialize a new plugin state from template
#>
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginName,
        
        [Parameter(Mandatory=$true)]
        [string]$PluginPath
    )
    
    # Try multiple locations for the template
    $templatePaths = @(
        (Join-Path $RepoRoot ".kilocode\templates\status-template.json"),
        (Join-Path $RepoRoot "templates\status-template.json"),
        (Join-Path $PSScriptRoot "..\templates\status-template.json")
    )

    $templatePath = $null
    foreach ($path in $templatePaths) {
        if (Test-Path $path) { $templatePath = $path; break }
    }

    if (-not $templatePath) {
        Write-Warning "Status template not found. Checked: $($templatePaths -join ', ')"
        return $null
    }
    
    $template = Get-Content $templatePath -Raw | ConvertFrom-Json
    $template.plugin_name = $PluginName
    $template.created_at = (Get-Date).ToString("o")
    $template.last_modified = (Get-Date).ToString("o")
    
    # Ensure phase_history is an array (PowerShell JSON quirk fix)
    if (-not $template.phase_history) { $template.phase_history = @() }

    $statusPath = Join-Path $PluginPath "status.json"
    $template | ConvertTo-Json -Depth 10 | Set-Content $statusPath -Encoding UTF8

    Write-Host "Initialized state for $PluginName" -ForegroundColor Green
    return $template
}

function Update-PluginState {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath,
        [hashtable]$Updates,
        [string]$Phase,
        [string]$Framework
    )
    
    $statusPath = Join-Path $PluginPath "status.json"
    if (-not (Test-Path $statusPath)) {
        Write-Warning "Status file not found at $statusPath"
        return $false
    }
    
    $state = Get-Content $statusPath -Raw | ConvertFrom-Json
    
    # Apply updates (Fixed for nested objects)
    foreach ($key in $Updates.Keys) {
        if ($key -match '\.') {
            # Handle dot notation (e.g. "validation.build_completed")
            $parts = $key -split '\.'
            $root = $parts[0]
            $child = $parts[1]
            
            if ($state.PSObject.Properties.Name -contains $root) {
                # Ensure the child property exists before setting it
                if (-not ($state.$root.PSObject.Properties.Name -contains $child)) {
                    # Add the property if it doesn't exist
                    try {
                        $state.$root | Add-Member -MemberType NoteProperty -Name $child -Value $null -Force -ErrorAction Stop
                    } catch {
                        # If Add-Member fails, try creating a hashtable and converting back
                        $hash = @{}
                        foreach ($prop in $state.$root.PSObject.Properties) {
                            $hash[$prop.Name] = $prop.Value
                        }
                        $hash[$child] = $null
                        $state.$root = [PSCustomObject]$hash
                    }
                }
                $state.$root.$child = $Updates[$key]
            } else {
                Write-Warning "Root property '$root' not found in state. Available properties: $($state.PSObject.Properties.Name -join ', ')"
            }
        } else {
            # Handle root property
            if ($state.PSObject.Properties.Name -contains $key) {
                $state.$key = $Updates[$key]
            } else {
                Write-Warning "Property '$key' not found in state. Available properties: $($state.PSObject.Properties.Name -join ', ')"
            }
        }
    }
    
    # Update phase if specified
    if ($Phase -and $Script:StateSchema.phases -contains $Phase) {
        $state.current_phase = $Phase
        $state.last_modified = (Get-Date).ToString("o")
        
        # Add to phase history
        $phaseEntry = [PSCustomObject]@{
            phase = $Phase
            completed_at = (Get-Date).ToString("o")
            framework_selected = if ($Framework) { $Framework } else { $state.ui_framework }
        }
        # Force array type to avoid "+= on singular object" issues
        if (-not $state.phase_history) { $state.phase_history = @() }
        if ($state.phase_history -isnot [Array]) { $state.phase_history = @($state.phase_history) }
        $state.phase_history += $phaseEntry
    }
    
    # Update framework if specified
    if ($Framework -and $Script:StateSchema.frameworks -contains $Framework) {
        $state.ui_framework = $Framework
        $state.framework_selection.decision = $Framework
        $state.last_modified = (Get-Date).ToString("o")
    }
    
    # Validate and save
    if (Test-StateSchema -State $state) {
        $state | ConvertTo-Json -Depth 10 | Set-Content $statusPath -Encoding UTF8
        Write-Host "Updated state: $Phase ($Framework)" -ForegroundColor Green
        return $true
    }

    else {
        Write-Warning "State validation failed during update."
        return $false
    }
}

function Test-PluginState {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath,
        
        [Parameter(Mandatory=$false)]
        [string]$RequiredPhase,
        
        [Parameter(Mandatory=$false)]
        [string[]]$RequiredFiles = @()
    )
    
    $statusPath = Join-Path $PluginPath "status.json"
    if (-not (Test-Path $statusPath)) {
        Write-Warning "Status file not found"
        return $false
    }
    
    $state = Get-Content $statusPath -Raw | ConvertFrom-Json
    
    # Check schema validation
    if (-not (Test-StateSchema -State $state)) {
        Write-Warning "State schema validation failed"
        return $false
    }
    
    # Check required phase
    if ($RequiredPhase) {
        $phaseIndex = [array]::IndexOf($Script:StateSchema.phases, $RequiredPhase)
        $currentPhaseIndex = [array]::IndexOf($Script:StateSchema.phases, $state.current_phase)
        
        if ($currentPhaseIndex -lt $phaseIndex) {
            Write-Warning "Cannot proceed: Current phase '$($state.current_phase)' must complete '$RequiredPhase' first"
            return $false
        }
    }
    
    # Check required files
    foreach ($file in $RequiredFiles) {
        $fullPath = Join-Path $PluginPath $file
        if (-not (Test-Path $fullPath)) {
            Write-Warning "Required file missing: $file"
            return $false
        }
    }
    
    return $true
}

function Test-StateSchema {
    param(
        [Parameter(Mandatory=$true)]
        [object]$State
    )
    
    # Check required fields
    $props = $State.PSObject.Properties.Name
    foreach ($field in $Script:StateSchema.required) {
        if ($props -notcontains $field) {
            Write-Warning "Missing required field: $field"
            return $false
        }
    }
    
    # Check phase validity
    if ($Script:StateSchema.phases -notcontains $State.current_phase) {
        Write-Warning "Invalid phase: $($State.current_phase)"
        return $false
    }
    
    # Check framework validity
    if ($Script:StateSchema.frameworks -notcontains $State.ui_framework) {
        Write-Warning "Invalid framework: $($State.ui_framework)"
        return $false
    }
    
    # Check validation fields
    $valProps = $State.validation.PSObject.Properties.Name
    foreach ($field in $Script:StateSchema.validation_fields) {
        if ($valProps -notcontains $field) {
            Write-Warning "Missing validation field: $field"
            return $false
        }
    }
    
    return $true
}

function Backup-PluginState {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath
    )

    $statusPath = Join-Path $PluginPath "status.json"
    if (-not (Test-Path $statusPath)) { return $false }
    
    $backupDir = Join-Path $PluginPath "_state_backups"
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFile = Join-Path $backupDir "status_backup_$timestamp.json"
    
    Copy-Item $statusPath $backupFile
    Write-Host "State backed up to $backupFile" -ForegroundColor Yellow
    
    # Update error recovery info
    $state = Get-Content $statusPath -Raw | ConvertFrom-Json
    $state.error_recovery.last_backup = $backupFile
    $state.error_recovery.rollback_available = $true
    $state | ConvertTo-Json -Depth 10 | Set-Content $statusPath -Encoding UTF8
    
    return $backupFile
}

function Restore-PluginState {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath,
        
        [Parameter(Mandatory=$false)]
        [string]$BackupFile
    )

    if (-not $Updates) { $Updates = @{} }

    $statusPath = Join-Path $PluginPath "status.json"
    $backupDir = Join-Path $PluginPath "_state_backups"
    
    if (-not (Test-Path $backupDir)) {
        Write-Warning "No backup directory found"
        return $false
    }
    
    if ($BackupFile -and (Test-Path $BackupFile)) {
        $source = $BackupFile
    } else {
        # Get latest backup
        $latest = Get-ChildItem -Path $backupDir -Filter "status_backup_*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $latest) {
            Write-Warning "No backup files found"
            return $false
        }
        $source = $latest.FullName
    }
    
    Write-Host "Restoring state from $source" -ForegroundColor Yellow
    Copy-Item $source $statusPath -Force

    # Update error recovery info
    $state = Get-Content $statusPath -Raw | ConvertFrom-Json
    $state.error_recovery.rollback_available = $false
    # Fix array append
    if (-not $state.error_recovery.error_log) { $state.error_recovery.error_log = @() }
    if ($state.error_recovery.error_log -isnot [Array]) { $state.error_recovery.error_log = @($state.error_recovery.error_log) }

    $state.error_recovery.error_log += "Rollback performed from $source at $(Get-Date -Format 'o')"

    $state | ConvertTo-Json -Depth 10 | Set-Content $statusPath -Encoding UTF8

    Write-Host "State restored" -ForegroundColor Green
    return $true
}

function Get-PluginState {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath
    )
    
    $statusPath = Join-Path $PluginPath "status.json"
    if (-not (Test-Path $statusPath)) { return $null }
    
    return Get-Content $statusPath -Raw | ConvertFrom-Json
}

function Add-StateError {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath,
        
        [Parameter(Mandatory=$true)]
        [string]$ErrorMessage
    )
    
    $statusPath = Join-Path $PluginPath "status.json"
    if (-not (Test-Path $statusPath)) { return }
    
    $state = Get-Content $statusPath -Raw | ConvertFrom-Json
    
    if (-not $state.error_recovery.error_log) { $state.error_recovery.error_log = @() }
    if ($state.error_recovery.error_log -isnot [Array]) { $state.error_recovery.error_log = @($state.error_recovery.error_log) }
    
    $state.error_recovery.error_log += "$([DateTime]::Now.ToString('o')): $ErrorMessage"
    $state | ConvertTo-Json -Depth 10 | Set-Content $statusPath -Encoding UTF8
}

function Set-PluginFramework {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath,
        
        [Parameter(Mandatory=$true)]
        [ValidateSet("visage","webview")]
        [string]$Framework,
        
        [Parameter(Mandatory=$true)]
        [string]$Rationale
    )
    
    # Validate framework selection prerequisites
    if (-not (Test-PluginState -PluginPath $PluginPath -RequiredPhase "plan_complete")) {
        Write-Error "Cannot set framework - planning phase not complete (Check status.json)"
        return $false
    }
    
    # Update state with framework selection (Using dot notation supported by Update-PluginState)
    $updates = @{
        "ui_framework" = $Framework
        "framework_selection.decision" = $Framework
        "framework_selection.rationale" = $Rationale
        "framework_selection.implementation_strategy" = "single-pass"
    }
    
    if (Update-PluginState -PluginPath $PluginPath -Updates $updates) {
        Write-Host "Framework set to $Framework" -ForegroundColor Green
        return $true
    } else {
        Write-Warning "Failed to set framework"
        return $false
    }
}

function Test-CanvasImplementation {
<#
.SYNOPSIS
    Validate that WebView implementation uses canvas-based rendering
#>
    param(
        [Parameter(Mandatory=$true)]
        [string]$PluginPath
    )
    
    $indexPath = Join-Path $PluginPath "Design\index.html"
    if (-not (Test-Path $indexPath)) {
        Write-Warning "WebView index.html not found"
        return $false
    }
    
    # CRITICAL FIX: Use -Raw for multi-line regex matching
    $htmlContent = Get-Content $indexPath -Raw
    
        
    # Check for canvas-based implementation requirements
    $hasCanvas = $htmlContent -match 'canvas'
    
    # FIX: Double the single quotes ('') to escape them correctly in PowerShell
    $hasCanvasContext = $htmlContent -match 'getContext\(["'']2d["'']\)'
    
    $hasCanvasDrawing = $htmlContent -match 'fillRect|strokeRect|arc|beginPath|fill|stroke'
    $hasJUCEFrontend = $htmlContent -match 'juce|frontend'
    
    if (-not $hasCanvas) {
        Write-Warning "Missing canvas element in WebView implementation"
        return $false
    }
    
    if (-not $hasCanvasContext) {
        Write-Warning "Missing canvas 2D context initialization"
        return $false
    }
    
    if (-not $hasCanvasDrawing) {
        Write-Warning "Missing canvas drawing operations fillRect, arc, etc"
        return $false
    }
    
    if (-not $hasJUCEFrontend) {
        Write-Warning "Missing JUCE frontend library integration"
        return $false
    }
    
    Write-Host "Canvas implementation validated" -ForegroundColor Green
    return $true

  
}