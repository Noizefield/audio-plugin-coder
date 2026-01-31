# SKILL: PACKAGING

**Goal:** Create Distributable VST Plugin Package
**Trigger:** `/ship [Name]`
**Prerequisites:** Phase 4 (CODE) complete, audio engine working, all tests passed
**Output Location:** `dist/[Name]_v1.0/`

## 🚀 PHASE 5: SHIP (Packaging & Release)

**Input:** Reads `plugins/[Name]/status.json` to verify previous phases complete

**State Validation:**
```powershell
# Import state management module
. "$PSScriptRoot\..\scripts\state-management.ps1"

# Validate prerequisites
if (-not (Test-PluginState -PluginPath "plugins\[Name]" -RequiredPhase "code_complete" -RequiredFiles @("Source/PluginProcessor.cpp", "Source/PluginEditor.cpp"))) {
    Write-Error "Prerequisites not met. Complete implementation phase first."
    exit 1
}

# Check that tests have passed
$state = Get-PluginState -PluginPath "plugins\[Name]"
if (-not $state.validation.tests_passed) {
    Write-Warning "Tests not marked as passed. Proceeding anyway..."
}
```

### STEP 1: PRE-SHIP VALIDATION
```powershell
# Verify Phase 4 completion
if (-not (Test-Path "plugins/[Name]/Source/PluginProcessor.cpp")) {
    Write-Host "ERROR: Phase 4 (CODE) not complete" -ForegroundColor Red
    Write-Host "Please complete DSP implementation first" -ForegroundColor Yellow
    exit 1
}

# Verify build artifacts exist
if (-not (Test-Path "build/[Name]_Release")) {
    Write-Host "ERROR: Release build not found" -ForegroundColor Red
    Write-Host "Run build-and-install.ps1 first" -ForegroundColor Yellow
    exit 1
}
```

### STEP 2: PACKAGE PREPARATION
1.  **Create distribution directory:**
    ```powershell
    $distPath = "dist/[Name]_v1.0"
    New-Item -ItemType Directory -Path $distPath -Force | Out-Null
    ```

2.  **Copy plugin artifacts:**
    - VST3 plugin (.vst3)
    - Documentation (README.md, LICENSE)
    - Presets (if any)
    - User manual (if created)

### STEP 3: INSTALLER GENERATION
1.  **Inno Setup:**
    *   Generate `installer.iss` with proper VST3 registration
    *   Config: Install .vst3 to `{commoncf}\VST3`
    *   Include uninstaller
    *   Add plugin metadata (version, author, description)

2.  **Alternative: Zip Distribution:**
    *   Copy artifacts to `dist/[Name]_v1.0/`
    *   Compress to `[Name]_v1.0.zip`
    *   Include installation instructions

### STEP 4: FINAL VERIFICATION
```powershell
# Test installation
if (Test-Path "$env:ProgramFiles\Common Files\VST3/[Name].vst3") {
    Write-Host "✓ Plugin installed successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Installation verification failed" -ForegroundColor Red
    exit 1
}

# Backup state before shipping
Backup-PluginState -PluginPath "plugins/[Name]"

# Update status.json with final state
Update-PluginState -PluginPath "plugins/[Name]" -Phase "ship_complete" -Updates @{
  "version" = "v1.0.0"
  "validation.ship_ready" = $true
}
```

### STEP 5: CLEANUP & DOCUMENTATION
1.  **Update PLUGINS.md** - Mark plugin as shipped
2.  **Git commit** - Tag release
3.  **Create release notes** - Document features and changes

## 📦 OUTPUT FILES
- `dist/[Name]_v1.0/[Name].vst3` - Plugin binary
- `dist/[Name]_v1.0/installer.exe` - Windows installer
- `dist/[Name]_v1.0/[Name]_v1.0.zip` - Alternative zip distribution
- `plugins/[Name]/status.json` - Updated project status

## 🔄 INTEGRATION
**Invoked by:**
- Natural language: "Ship [Name]", "Package [Name]"
- After Phase 4 (CODE) complete
- Manual trigger via `/ship [Name]`

**Updates:**
- `PLUGINS.md` - Release status
- `plugins/[Name]/status.json` - Final project state
- `dist/` directory - Distribution files

**Next steps:**
- Plugin ready for distribution
- Can start new plugin project or improve existing one
