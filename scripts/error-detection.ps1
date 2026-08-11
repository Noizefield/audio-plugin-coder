# Error Detection and Handling Module for APC Build Process
# Implements robust error detection, known issue matching, and automated troubleshooting

function Parse-BuildErrors {
    param([string]$Output)

    $errors = @()

    # Common CMake error patterns
    $cmakePatterns = @(
        "CMake Error",
        "Could not find",
        "Target.*already exists",
        "duplicate target",
        "undefined reference",
        "linking failed",
        "compilation failed"
    )

    # Common JUCE/WebView error patterns
    $jucePatterns = @(
        "WebView2.*not found",
        "juce_gui_extra.*not found",
        "JUCE_WEB_BROWSER.*undefined",
        "WebBrowserComponent.*error",
        "Canvas.*not supported"
    )

    # Common MSVC error patterns
    $msvcPatterns = @(
        "error C\d+",
        "fatal error C\d+",
        "LINK : fatal error",
        "cl : Command line error"
    )

    $allPatterns = $cmakePatterns + $jucePatterns + $msvcPatterns

    foreach ($line in $Output -split "`n") {
        foreach ($pattern in $allPatterns) {
            if ($line -match $pattern) {
                $errors += @{
                    Pattern = $pattern
                    Line = $line.Trim()
                    Category = if ($cmakePatterns -contains $pattern) { "cmake" }
                             elseif ($jucePatterns -contains $pattern) { "webview" }
                             else { "build" }
                }
                break
            }
        }
    }

    return $errors
}

