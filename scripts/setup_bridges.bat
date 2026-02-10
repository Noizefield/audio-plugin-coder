@echo off
setlocal EnableDelayedExpansion

echo ==========================================================
echo       JUCE BRIDGE TEMPLATE - ONE CLICK SETUP
echo ==========================================================
echo.
echo This script will help you set up and generate Visual Studio
echo projects for the FFGL and Max External bridges.
echo.

:: 1. Check for Prerequisites
call :CheckCommand cmake "CMake"
if errorlevel 1 goto :Fail
call :CheckCommand git "Git"
if errorlevel 1 goto :Fail

:: 2. Choose Project
echo Select Bridge Template to Setup:
echo [1] FFGL 2.0 Bridge (Visual Plugin)
echo [2] Max External (Audio/MIDI Object)
echo.
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    set TEMPLATE_DIR=templates/FFGL_Bridge
    set BUILD_DIR=build_ffgl
    set PROJ_NAME=FFGL Bridge
) else if "%choice%"=="2" (
    set TEMPLATE_DIR=templates/Max_External
    set BUILD_DIR=build_max
    set PROJ_NAME=Max External
) else (
    echo Invalid choice. Exiting.
    pause
    exit /b 1
)

:: 3. Check JUCE
echo.
echo Checking for JUCE Framework...
if not exist "_tools\JUCE" (
    echo JUCE not found in _tools/JUCE.
    echo Cloning JUCE 8 (this may take a while)...
    if not exist "_tools" mkdir "_tools"
    git clone https://github.com/juce-framework/JUCE.git _tools/JUCE
    if errorlevel 1 (
        echo Failed to clone JUCE. Please check your internet connection.
        pause
        exit /b 1
    )
) else (
    echo JUCE found.
)

:: 4. Configure CMake
echo.
echo Configuring %PROJ_NAME%...
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

:: Pass JUCE_DIR explicitly just in case
cmake -S "%TEMPLATE_DIR%" -B "%BUILD_DIR%" -DJUCE_DIR="%CD%/_tools/JUCE"
if errorlevel 1 (
    echo CMake Configuration Failed!
    pause
    exit /b 1
)

:: 5. Open Solution
echo.
echo Setup Complete! Opening Visual Studio Solution...
start "" "%BUILD_DIR%"/*.sln

echo.
echo You are ready to build!
pause
exit /b 0

:: Helper Function
:CheckCommand
where %1 >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: %2 is not installed or not in PATH.
    echo Please install %2 and try again.
    exit /b 1
)
exit /b 0

:Fail
echo.
echo Setup failed due to missing tools.
pause
exit /b 1
