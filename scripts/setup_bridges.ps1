Write-Host "==========================================================" -ForegroundColor Green
Write-Host "       JUCE BRIDGE TEMPLATE - ONE CLICK SETUP (PowerShell)" -ForegroundColor Green
Write-Host "=========================================================="
Write-Host ""

# Helper to check commands
function Check-Command($cmd, $name) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "Error: $name is not installed or not in PATH."
        Read-Host "Press Enter to exit..."
        exit 1
    }
}

# 1. Check Prerequisites
Check-Command "cmake" "CMake"
Check-Command "git" "Git"

# 2. Check JUCE Framework
$JUCE_PATH = Join-Path $PSScriptRoot "..\_tools\JUCE"
$JUCE_PATH = Resolve-Path $JUCE_PATH -ErrorAction SilentlyContinue

if (-not (Test-Path $JUCE_PATH)) {
    Write-Host "Checking for JUCE Framework..." -ForegroundColor Yellow
    Write-Host "JUCE not found in _tools/JUCE."

    $TOOLS_DIR = Join-Path $PSScriptRoot "..\_tools"
    if (-not (Test-Path $TOOLS_DIR)) { New-Item -ItemType Directory -Path $TOOLS_DIR | Out-Null }

    Write-Host "Cloning JUCE 8 (this may take a while)..." -ForegroundColor Cyan
    git clone https://github.com/juce-framework/JUCE.git $TOOLS_DIR\JUCE

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to clone JUCE. Please check your internet connection."
        Read-Host "Press Enter to exit..."
        exit 1
    }
    $JUCE_PATH = Join-Path $TOOLS_DIR "JUCE"
} else {
    Write-Host "JUCE Framework found at $JUCE_PATH" -ForegroundColor Green
}

# 3. Choose Project
Write-Host "`nSelect Bridge Template to Setup:"
Write-Host "[1] FFGL 2.0 Bridge (Visual Plugin)"
Write-Host "[2] Max External (Audio/MIDI Object)"
$choice = Read-Host "Enter choice (1 or 2)"

switch ($choice) {
    "1" {
        $TEMPLATE_DIR = "templates/FFGL_Bridge"
        $BUILD_DIR = "build_ffgl"
        $PROJ_NAME = "FFGL Bridge"
    }
    "2" {
        $TEMPLATE_DIR = "templates/Max_External"
        $BUILD_DIR = "build_max"
        $PROJ_NAME = "Max External"
    }
    Default {
        Write-Error "Invalid choice."
        Read-Host "Press Enter to exit..."
        exit 1
    }
}

# 4. Configure CMake
Write-Host "`nConfiguring $PROJ_NAME..." -ForegroundColor Cyan
$ROOT_DIR = Resolve-Path (Join-Path $PSScriptRoot "..")
$BUILD_FULL_PATH = Join-Path $ROOT_DIR $BUILD_DIR
$TEMPLATE_FULL_PATH = Join-Path $ROOT_DIR $TEMPLATE_DIR

if (-not (Test-Path $BUILD_FULL_PATH)) { New-Item -ItemType Directory -Path $BUILD_FULL_PATH | Out-Null }

cmake -S "$TEMPLATE_FULL_PATH" -B "$BUILD_FULL_PATH" -DJUCE_DIR="$JUCE_PATH"

if ($LASTEXITCODE -ne 0) {
    Write-Error "CMake Configuration Failed!"
    Read-Host "Press Enter to exit..."
    exit 1
}

# 5. Open Solution
Write-Host "`nSetup Complete! Opening Visual Studio Solution..." -ForegroundColor Green
Invoke-Item "$BUILD_FULL_PATH\*.sln"

Read-Host "Press Enter to finish..."
