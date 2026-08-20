# validate-webview-member-order.ps1
# Validates member declaration order in WebView plugin headers to prevent DAW crashes

param(
    [Parameter(Mandatory=$true)]
    [string]$PluginName
)

. "$PSScriptRoot\lib\Get-ApcPaths.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName

Write-Host ""
Write-Host "WebView Member Order Validator" -ForegroundColor Cyan
Write-Host "Plugin: $PluginName" -ForegroundColor Cyan
Write-Host ""

# Check if PluginEditor.h exists
$headerPath = Join-Path $PluginPath "Source\PluginEditor.h"
if (-not (Test-Path $headerPath)) {
    Write-Host "INFO: PluginEditor.h not found - skipping validation" -ForegroundColor Yellow
    return $true
}

Write-Host "Checking: $headerPath" -ForegroundColor Cyan
Write-Host ""

# Read header file
$lines = Get-Content $headerPath

# Find private section and member declarations
$inPrivate = $false
$relayLines = @()
$webViewLine = -1
$attachmentLines = @()
$lineNum = 0

foreach ($line in $lines) {
    if ($line -match '^\s*private\s*:') {
        $inPrivate = $true
    }
    elseif ($line -match '^\s*(public|protected)\s*:') {
        $inPrivate = $false
    }

    if ($inPrivate) {
        $trimmed = $line.Trim()

        # Skip comments, empty lines, and function declarations
        if ($trimmed -match '^//' -or $trimmed -eq '' -or $trimmed -match '^\s*\w+\s+\w+\s*\(') {
            $lineNum++
            continue
        }

        # Check for relay declaration (direct member or unique_ptr)
        if ($trimmed -match '(unique_ptr<.*)?Relay(>)?\s+\w+\s*(\{|;)') {
            $relayLines += $lineNum
            Write-Host "  [Line $lineNum] Relay: $trimmed" -ForegroundColor Yellow
        }
        # Check for WebBrowserComponent or SinglePageBrowser (member variable)
        elseif ($trimmed -match 'unique_ptr<.*(WebBrowserComponent|SinglePageBrowser|webView).*>\s+webView\s*;') {
            if ($webViewLine -lt 0) {  # Only take the first one
                $webViewLine = $lineNum
                Write-Host "  [Line $lineNum] WebView: $trimmed" -ForegroundColor Yellow
            }
        }
        # Check for attachment (member variable)
        elseif ($trimmed -match 'Attachment>\s+\w+\s*;') {
            $attachmentLines += $lineNum
            Write-Host "  [Line $lineNum] Attachment: $trimmed" -ForegroundColor Yellow
        }
    }

    $lineNum++
}

Write-Host ""

# Validate order
$hasRelays = $relayLines.Count -gt 0
$hasWebView = $webViewLine -ge 0
$hasAttachments = $attachmentLines.Count -gt 0

if (-not $hasWebView) {
    Write-Host "INFO: Not a WebView plugin - skipping validation" -ForegroundColor Yellow
    return $true
}

$allValid = $true

# Check: All relays before webView
if ($hasRelays) {
    $lastRelay = $relayLines[-1]
    if ($lastRelay -lt $webViewLine) {
        Write-Host "[PASS] All relays declared before WebView" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Some relays declared AFTER WebView!" -ForegroundColor Red
        $allValid = $false
    }
}

# Check: WebView before attachments
if ($hasAttachments) {
    $firstAttachment = $attachmentLines[0]
    if ($webViewLine -lt $firstAttachment) {
        Write-Host "[PASS] WebView declared before all attachments" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Some attachments declared BEFORE WebView!" -ForegroundColor Red
        $allValid = $false
    }
}

Write-Host ""

if ($allValid) {
    Write-Host "VALIDATION PASSED" -ForegroundColor Green
    Write-Host "Member declaration order is correct" -ForegroundColor Green
    Write-Host ""
    return $true
} else {
    Write-Host "VALIDATION FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Host "CRITICAL: Incorrect member declaration order!" -ForegroundColor Red
    Write-Host "This will cause DAW crashes on plugin unload." -ForegroundColor Red
    Write-Host ""
    Write-Host "Required order in PluginEditor.h:" -ForegroundColor Yellow
    Write-Host "  1. Relays (destroyed last)" -ForegroundColor Yellow
    Write-Host "  2. WebView (destroyed middle)" -ForegroundColor Yellow
    Write-Host "  3. Attachments (destroyed first)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "See: .claude/troubleshooting/resolutions/webview-member-order-crash.md" -ForegroundColor Cyan
    Write-Host ""
    return $false
}
