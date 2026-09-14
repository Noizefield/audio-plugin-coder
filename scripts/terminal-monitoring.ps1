# Terminal Output Monitoring Module for APC Build Process
# Provides real-time error detection and long-running command monitoring

function Watch-TerminalOutput {
    param(
        [ScriptBlock]$Command,
        [string[]]$ErrorPatterns = @("error", "Error", "ERROR", "failed", "Failed", "FAILED"),
        [int]$TimeoutSeconds = 300,
        [switch]$ShowOutput
    )

    Write-Host "Starting terminal monitoring..." -ForegroundColor Cyan

    $job = Start-Job -ScriptBlock $Command
    $startTime = Get-Date
    $output = ""
    $errors = @()

    while ($job.State -eq "Running") {
        # Check timeout
        $elapsed = (Get-Date) - $startTime
        if ($elapsed.TotalSeconds -gt $TimeoutSeconds) {
            Stop-Job $job
            Remove-Job $job
            throw "Command timed out after $TimeoutSeconds seconds"
        }

        # Get new output. Native tools (cmake, msbuild) write warnings to stderr;
        # under $ErrorActionPreference = "Stop" those would surface from Receive-Job
        # as terminating NativeCommandError, so collect them as text instead.
        $jobErrors = $null
        $newOutput = Receive-Job $job -ErrorAction SilentlyContinue -ErrorVariable jobErrors
        if ($jobErrors) { $newOutput = @($newOutput) + @($jobErrors | ForEach-Object { $_.ToString() }) }
        if ($newOutput -is [array]) { $newOutput = ($newOutput -join "`n") + "`n" }
        if ($newOutput) {
            $output += $newOutput

            if ($ShowOutput) {
                Write-Host $newOutput -NoNewline
            }

            # Check for error patterns in real-time
            foreach ($line in $newOutput -split "`n") {
                foreach ($pattern in $ErrorPatterns) {
                    if ($line -match $pattern) {
                        $errors += @{
                            Pattern = $pattern
                            Line = $line.Trim()
                            Timestamp = Get-Date
                        }

                        Write-Host "Error pattern detected:" $pattern -ForegroundColor Yellow
                        Write-Host "   " $line -ForegroundColor Red
                    }
                }
            }
        }

        Start-Sleep -Milliseconds 100
    }

    # Get final output (same stderr handling as above)
    $jobErrors = $null
    $finalOutput = Receive-Job $job -ErrorAction SilentlyContinue -ErrorVariable jobErrors
    if ($jobErrors) { $finalOutput = @($finalOutput) + @($jobErrors | ForEach-Object { $_.ToString() }) }
    if ($finalOutput -is [array]) { $finalOutput = ($finalOutput -join "`n") + "`n" }
    $output += $finalOutput

    if ($ShowOutput -and $finalOutput) {
        Write-Host $finalOutput -NoNewline
    }

    # Clean up job
    Remove-Job $job

    $result = @{
        Output = $output
        Errors = $errors
        ExitCode = if ($job.ChildJobs[0].JobStateInfo.State -eq "Completed") { 0 } else { 1 }
        Duration = (Get-Date) - $startTime
    }

    Write-Host "Terminal monitoring complete (Duration:" $result.Duration.TotalSeconds.ToString("F1") "s)" -ForegroundColor Green

    if ($errors.Count -gt 0) {
        Write-Host "Detected" $errors.Count "error patterns during execution" -ForegroundColor Yellow
    }

    return $result
}

function Invoke-MonitoredCommand {
    param(
        [string]$Command,
        [string[]]$ErrorPatterns = @("error", "Error", "ERROR", "failed", "Failed", "FAILED"),
        [int]$TimeoutSeconds = 300,
        [switch]$ShowOutput,
        [switch]$ThrowOnError
    )

    Write-Host "Executing:" $Command -ForegroundColor Cyan

    # A job "completes" even when the native tool returns non-zero, which used to
    # report failed cmake/msbuild runs as success. Throw inside the job on a
    # non-zero exit code so the job state becomes Failed and ExitCode becomes 1.
    $wrapped = $Command + "`n" + 'if ($LASTEXITCODE -ne 0) { throw "native command exited with code $LASTEXITCODE" }'
    $scriptBlock = [ScriptBlock]::Create($wrapped)

    try {
        $result = Watch-TerminalOutput -Command $scriptBlock -ErrorPatterns $ErrorPatterns -TimeoutSeconds $TimeoutSeconds -ShowOutput:$ShowOutput

        if ($result.ExitCode -ne 0 -and $ThrowOnError) {
            throw "Command failed with exit code $($result.ExitCode)"
        }

        return $result
    }
    catch {
        $errorMessage = $_.Exception.Message
        Write-Host "Command execution failed" $errorMessage -ForegroundColor Red
        if ($ThrowOnError) {
            throw
        }
        return @{
            Output = ""
            Errors = @()
            ExitCode = 1
            Duration = [TimeSpan]::Zero
            Exception = $_.Exception.Message
        }
    }
}

function Test-BuildHealth {
    param([string]$BuildOutput)

    $health = @{
        Success = $true
        Warnings = @()
        Errors = @()
        Score = 100
    }

    # Check for common success indicators
    $successPatterns = @(
        'Build succeeded',
        'cmake.*completed',
        'msbuild.*succeeded',
        'plugin.*built successfully'
    )

    $hasSuccess = $false
    foreach ($pattern in $successPatterns) {
        if ($BuildOutput -match $pattern) {
            $hasSuccess = $true
            break
        }
    }

    # Check for errors
    $errorPatterns = @(
        'error C\d+',
        'fatal error',
        'CMake Error',
        'LINK : fatal error',
        'Build FAILED',
        'compilation failed'
    )

    foreach ($pattern in $errorPatterns) {
        if ($BuildOutput -match $pattern) {
            $health.Errors += $pattern
            $health.Score -= 20
        }
    }

    # Check for warnings
    $warningPatterns = @(
        'warning C\d+',
        'CMake Warning',
        'cl : Command line warning'
    )

    foreach ($pattern in $warningPatterns) {
        if ($BuildOutput -match $pattern) {
            $health.Warnings += $pattern
            $health.Score -= 5
        }
    }

    if (-not $hasSuccess -and $health.Errors.Count -gt 0) {
        $health.Success = $false
    }

    $health.Score = [Math]::Max(0, $health.Score)

    return $health
}

# Export functions
# Export-ModuleMember -Function Watch-TerminalOutput, Invoke-MonitoredCommand, Test-BuildHealth