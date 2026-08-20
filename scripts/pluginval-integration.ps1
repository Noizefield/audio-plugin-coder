# PluginVal Integration Module for APC Build Process
# Automates plugin validation testing with PluginVal

$script:ApcPluginValScriptRoot = $PSScriptRoot
. (Join-Path $script:ApcPluginValScriptRoot "lib\Get-ApcPaths.ps1")

function Test-WithPluginVal {
    param(
        [string]$PluginPath,
        [string]$PluginName,
        [string]$PluginValPath = "_tools/pluginval/pluginval.exe",
        [switch]$Strict,
        [switch]$Verbose
    )

    Write-Host "Running PluginVal tests..." -ForegroundColor Cyan

    # Check if PluginVal exists
    if (-not (Test-Path $PluginValPath)) {
        Write-Warning "PluginVal not found at $PluginValPath"
        Write-Host "Skipping PluginVal tests" -ForegroundColor Yellow
        return @{
            Passed = $false
            Skipped = $true
            Reason = "PluginVal not found"
            Results = $null
        }
    }

    # Validate plugin exists
    if (-not (Test-Path $PluginPath)) {
        Write-Error "Plugin not found at $PluginPath"
        return @{
            Passed = $false
            Skipped = $false
            Reason = "Plugin file not found"
            Results = $null
        }
    }

    # Run PluginVal
    $arguments = @("--validate", $PluginPath)

    if ($Verbose) {
        $arguments += "--verbose"
    }

    if ($Strict) {
        $arguments += "--strict"
    }

    try {
        $startTime = Get-Date
        $process = Start-Process -FilePath $PluginValPath -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput "pluginval_output.txt" -RedirectStandardError "pluginval_error.txt"
        $duration = (Get-Date) - $startTime

        $output = Get-Content "pluginval_output.txt" -Raw -ErrorAction SilentlyContinue
        $errorOutput = Get-Content "pluginval_error.txt" -Raw -ErrorAction SilentlyContinue

        # Clean up temp files
        Remove-Item "pluginval_output.txt" -ErrorAction SilentlyContinue
        Remove-Item "pluginval_error.txt" -ErrorAction SilentlyContinue

        # Analyze results
        # PluginVal outputs "SUCCESS" at the end when all tests pass
        $passed = $output -match "SUCCESS"
        $failed = -not $passed

        # Extract test results
        $testResults = @{
            Passed = $passed
            Failed = $failed
            Duration = $duration
            Output = $output
            ErrorOutput = $errorOutput
            ExitCode = $process.ExitCode
        }

        # Parse detailed results
        $testCategories = @()
        if ($output -match "Basic tests:\s*(PASSED|FAILED)") {
            $testCategories += @{
                Name = "Basic Tests"
                Result = $Matches[1]
            }
        }
        if ($output -match "Parameter tests:\s*(PASSED|FAILED)") {
            $testCategories += @{
                Name = "Parameter Tests"
                Result = $Matches[1]
            }
        }
        if ($output -match "Processing tests:\s*(PASSED|FAILED)") {
            $testCategories += @{
                Name = "Processing Tests"
                Result = $Matches[1]
            }
        }

        $testResults.Categories = $testCategories

        # Update status.json
        $pluginStatePath = Get-ApcPluginPath -PluginName $PluginName
        Update-PluginState -PluginPath $pluginStatePath -Updates @{
            "validation.tests_passed" = $passed
            "validation.pluginval_results" = @{
                passed = $passed
                failed = $failed
                duration_seconds = $duration.TotalSeconds
                categories = $testCategories
                output_summary = ($output -split "`n" | Where-Object { $_ -match "(PASSED|FAILED|ERROR)" } | Select-Object -First 10) -join "; "
                last_run = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
            }
        }

        # Report results
        if ($passed) {
            Write-Host "PluginVal tests PASSED!" -ForegroundColor Green
            Write-Host "Duration:" $duration.TotalSeconds.ToString("F1") "s" -ForegroundColor Gray
        } else {
            Write-Host "PluginVal tests FAILED!" -ForegroundColor Red
            Write-Host "Duration:" $duration.TotalSeconds.ToString("F1") "s" -ForegroundColor Gray

            if ($Verbose -or $testCategories.Count -gt 0) {
                Write-Host "Test Results:" -ForegroundColor Yellow
                foreach ($category in $testCategories) {
                    $color = if ($category.Result -eq "PASSED") { "Green" } else { "Red" }
                    Write-Host "  $($category.Name): $($category.Result)" -ForegroundColor $color
                }
            }
        }

        return $testResults

    }
    catch {
        $errorMessage = $_.Exception.Message
        Write-Host "PluginVal execution failed:" $errorMessage -ForegroundColor Red
        return @{
            Passed = $false
            Skipped = $false
            Reason = "Execution failed: $($_.Exception.Message)"
            Results = $null
        }
    }
}

function Get-PluginValReport {
    param([string]$PluginName)

    $state = Get-PluginState -PluginPath (Get-ApcPluginPath -PluginName $PluginName)

    if ($state.validation.pluginval_results) {
        $results = $state.validation.pluginval_results

        Write-Host "PluginVal Test Report for" $PluginName -ForegroundColor Cyan
        Write-Host ("=" * 50) -ForegroundColor Cyan
        $status = if ($results.passed) { "PASSED" } else { "FAILED" }
        $color = if ($results.passed) { "Green" } else { "Red" }
        Write-Host "Status:" $status -ForegroundColor $color
        Write-Host "Last Run:" $results.last_run -ForegroundColor Gray
        Write-Host "Duration:" $results.duration_seconds.ToString("F1") "s" -ForegroundColor Gray

        if ($results.categories) {
            Write-Host "Test Categories:" -ForegroundColor Yellow
            foreach ($category in $results.categories) {
                $color = if ($category.Result -eq "PASSED") { "Green" } else { "Red" }
                Write-Host "  $($category.Name): $($category.Result)" -ForegroundColor $color
            }
        }

        if ($results.output_summary) {
            Write-Host "Summary:" $results.output_summary -ForegroundColor Gray
        }
    } else {
        Write-Host "No PluginVal results found for $PluginName" -ForegroundColor Yellow
    }
}

function Install-PluginVal {
    param([string]$InstallPath = "_tools")

    Write-Host "Installing PluginVal..." -ForegroundColor Cyan

    # PluginVal is typically distributed as a ZIP from GitHub
    # This is a placeholder for actual installation logic
    $pluginvalUrl = "https://github.com/Tracktion/pluginval/releases/latest/download/pluginval_Windows.zip"

    try {
        # Download and extract PluginVal
        $tempZip = "$env:TEMP/pluginval.zip"
        Invoke-WebRequest -Uri $pluginvalUrl -OutFile $tempZip

        # Extract to tools directory
        Expand-Archive -Path $tempZip -DestinationPath $InstallPath -Force

        # Clean up
        Remove-Item $tempZip -ErrorAction SilentlyContinue

        Write-Host "PluginVal installed successfully" -ForegroundColor Green
        return $true
    }
    catch {
        $errorMessage = $_.Exception.Message
        Write-Host "PluginVal installation failed:" $errorMessage -ForegroundColor Red
        return $false
    }
}

# Export functions
# Export-ModuleMember -Function Test-WithPluginVal, Get-PluginValReport, Install-PluginVal