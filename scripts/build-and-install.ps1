<#
.SYNOPSIS
    APC Master Builder with Enhanced Error Detection and Testing
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PluginName,
    [switch]$NoInstall,
    [switch]$SkipTests,
    [switch]$Strict
)

$ErrorActionPreference = "Stop"

# Import required modules
. "$PSScriptRoot\lib\Get-ApcPaths.ps1"
. "$PSScriptRoot\state-management.ps1"
. "$PSScriptRoot\error-detection.ps1"
. "$PSScriptRoot\terminal-monitoring.ps1"
. "$PSScriptRoot\pluginval-integration.ps1"
. "$PSScriptRoot\clap-validator-integration.ps1"

$ApcPaths = Get-ApcPaths
if (-not (Initialize-ApcCMakePath)) { throw "cmake is required but was not found." }
$RootPath = $ApcPaths.RepoRoot
$BuildDir = $ApcPaths.BuildDir
$PluginDir = Join-Path $ApcPaths.PluginsDir $PluginName
$StatusJson = Join-Path $PluginDir "status.json"
$UseVisage = $false
$UseClap = $false

if (Test-Path $StatusJson) {
    try {
        $state = Get-Content $StatusJson -Raw | ConvertFrom-Json
        if ($state.ui_framework -eq "visage") {
            $UseVisage = $true
        }
        if ($state.formats -and $state.formats.clap -eq $true) {
            $UseClap = $true
        }
    } catch {
        Write-Warning "Could not read status.json; proceeding without framework hints."
    }
}

Write-Host "--- APC BUILDER: $PluginName ---" -ForegroundColor Cyan
Write-Host "Plugins: $($ApcPaths.PluginsDir)" -ForegroundColor DarkGray
Write-Host "Build:   $BuildDir" -ForegroundColor DarkGray
if ($UseVisage) {
    Write-Host "Framework: visage" -ForegroundColor DarkGray
}
if ($UseClap) {
    Write-Host "CLAP: opted in (formats.clap)" -ForegroundColor DarkGray
}

# Validate prerequisites
$state = Get-PluginState -PluginPath $PluginDir
if ($state.current_phase -ne "code_complete" -and -not $SkipTests) {
    Write-Warning "Plugin implementation not marked as complete. Use -SkipTests to override."
}

# 0. Cap compiler parallelism. JUCE adds /MP (all cores) and LTO makes each cl.exe
#    heavy; on 16+ core machines that exhausts RAM ("C1060 compiler is out of heap
#    space"). Default to half the logical cores; override with $env:APC_BUILD_JOBS.
$buildJobs = if ($env:APC_BUILD_JOBS) { [int]$env:APC_BUILD_JOBS } else { [Math]::Max(2, [int][Math]::Floor($env:NUMBER_OF_PROCESSORS / 2)) }
$env:CL = (($env:CL + " /MP$buildJobs").Trim())
Write-Host "Compiler jobs: $buildJobs (set APC_BUILD_JOBS to override)" -ForegroundColor DarkGray

# 1. Configure with error monitoring
Write-Host "Configuring build..." -ForegroundColor Yellow
$visageFlag = if ($UseVisage) { "-DAPC_ENABLE_VISAGE:BOOL=ON" } else { "" }
$pluginsFlag = "-DAPC_PLUGINS_DIR=`"$($ApcPaths.PluginsDir)`""
$configureCommand = "cmake -S `"$RootPath`" -B `"$BuildDir`" -G `"Visual Studio 17 2022`" -A x64 --fresh $visageFlag $pluginsFlag"
$configResult = Invoke-MonitoredCommand -Command $configureCommand -ShowOutput -ThrowOnError

if ($configResult.Errors.Count -gt 0) {
    Write-Host "Configuration warnings detected" -ForegroundColor Yellow
    $knownIssue = Find-KnownIssue -Errors $configResult.Errors
    if ($knownIssue) {
        Write-Host "Known configuration issue detected: $($knownIssue.Title)" -ForegroundColor Cyan
        Apply-KnownSolution -Issue $knownIssue
        # Retry configuration
        $configResult = Invoke-MonitoredCommand -Command $configureCommand -ShowOutput -ThrowOnError
    }
}

# 2. Build VST3 with error monitoring
Write-Host "Compiling VST3..." -ForegroundColor Yellow
$buildVst3Command = "cmake --build `"$BuildDir`" --config Release --target `"$($PluginName)_VST3`""
$vst3Result = Invoke-MonitoredCommand -Command $buildVst3Command -ShowOutput -ThrowOnError

