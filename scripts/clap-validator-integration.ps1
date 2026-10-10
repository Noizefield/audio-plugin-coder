# ClapValidator Integration Module for APC Build Process
# Automates CLAP plugin validation with free-audio/clap-validator
# (clap-validator is the CLAP-world equivalent of pluginval, which only
# understands VST3/AU.)

$script:ApcClapValidatorScriptRoot = $PSScriptRoot
. (Join-Path $script:ApcClapValidatorScriptRoot "lib\Get-ApcPaths.ps1")

function Test-WithClapValidator {
    param(
        [string]$PluginPath,      # path to the .clap file
        [string]$PluginName,
        [string]$ValidatorPath = "",
        [switch]$Strict,
        [switch]$Verbose
    )

    Write-Host "Running clap-validator tests..." -ForegroundColor Cyan

    # Resolve the binary: explicit path, the downloaded release
    # (_tools/clap-validator-bin), a cargo build inside a source checkout,
    # or PATH.
    if (-not $ValidatorPath) {
        $candidates = @(
            "_tools/clap-validator-bin/clap-validator.exe",
            "_tools/clap-validator/clap-validator.exe",
            "_tools/clap-validator/target/release/clap-validator.exe"
        )
        foreach ($c in $candidates) { if (Test-Path $c) { $ValidatorPath = $c; break } }
        if (-not $ValidatorPath) {
            $cmd = Get-Command clap-validator -ErrorAction SilentlyContinue
            if ($cmd) { $ValidatorPath = $cmd.Source }
        }
    }

    if (-not $ValidatorPath -or -not (Test-Path $ValidatorPath)) {
        if (-not $ValidatorPath) { $ValidatorPath = "_tools/clap-validator-bin/clap-validator.exe" }
        Write-Warning "clap-validator not found at $ValidatorPath"
        Write-Host "Skipping clap-validator tests (install: Install-ClapValidator or cargo install clap-validator)" -ForegroundColor Yellow
        return @{
            Passed = $false
            Skipped = $true
            Reason = "clap-validator not found"
            Results = $null
        }
    }

    if (-not (Test-Path $PluginPath)) {
        Write-Error "CLAP plugin not found at $PluginPath"
        return @{
            Passed = $false
            Skipped = $false
            Reason = "Plugin file not found"
            Results = $null
        }
    }

    # clap-validator validate exits non-zero when any test fails.
    # --only-failed keeps the log small: successful/skipped tests are hidden.
    $arguments = @("validate", "--only-failed", $PluginPath)
    if ($Verbose) { $arguments += "--verbosity=trace" }

    try {
        $startTime = Get-Date
        $process = Start-Process -FilePath $ValidatorPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput "clap-validator_output.txt" -RedirectStandardError "clap-validator_error.txt"
        $duration = (Get-Date) - $startTime

        $output = Get-Content "clap-validator_output.txt" -Raw -ErrorAction SilentlyContinue
        $errorOutput = Get-Content "clap-validator_error.txt" -Raw -ErrorAction SilentlyContinue

        Remove-Item "clap-validator_output.txt" -ErrorAction SilentlyContinue
        Remove-Item "clap-validator_error.txt" -ErrorAction SilentlyContinue

        # Belt and suspenders: non-zero exit OR explicit FAILED markers count as failure
        $outputFailed = ($output -match "(?m)\bFAILED\b") -or ($errorOutput -match "(?m)\bFAILED\b")
        $passed = ($process.ExitCode -eq 0) -and (-not $outputFailed)

        $testResults = @{
            Passed = $passed
            Failed = -not $passed
            Duration = $duration
            Output = $output
            ErrorOutput = $errorOutput
            ExitCode = $process.ExitCode
        }

        # Update status.json
        $pluginStatePath = Get-ApcPluginPath -PluginName $PluginName
        Update-PluginState -PluginPath $pluginStatePath -Updates @{
            "validation.clap_validator_results" = @{
                passed = $passed
                failed = -not $passed
                duration_seconds = $duration.TotalSeconds
                output_summary = (($output -split "`n") | Where-Object { $_ -match "(FAILED|error)" } | Select-Object -First 10) -join "; "
                last_run = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
            }
        }

        if ($passed) {
            Write-Host "clap-validator tests PASSED!" -ForegroundColor Green
            Write-Host "Duration:" $duration.TotalSeconds.ToString("F1") "s" -ForegroundColor Gray
        } else {
            Write-Host "clap-validator tests FAILED!" -ForegroundColor Red
            Write-Host "Duration:" $duration.TotalSeconds.ToString("F1") "s" -ForegroundColor Gray
            if ($output) {
                Write-Host ($output -split "`n" | Select-Object -First 25) -ForegroundColor DarkGray
            }
        }

        return $testResults
    }
    catch {
        Write-Host "clap-validator execution failed:" $_.Exception.Message -ForegroundColor Red
        return @{
            Passed = $false
            Skipped = $false
            Reason = "Execution failed: $($_.Exception.Message)"
            Results = $null
        }
    }
}

function Install-ClapValidator {
    <#
    .SYNOPSIS
        Downloads the latest clap-validator release binary for this platform
        into _tools/clap-validator-bin/.
    #>
    param([string]$InstallPath = "_tools/clap-validator-bin")

    Write-Host "Installing clap-validator..." -ForegroundColor Cyan

    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/free-audio/clap-validator/releases/latest" -Headers @{ "User-Agent" = "APC" }
        $pattern = if ($env:OS -eq 'Windows_NT') { "windows\.zip$" } elseif ($IsMacOS) { "macos-universal\.zip$" } else { "ubuntu.*\.zip$" }
        $asset = $release.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
        if (-not $asset) { throw "No release asset matching '$pattern' in latest clap-validator release" }

        $tempZip = Join-Path $env:TEMP "clap-validator.zip"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempZip
        Expand-Archive -Path $tempZip -DestinationPath $InstallPath -Force
        Remove-Item $tempZip -ErrorAction SilentlyContinue

        Write-Host "clap-validator $($release.tag_name) installed to $InstallPath" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "clap-validator installation failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Fallback: cargo install clap-validator" -ForegroundColor Yellow
        return $false
    }
}
