# State Management Deep Dive

This guide provides comprehensive documentation of the APC State Management System, which tracks plugin development progress across all phases.

## Overview

The State Management System ensures:
- **Phase Validation** - Prevents skipping phases
- **Progress Tracking** - Know where you are at any time
- **Error Recovery** - Rollback capabilities
- **Framework Selection** - Track UI framework choice
- **Multi-Agent Support** - Switch AI agents without losing context

---

## Core Concepts

### State Schema

Every plugin has a `status.json` file with this structure:

```json
{
  "plugin_name": "PluginName",
  "version": "v0.0.0",
  "current_phase": "ideation",
  "ui_framework": "pending",
  "complexity_score": 0,
  "created_at": "2026-01-01T00:00:00Z",
  "last_modified": "2026-01-01T00:00:00Z",
  "phase_history": [],
  "validation": {
    "creative_brief_exists": false,
    "parameter_spec_exists": false,
    "architecture_defined": false,
    "ui_framework_selected": false,
    "design_complete": false,
    "code_complete": false,
    "tests_passed": false,
    "ship_ready": false
  },
  "framework_selection": {
    "decision": "pending",
    "rationale": "",
    "implementation_strategy": "pending"
  },
  "error_recovery": {
    "last_backup": null,
    "rollback_available": false,
    "error_log": []
  }
}
```

### Phase Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  ideation   │────▶│    plan     │────▶│   design    │
│   (DREAM)   │     │   (PLAN)    │     │  (DESIGN)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
┌─────────────┐     ┌─────────────┐           │
│   ship      │◀────│    code     │◀──────────┘
│  (SHIP)     │     │    (IMPL)   │
└──────┬──────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│   complete  │
└─────────────┘
```

---

## PowerShell Functions

The [`state-management.ps1`](scripts/state-management.ps1) script provides these functions:

### New-PluginState

Initialize a new plugin state file.

```powershell
New-PluginState -PluginName "MyPlugin" -PluginPath "plugins\MyPlugin"
```

**Creates:**
- `status.json` with default values
- Sets `current_phase` to "ideation"
- Initializes all validation flags to `false`

### Get-PluginState

Retrieve the current state object.

```powershell
$state = Get-PluginState -PluginPath "plugins\MyPlugin"
Write-Host "Current phase: $($state.current_phase)"
Write-Host "UI Framework: $($state.ui_framework)"
```

### Update-PluginState

Update specific fields in the state.

```powershell
Update-PluginState -PluginPath "plugins\MyPlugin" -Updates @{
    "current_phase" = "plan"
    "validation.architecture_defined" = $true
    "ui_framework" = "webview"
}
```

**Features:**
- Automatic timestamp update
- Schema validation
- Nested property support (dot notation)

### Test-PluginState

Validate prerequisites before proceeding.

```powershell
if (-not (Test-PluginState -PluginPath "plugins\MyPlugin" `
    -RequiredPhase "plan_complete" `
    -RequiredFiles @(".ideas/architecture.md", ".ideas/plan.md"))) {
    Write-Error "Prerequisites not met"
    exit 1
}
```

**Checks:**
- Phase is at or beyond required phase
- Required files exist
- Framework is selected (if applicable)

### Complete-Phase

Mark a phase as complete and update state.

```powershell
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "plan" -Updates @{
    "validation.architecture_defined" = $true
    "validation.ui_framework_selected" = $true
    "framework_selection.decision" = "webview"
    "complexity_score" = 3
}
```

**Actions:**
- Updates `current_phase` to "[phase]_complete"
- Adds entry to `phase_history`
- Applies all update values
- Updates `last_modified` timestamp

### Backup-PluginState

Create a backup before risky operations.

```powershell
Backup-PluginState -PluginPath "plugins\MyPlugin"
```

**Creates:** `status.json.backup.[timestamp]`

### Restore-PluginState

Rollback to previous state.

```powershell
Restore-PluginState -PluginPath "plugins\MyPlugin"
```

**Restores:** Most recent backup file

---

## Phase-Specific Usage

### Phase 1: Ideation

**Initialize state:**
```powershell
New-PluginState -PluginName "MyPlugin" -PluginPath "plugins\MyPlugin"
```

**Complete phase:**
```powershell
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "ideation" -Updates @{
    "validation.creative_brief_exists" = $true
    "validation.parameter_spec_exists" = $true
}
```

**State after:**
```json
{
  "current_phase": "ideation_complete",
  "validation": {
    "creative_brief_exists": true,
    "parameter_spec_exists": true
  },
  "phase_history": [
    {
      "phase": "ideation_complete",
      "completed_at": "2026-01-01T00:00:00Z",
      "framework_selected": null
    }
  ]
}
```

### Phase 2: Planning

**Validate prerequisites:**
```powershell
if (-not (Test-PluginState -PluginPath "plugins\MyPlugin" `
    -RequiredPhase "ideation_complete" `
    -RequiredFiles @(".ideas/creative-brief.md", ".ideas/parameter-spec.md"))) {
    exit 1
}
```

**Set framework selection:**
```powershell
# Helper function for framework selection
Set-PluginFramework -PluginPath "plugins\MyPlugin" `
    -Framework "webview" `
    -Rationale "Complex UI with real-time visualization requires WebView capabilities"