if ($vst3Result.Errors.Count -gt 0) {
    Write-Host "VST3 build errors detected" -ForegroundColor Red

    # Check for known issues
    $knownIssue = Find-KnownIssue -Errors $vst3Result.Errors
    if ($knownIssue) {
        Write-Host "Known issue detected: $($knownIssue.Title)" -ForegroundColor Cyan
        Apply-KnownSolution -Issue $knownIssue
        # Retry build
        $vst3Result = Invoke-MonitoredCommand -Command $buildVst3Command -ShowOutput -ThrowOnError
    }

    # If still failing, auto-capture new issue
    if ($vst3Result.Errors.Count -gt 0) {
        New-IssueFromError -Errors $vst3Result.Errors -BuildOutput $vst3Result.Output
        throw "VST3 build failed - issue logged for investigation"
    }
}

# 3. Build Standalone with error monitoring
Write-Host "Compiling Standalone..." -ForegroundColor Yellow
$buildStandaloneCommand = "cmake --build `"$BuildDir`" --config Release --target `"$($PluginName)_Standalone`""
$standaloneResult = Invoke-MonitoredCommand -Command $buildStandaloneCommand -ShowOutput -ThrowOnError

if ($standaloneResult.Errors.Count -gt 0) {
    Write-Host "Standalone build errors detected" -ForegroundColor Red

    # Check for known issues
    $knownIssue = Find-KnownIssue -Errors $standaloneResult.Errors
    if ($knownIssue) {
        Write-Host "Known issue detected: $($knownIssue.Title)" -ForegroundColor Cyan
        Apply-KnownSolution -Issue $knownIssue
        # Retry build
        $standaloneResult = Invoke-MonitoredCommand -Command $buildStandaloneCommand -ShowOutput -ThrowOnError
    }

    # If still failing, auto-capture new issue
    if ($standaloneResult.Errors.Count -gt 0) {
        New-IssueFromError -Errors $standaloneResult.Errors -BuildOutput $standaloneResult.Output
        throw "Standalone build failed - issue logged for investigation"
    }
}

# 3b. Build CLAP (opt-in, non-fatal: CLAP failures warn but don't fail the build)
if ($UseClap) {
    Write-Host "Compiling CLAP..." -ForegroundColor Yellow
    $buildClapCommand = "cmake --build `"$BuildDir`" --config Release --target `"$($PluginName)_CLAP`""
    $clapResult = Invoke-MonitoredCommand -Command $buildClapCommand -ShowOutput

    if ($clapResult.Errors.Count -gt 0) {
        Write-Warning "CLAP build failed (non-fatal) - VST3/Standalone are unaffected"
        $knownIssue = Find-KnownIssue -Errors $clapResult.Errors
        if ($knownIssue) {
            Write-Host "Known issue detected: $($knownIssue.Title)" -ForegroundColor Cyan
            Apply-KnownSolution -Issue $knownIssue
            $clapResult = Invoke-MonitoredCommand -Command $buildClapCommand -ShowOutput
        }
    }
}

