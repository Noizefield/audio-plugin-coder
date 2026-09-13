# APC State Management Guide

## Overview

The APC State Management System provides standardized state tracking and validation for the entire plugin development workflow. This system ensures consistency, enables error recovery, and prevents phase progression without proper prerequisites.

## Core Components

### 1. State Schema (`status.json`)

All plugins use a standardized state schema with these core sections:

```json
{
  "plugin_name": "string",
  "version": "string",
  "current_phase": "ideation|plan|design|code|ship|complete",
  "ui_framework": "visage|webview|pending",
  "complexity_score": 1-5,
  "created_at": "ISO date",
  "last_modified": "ISO date",
  "phase_history": [
    {
      "phase": "string",
      "completed_at": "ISO date",
      "framework_selected": "string|null"
    }
  ],
  "validation": {
    "creative_brief_exists": boolean,
    "parameter_spec_exists": boolean,
    "architecture_defined": boolean,
    "ui_framework_selected": boolean,
    "design_complete": boolean,
    "code_complete": boolean,
    "tests_passed": boolean,
    "ship_ready": boolean
  },
  "framework_selection": {
    "decision": "visage|webview|pending",
    "rationale": "string",
    "implementation_strategy": "single-pass|phased|pending"
  },
  "error_recovery": {
    "last_backup": "string|null",
    "rollback_available": boolean,
    "error_log": ["string"]
  }
}
```

### 2. State Management Module (`scripts/state-management.ps1`)

PowerShell module providing these core functions:

- **`New-PluginState`** - Initialize new plugin state
- **`Update-PluginState`** - Update state with validation
- **`Test-PluginState`** - Validate current state and prerequisites
- **`Backup-PluginState`** - Create state backup
- **`Restore-PluginState`** - Rollback to previous state
- **`Get-PluginState`** - Get current state object
- **`Add-StateError`** - Log errors to state

## Usage Patterns

### Phase Initialization

Each phase should start with state validation:

```powershell
# Import state management
. "$PSScriptRoot\..\scripts\state-management.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName

# Validate prerequisites
if (-not (Test-PluginState -PluginPath $PluginPath -RequiredPhase "previous_phase" -RequiredFiles @("file1.md", "file2.md"))) {
    Write-Error "Prerequisites not met"
    exit 1
}
```

### Phase Completion

Each phase should update state when complete:

```powershell
# Update state with phase completion
Update-PluginState -PluginPath $PluginPath -Phase "current_phase_complete" -Updates @{
  "validation.specific_check" = $true
  "framework_selection.decision" = "visage"
}
```

### Error Recovery

Always backup state before major operations:

```powershell
# Backup before risky operations
Backup-PluginState -PluginPath $PluginPath

# If operation fails, restore
if ($operationFailed) {
    Restore-PluginState -PluginPath $PluginPath
}
```

## Phase-Specific Patterns

### Ideation Phase
- Initialize state with `New-PluginState`
- Set validation flags for creative brief and parameter spec
- Mark phase as `ideation_complete`

### Planning Phase
- Validate ideation completion
- Set framework selection and complexity score
- Update implementation strategy
- Mark phase as `plan_complete`

### Design Phase
- Validate planning completion and framework selection
- Framework-specific file creation
- Mark phase as `design_complete`

### Implementation Phase
- Validate design completion
- Framework-specific implementation
- Mark phase as `code_complete`

### Packaging Phase
- Validate implementation completion
- Final state update with version
- Mark phase as `ship_complete`

## Error Handling

### Validation Errors
- State schema validation fails
- Missing required files
- Invalid phase progression

### Recovery Actions
- Automatic state backup before operations
- Rollback on failure
- Error logging for debugging

### Best Practices
- Always validate before proceeding
- Backup state before major changes
- Use descriptive error messages
- Log all state changes

## Integration with Skills

All skill files have been updated to use the state management system:

- **skill_ideation.md** - Uses `New-PluginState` and `Update-PluginState`
- **skill_planning.md** - Validates prerequisites and updates framework selection
- **skill_design.md** - Checks framework selection before proceeding
- **skill_implementation.md** - Validates design completion and framework
- **skill_packaging.md** - Final validation and state completion

## Troubleshooting

### Common Issues

1. **"Prerequisites not met"**
   - Check that previous phase completed successfully
   - Verify required files exist
   - Check state.json for correct phase

2. **"State validation failed"**
   - Check schema compliance
   - Verify required fields are present
   - Check data types and values

3. **"Framework not selected"**
   - Complete planning phase first
   - Check framework_selection.decision field
   - Verify UI framework is set

### Recovery Steps

1. **Check current state:**
   ```powershell
   $state = Get-PluginState -PluginPath $PluginPath
   $state | ConvertTo-Json -Depth 5
   ```

2. **View error log:**
   ```powershell
   $state.error_recovery.error_log
   ```

3. **Restore from backup:**
   ```powershell
   Restore-PluginState -PluginPath $PluginPath
   ```

4. **Manual state fix:**
   ```powershell
   Update-PluginState -PluginPath $PluginPath -Phase "correct_phase"
   ```

## Future Enhancements

- Automated state migration for schema changes
- State comparison for change detection
- Integration with CI/CD pipelines
- State export/import for collaboration