```

**Complete phase:**
```powershell
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "plan" -Updates @{
    "validation.architecture_defined" = $true
    "validation.ui_framework_selected" = $true
    "complexity_score" = 3
    "framework_selection.implementation_strategy" = "phased"
}
```

### Phase 3: Design

**Validate framework selection:**
```powershell
$state = Get-PluginState -PluginPath "plugins\MyPlugin"
if ($state.ui_framework -eq "pending") {
    Write-Error "UI framework not selected. Complete planning phase first."
    exit 1
}
```

**Complete phase:**
```powershell
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "design" -Updates @{
    "validation.design_complete" = $true
}
```

### Phase 4: Implementation

**Validate prerequisites:**
```powershell
if (-not (Test-PluginState -PluginPath "plugins\MyPlugin" `
    -RequiredPhase "design_complete" `
    -RequiredFiles @(".ideas/architecture.md", ".ideas/plan.md"))) {
    exit 1
}
```

**Complete phase:**
```powershell
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "code" -Updates @{
    "validation.code_complete" = $true
    "validation.tests_passed" = $true
}
```

### Phase 5: Shipping

**Validate prerequisites:**
```powershell
if (-not (Test-PluginState -PluginPath "plugins\MyPlugin" `
    -RequiredPhase "code_complete" `
    -RequiredFiles @("Source/PluginProcessor.cpp"))) {
    exit 1
}
```

**Complete phase:**
```powershell
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "ship" -Updates @{
    "validation.ship_ready" = $true
    "version" = "v1.0.0"
}
```

---

## Framework Selection

### Set-PluginFramework

Centralized framework selection with validation:

```powershell
Set-PluginFramework -PluginPath "plugins\MyPlugin" `
    -Framework "webview" `
    -Rationale "Complex UI requirements"
```

**Updates:**
- `ui_framework`
- `framework_selection.decision`
- `framework_selection.rationale`

### Framework Decision Matrix

| Criteria | Visage | WebView |
|----------|--------|---------|
| Complexity Score 1-2 | ✅ Recommended | ⚠️ Overkill |
| Complexity Score 3-5 | ⚠️ Possible | ✅ Recommended |
| Performance Critical | ✅ Best | ⚠️ Good |
| Rich Visualization | ⚠️ Limited | ✅ Excellent |
| Rapid Iteration | ⚠️ Slow | ✅ Fast |
| Team Collaboration | ⚠️ C++ Only | ✅ Web Devs |

---

## Error Recovery

### Automatic Backup

State is automatically backed up before:
- Phase completion
- Framework selection changes
- Major file operations

### Manual Backup

```powershell
# Before risky operation
Backup-PluginState -PluginPath "plugins\MyPlugin"

# Try operation
try {
    # Risky operation here
} catch {
    # Restore on failure
    Restore-PluginState -PluginPath "plugins\MyPlugin"
}
```

### Error Logging

```powershell
# Log error to state
Add-StateError -PluginPath "plugins\MyPlugin" `
    -ErrorMessage "Build failed: CMake configuration error"
```

**Updates:** `error_recovery.error_log` array

---

## Validation Functions

### Validate-PhasePrerequisites

Comprehensive prerequisite validation:

