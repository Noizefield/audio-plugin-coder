@echo off
setlocal EnableDelayedExpansion
title APC VST3 + Standalone Launcher

rem Always resolve paths relative to this .bat, not the caller's working dir,
rem so double-click and desktop shortcuts work from anywhere.
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%copy-vst3.ps1"

rem --- copy-vst3.bat --shortcut : create a Desktop shortcut to this launcher ---
if /i "%~1"=="--shortcut" goto :MakeShortcut
if /i "%~1"=="-shortcut" goto :MakeShortcut

if not exist "%PS_SCRIPT%" (
    echo ERROR: copy-vst3.ps1 not found next to this .bat:
    echo   %PS_SCRIPT%
    pause
    exit /b 1
)

pushd "%SCRIPT_DIR%"

if "%~1"=="" (
    rem No arguments -> interactive menu (install VST3 / run standalone / quit)
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Menu
) else (
    rem Pass any arguments straight through, e.g.:
    rem   copy-vst3.bat -Standalone
    rem   copy-vst3.bat -Latest
    rem   copy-vst3.bat -Names NoizeMeter,XENON
    rem   copy-vst3.bat -Standalone -Names XENON
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
)
set "RC=%ERRORLEVEL%"
popd

echo.
if not "%RC%"=="0" echo Script exited with code %RC%.
pause
exit /b %RC%

:MakeShortcut
echo Creating desktop shortcut to this launcher...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = $ws.CreateShortcut((Join-Path $desktop 'APC Plugin Launcher.lnk')); $lnk.TargetPath = '%~f0'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = 'powershell.exe,0'; $lnk.Description = 'Install VST3 bundles or launch standalone plugin builds'; $lnk.Save()"
if errorlevel 1 (
    echo Failed to create the shortcut.
    pause
    exit /b 1
)
echo Shortcut "APC Plugin Launcher" created on your Desktop.
pause
exit /b 0