function Find-KnownIssue ([array]$Errors) {

    $knownIssuesPath = ".kilocode/troubleshooting/known-issues.yaml"

    if (-not (Test-Path $knownIssuesPath)) {
        Write-Warning "Known issues database not found at $knownIssuesPath"
        return $null
    }

    try {
        $yamlContent = Get-Content $knownIssuesPath -Raw
        # Simple YAML parsing for error patterns
        $issues = @()

        # Extract issue blocks (simplified parsing)
        $issueBlocks = $yamlContent -split "- id:" | Where-Object { $_ -match "error_patterns" }

        foreach ($block in $issueBlocks) {
            $id = ($block -split "`n")[0].Trim()
            $patterns = @()

            if ($block -match "error_patterns:") {
                $patternSection = ($block -split "error_patterns:")[1] -split "resolution_status:" | Select-Object -First 1
                $patterns = ($patternSection -split "`n" | Where-Object { $_ -match "-" } | ForEach-Object { $_.TrimStart("- ").Trim() }) | Where-Object { $_ }
            }

            if ($patterns) {
                $issues += @{
                    Id = $id
                    ErrorPatterns = $patterns
                    Block = $block
                }
            }
        }

        # Match errors against known issues
        foreach ($err in $Errors) {
            foreach ($issue in $issues) {
                foreach ($pattern in $issue.ErrorPatterns) {
                    if ($err.Line -match [regex]::Escape($pattern) -or $err.Pattern -match [regex]::Escape($pattern)) {
                        # Extract solution from block
                        $solution = ""
                        if ($issue.Block -match "resolution_file: (.+)") {
                            $resolutionFile = $Matches[1]
                            $resolutionPath = ".kilocode/troubleshooting/resolutions/$resolutionFile"
                            if (Test-Path $resolutionPath) {
                                $solution = Get-Content $resolutionPath -Raw
                            }
                        }

                        return @{
                            Id = $issue.Id
                            Title = ($issue.Block -split "title: ")[1] -split "`n" | Select-Object -First 1
                            Solution = $solution
                            ResolutionFile = $resolutionFile
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-Warning "Error parsing known issues database: $($_.Exception.Message)"
    }

    return $null
}

function Apply-KnownSolution {

param([System.Collections.Hashtable]$Issue)

    Write-Host "📚 Applying solution for: $($Issue.Title)" -ForegroundColor Cyan

    if ($Issue.Solution) {
        Write-Host "Solution:" -ForegroundColor Yellow
        Write-Host $Issue.Solution
        Write-Host ""

        # Try to extract and execute PowerShell commands from solution
        $commands = @()
        $inCodeBlock = $false
        foreach ($line in $Issue.Solution -split "`n") {
            if ($line -match '```powershell') {
                $inCodeBlock = $true
            }
            elseif ($line -match '```' -and $inCodeBlock) {
                $inCodeBlock = $false
            }
            elseif ($inCodeBlock) {
                $commands += $line
            }
        }

        if ($commands) {
            Write-Host "Executing automated fix..." -ForegroundColor Green
            try {
                $commandBlock = $commands -join "`n"
                Invoke-Expression $commandBlock
                Write-Host "✅ Automated fix applied successfully" -ForegroundColor Green
            }
            catch {
                Write-Host "❌ Automated fix failed: $($_.Exception.Message)" -ForegroundColor Red
                Write-Host "Manual intervention required" -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "No automated solution available. Please check $($Issue.ResolutionFile)" -ForegroundColor Yellow
        }
    }
}

function New-IssueFromError ([array]$Errors, [string]$BuildOutput) {

    Write-Host "🔍 Auto-capturing new issue..." -ForegroundColor Yellow

    # Generate issue ID
    $category = if ($Errors[0].Category) { $Errors[0].Category } else { "build" }
    $existingIssues = (Get-ChildItem ".kilocode/troubleshooting/resolutions/" -Filter "*.md" | Measure-Object).Count
    $newId = "$category-$(($existingIssues + 1).ToString('000'))"

    # Create issue summary
    $errorSummary = $Errors[0].Line
    if ($errorSummary.Length -gt 100) {
        $errorSummary = $errorSummary.Substring(0, 97) + "..."
    }

    # Create new issue entry
    $newIssue = "- id: $newId" + [Environment]::NewLine + "  title: `"[Auto] $errorSummary`"" + [Environment]::NewLine + "  category: $category" + [Environment]::NewLine + "  severity: high" + [Environment]::NewLine + "  symptoms:"

    foreach ($err in $Errors | Select-Object -First 5) {
        $newIssue += [Environment]::NewLine + "    - `"$($err.Line)`""
    }

    $newIssue += [Environment]::NewLine + "  error_patterns:"

    foreach ($err in $Errors | Select-Object -First 3) {
        $newIssue += [Environment]::NewLine + "    - `"$($err.Pattern)`""
    }

    $newIssue += [Environment]::NewLine + "  resolution_status: investigating" + [Environment]::NewLine + "  resolution_file: resolutions/$newId.md" + [Environment]::NewLine + "  frequency: 1" + [Environment]::NewLine + "  last_occurred: $(Get-Date -Format "yyyy-MM-dd")" + [Environment]::NewLine + "  attempts_before_resolution: 1"

    # Append to known-issues.yaml
    Add-Content -Path ".kilocode/troubleshooting/known-issues.yaml" -Value $newIssue

    # Create resolution document from template
    $templatePath = ".kilocode/troubleshooting/_template.md"
    if (Test-Path $templatePath) {
        $templateContent = Get-Content $templatePath -Raw
        $templateContent = $templateContent -replace "\[auto-generated-id\]", $newId
        $templateContent = $templateContent -replace "\[Issue Title\]", "[Auto] $errorSummary"
        $templateContent = $templateContent -replace "\[date\]", (Get-Date -Format "yyyy-MM-dd HH:mm")

        # Add error details to template
        $errorDetails = [Environment]::NewLine + "## Build Output" + [Environment]::NewLine + [Environment]::NewLine + "    $BuildOutput" + [Environment]::NewLine + [Environment]::NewLine + "## Detected Errors" + [Environment]::NewLine
        foreach ($err in $Errors) {
            $errorDetails += "- **$($err.Pattern)**: $($err.Line)" + [Environment]::NewLine
        }

        $templateContent = $templateContent -replace "## 💡 Root Cause", ($errorDetails + [Environment]::NewLine + "## 💡 Root Cause")

        Set-Content -Path ".kilocode/troubleshooting/resolutions/$newId.md" -Value $templateContent
    }

    Write-Host "Issue logged as $newId" -ForegroundColor Green
    Write-Host ('See: .kilocode/troubleshooting/resolutions/' + $newId + '.md') -ForegroundColor Cyan
}

# Export functions
# Export-ModuleMember -Function Parse-BuildErrors, Find-KnownIssue, Apply-KnownSolution, New-IssueFromError