```powershell
$validation = Validate-PhasePrerequisites `
    -PluginPath "plugins\MyPlugin" `
    -CurrentPhase "code" `
    -RequiredPhase "design_complete" `
    -RequiredFiles @(".ideas/architecture.md")

if (-not $validation.IsValid) {
    Write-Host "Missing: $($validation.MissingFiles -join ', ')" -ForegroundColor Red
    Write-Host "Current phase: $($validation.CurrentPhase)" -ForegroundColor Red
    exit 1
}
```

### Test-CanvasImplementation

WebView-specific validation:

```powershell
if (-not (Test-CanvasImplementation -PluginPath "plugins\MyPlugin")) {
    Write-Error "Canvas implementation required for WebView"
    exit 1
}
```

---

## State Transitions

### Valid Transitions

```
ideation → ideation_complete → plan → plan_complete → 
design → design_complete → code → code_complete → 
ship → ship_complete → complete
```

### Invalid Transitions (Blocked)

```
ideation → design       (Missing plan)
ideation → code          (Missing plan, design)
plan → code              (Missing design)
design → ship            (Missing code)
```

### Validation Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Prerequisites not met" | Previous phase incomplete | Complete prior phase |
| "Framework not selected" | Missing framework choice | Run planning phase |
| "Required files missing" | Files don't exist | Create required files |
| "Invalid phase transition" | Trying to skip phases | Follow phase order |

---

## Multi-Agent Support

### Context Preservation

State enables switching between AI agents:

```powershell
# Agent 1 completes ideation
/dream MyPlugin
# ... ideation complete

# Agent 2 continues with planning
/plan MyPlugin
# Reads status.json, knows ideation is complete
# Continues from correct phase
```

### State as Source of Truth

```powershell
# Any agent can check current state
$state = Get-PluginState -PluginPath "plugins\MyPlugin"
Write-Host "Resuming from phase: $($state.current_phase)"
```

---

## Best Practices

### 1. Always Validate Before Proceeding

```powershell
if (-not (Test-PluginState ...)) {
    exit 1
}
```

### 2. Backup Before Major Changes

```powershell
Backup-PluginState -PluginPath "plugins\MyPlugin"
# ... make changes
```

### 3. Use Complete-Phase for Transitions

```powershell
# Good
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "plan" -Updates @{...}

# Bad - manual updates
Update-PluginState -PluginPath "plugins\MyPlugin" -Updates @{
    "current_phase" = "plan_complete"
}
```

### 4. Log Errors for Debugging

```powershell
try {
    # Operation
} catch {
    Add-StateError -PluginPath "plugins\MyPlugin" -ErrorMessage $_.Exception.Message
}
```

### 5. Check Framework Before UI Work

```powershell
$state = Get-PluginState -PluginPath "plugins\MyPlugin"
if ($state.ui_framework -eq "webview") {
    # WebView-specific code
} else {
    # Visage-specific code
}
```

---

## Troubleshooting

### Issue: "State validation failed"

**Check:**
```powershell
$state = Get-PluginState -PluginPath "plugins\MyPlugin"
$state | ConvertTo-Json -Depth 5
```

**Common causes:**
- Missing required fields
- Invalid data types
- Corrupted JSON

### Issue: "Prerequisites not met"

**Check:**
```powershell
# Current phase
$state.current_phase

# Required validation flags
$state.validation

# Missing files
Test-Path "plugins\MyPlugin\.ideas\creative-brief.md"
```

### Issue: "Framework not selected"

**Solution:**
```powershell
Set-PluginFramework -PluginPath "plugins\MyPlugin" -Framework "webview" -Rationale "..."
```

---

## API Reference

### Function Summary

| Function | Purpose |
|----------|---------|
| `New-PluginState` | Initialize new plugin state |
| `Get-PluginState` | Retrieve current state |
| `Update-PluginState` | Update specific fields |
| `Test-PluginState` | Validate prerequisites |
| `Complete-Phase` | Mark phase complete |
| `Backup-PluginState` | Create backup |
| `Restore-PluginState` | Rollback to backup |
| `Add-StateError` | Log error |
| `Set-PluginFramework` | Select UI framework |
| `Validate-PhasePrerequisites` | Comprehensive validation |
| `Test-CanvasImplementation` | WebView validation |

---

## Related Documentation

- [Project Structure](PROJECT_STRUCTURE.md) - Directory layout
- [State Management Guide](.agent/guides/state-management-guide.md) - Original guide
- [Build System](build-system.md) - Build integration
- [Workflows](.agent/workflows/) - Phase orchestration