# 4. Run PluginVal tests
if (-not $SkipTests) {
    Write-Host "Running PluginVal validation..." -ForegroundColor Yellow

    # Find the built VST3 plugin
    $vst3Path = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$PluginName.vst3" | Select-Object -First 1
    if ($vst3Path) {
        $pluginvalResult = Test-WithPluginVal -PluginPath $vst3Path.FullName -PluginName $PluginName -Strict:$Strict

        if (-not $pluginvalResult.Passed -and -not $pluginvalResult.Skipped) {
            Write-Host "PluginVal tests failed" -ForegroundColor Red
            if ($Strict) {
                throw "PluginVal validation failed in strict mode"
            } else {
                Write-Warning "PluginVal tests failed - proceeding with installation anyway"
            }
        }
    } else {
        Write-Warning "VST3 plugin not found for PluginVal testing"
    }

    # 4b. Run clap-validator on the .clap binary (pluginval can't read CLAP)
    if ($UseClap) {
        $clapPath = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$PluginName.clap" | Select-Object -First 1
        if ($clapPath) {
            $clapValResult = Test-WithClapValidator -PluginPath $clapPath.FullName -PluginName $PluginName
            if (-not $clapValResult.Passed -and -not $clapValResult.Skipped) {
                if ($Strict) {
                    throw "clap-validator validation failed in strict mode"
                } else {
                    Write-Warning "clap-validator tests failed - proceeding anyway"
                }
            }
        } else {
            Write-Warning "CLAP binary not found for clap-validator testing"
        }
    }
}

# 5. Install VST3
if (-not $NoInstall) {
    Write-Host "Installing VST3..." -ForegroundColor Yellow
    $Vst = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$($PluginName).vst3" | Select-Object -First 1
    if ($Vst) {
        $Dest = "C:\Program Files\Common Files\VST3\$($Vst.Name)"
        try {
            if (Test-Path $Dest) { Remove-Item -Path $Dest -Recurse -Force -ErrorAction SilentlyContinue }
            Copy-Item -Path $Vst.FullName -Destination $Dest -Recurse -Force
            Write-Host "INSTALLED VST3 to: $Dest" -ForegroundColor Green
        } catch {
            Write-Warning "Access Denied. Run as Admin to install VST3."
        }
    }

    # Install CLAP (per-user dir - no admin required per CLAP spec)
    if ($UseClap) {
        Write-Host "Installing CLAP..." -ForegroundColor Yellow
        $Clap = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$($PluginName).clap" | Select-Object -First 1
        if ($Clap) {
            try {
                $ClapDest = $ApcPaths.ClapInstallDir
                New-Item -ItemType Directory -Path $ClapDest -Force | Out-Null
                Copy-Item -Path $Clap.FullName -Destination (Join-Path $ClapDest $Clap.Name) -Force
                Write-Host "INSTALLED CLAP to: $(Join-Path $ClapDest $Clap.Name)" -ForegroundColor Green
            } catch {
                Write-Warning "Failed to install CLAP: $_"
            }
        } else {
            Write-Warning "CLAP binary not found in build output"
        }
    }

    # Locate Standalone
    $Exe = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "$($PluginName).exe" | Select-Object -First 1
    if ($Exe) {
        Write-Host "STANDALONE built at: $($Exe.FullName)" -ForegroundColor Green

        # Add icon to standalone executable
        $IconPath = Join-Path $PluginDir "Assets\icon.ico"
        if (Test-Path $IconPath) {
            Write-Host "Adding icon to standalone executable..." -ForegroundColor Yellow
            try {
                & "$PSScriptRoot\add-icon-to-exe.ps1" -ExePath $Exe.FullName -IconPath $IconPath
                Write-Host "[OK] Icon embedded in executable" -ForegroundColor Green
            } catch {
                Write-Warning "Failed to add icon to executable: $_"
            }
        } else {
            Write-Host "No icon found at $IconPath - skipping icon embedding" -ForegroundColor Gray
        }

        Write-Host "Tip: You can run this to bypass VST3 caching issues." -ForegroundColor Cyan
    }
}

# 6. Update build status
Update-PluginState -PluginPath $PluginDir -Updates @{
    "validation.build_completed" = $true
    "validation.build_timestamp" = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    "validation.build_errors" = ($vst3Result.Errors + $standaloneResult.Errors).Count
}

Write-Host "Build process complete!" -ForegroundColor Green
