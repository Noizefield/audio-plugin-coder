# WebView Setup Validation Script
# Validates that a plugin has proper WebView2 configuration

param(
    [Parameter(Mandatory=$true)]
    [string]$PluginName
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\Get-ApcPaths.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName
$SourcePath = "$PluginPath\Source"
$EditorCpp = "$SourcePath\PluginEditor.cpp"
$EditorH = "$SourcePath\PluginEditor.h"
$CMakeLists = "$PluginPath\CMakeLists.txt"
$LegacyWebUIPath = "$SourcePath\ui\public"
$ProtocolWebUIPath = "$PluginPath\WebUI"
if (Test-Path $ProtocolWebUIPath) {
    $WebUIPath = $ProtocolWebUIPath
} else {
    $WebUIPath = $LegacyWebUIPath
}
$IndexHtml = "$WebUIPath\index.html"
$IndexJs = "$WebUIPath\js\index.js"
$JuceIndexJs = "$WebUIPath\js\juce\index.js"

$Issues = @()
$Warnings = @()

Write-Host "Validating WebView setup for plugin: $PluginName" -ForegroundColor Cyan
Write-Host ("=" * 60)

# Check 1: Plugin directory exists
if (-not (Test-Path $PluginPath)) {
    Write-Host "ERROR: Plugin directory not found: $PluginPath" -ForegroundColor Red
    exit 1
}

# Check 2: CMakeLists.txt exists
if (-not (Test-Path $CMakeLists)) {
    $Issues += "CMakeLists.txt not found"
} else {
    $cmakeContent = Get-Content $CMakeLists -Raw
    
    # Check for juce_add_binary_data
    if ($cmakeContent -notmatch "juce_add_binary_data") {
        $Issues += "CMakeLists.txt missing 'juce_add_binary_data' - web files won't be embedded"
    }
    
    # Check for NEEDS_WEBVIEW2
    if ($cmakeContent -notmatch "NEEDS_WEBVIEW2\s+TRUE") {
        $Issues += "CMakeLists.txt missing 'NEEDS_WEBVIEW2 TRUE'"
    }
    
    # Check for JUCE_WEB_BROWSER compile definition
    if ($cmakeContent -notmatch "JUCE_WEB_BROWSER=1") {
        $Issues += "CMakeLists.txt missing 'JUCE_WEB_BROWSER=1' compile definition"
    }
    
    # Check for JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING
    if ($cmakeContent -notmatch "JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1") {
        $Issues += "CMakeLists.txt missing 'JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1'"
    }
    
    # Check for juce_gui_extra module
    if ($cmakeContent -notmatch "juce::juce_gui_extra") {
        $Issues += "CMakeLists.txt missing 'juce::juce_gui_extra' module"
    }
}

# Check 3: PluginEditor.cpp exists
if (-not (Test-Path $EditorCpp)) {
    $Issues += "PluginEditor.cpp not found"
} else {
    $cppContent = Get-Content $EditorCpp -Raw
    
    # Check for WebBrowserComponent
    if ($cppContent -notmatch "WebBrowserComponent") {
        $Issues += "PluginEditor.cpp doesn't use WebBrowserComponent"
    }
    
    # Check for withBackend(webview2)
    if ($cppContent -notmatch "withBackend.*webview2") {
        $Issues += "PluginEditor.cpp missing '.withBackend(webview2)' - WebView2 backend not specified"
    }
    
    # Check for withUserDataFolder
    if ($cppContent -notmatch "withUserDataFolder") {
        $Issues += "PluginEditor.cpp missing '.withUserDataFolder()' - Required for Windows plugins"
    }
    
    # Check for withNativeIntegrationEnabled
    if ($cppContent -notmatch "withNativeIntegrationEnabled") {
        $Issues += "PluginEditor.cpp missing '.withNativeIntegrationEnabled()' - JS to C++ communication disabled"
    }
    
    # Check for withResourceProvider
    if ($cppContent -notmatch "withResourceProvider") {
        $Issues += "PluginEditor.cpp missing '.withResourceProvider()' - Web files won't load"
    }
    
    # Check for getResourceProviderRoot (correct loading method)
    if ($cppContent -notmatch "getResourceProviderRoot") {
        if ($cppContent -match "data:text/html|loadHTML|goToURL.*data:") {
            $Issues += "PluginEditor.cpp uses data URI instead of resource provider - Use getResourceProviderRoot()"
        } else {
            $Warnings += "PluginEditor.cpp doesn't use getResourceProviderRoot() - May not load embedded files"
        }
    }
    
    # Check for parameter relays (check both .h and .cpp files)
    $cppContent = Get-Content $EditorCpp -Raw
    $hContent = if (Test-Path $EditorH) { Get-Content $EditorH -Raw } else { "" }
    $combinedContent = $cppContent + " " + $hContent
    if ($combinedContent -notmatch "WebSliderRelay|WebToggleButtonRelay|WebComboBoxRelay") {
        $Warnings += "No parameter relays found - Parameters won't sync with JavaScript"
    }
    
    # Check for parameter attachments
    if ($cppContent -notmatch "WebSliderParameterAttachment|WebToggleButtonParameterAttachment|WebComboBoxParameterAttachment") {
        $Warnings += "No parameter attachments found - Parameters won't be connected"
    }
}

# Check 4: Web UI files exist
if (-not (Test-Path $WebUIPath)) {
    $Issues += "Web UI directory not found: $WebUIPath"
} else {
    if (-not (Test-Path $IndexHtml)) {
        $Issues += "index.html not found: $IndexHtml"
    } else {
        $htmlContent = Get-Content $IndexHtml -Raw
        if ($htmlContent -match '<link[^>]+rel=["'']stylesheet["'']') {
            $Issues += 'index.html uses linked stylesheets. JUCE WebView often ignores linked CSS (webview-011). Inline ALL CSS in a style block. See .claude/troubleshooting/resolutions/webview-011-unstyled-external-css.md'
        }
        if ($htmlContent -match '<script[^>]+type=["'']module["'']') {
            $Issues += 'index.html uses script type=module. ES6 modules fail in JUCE WebView (webview-008). Inline JavaScript instead.'
        }
        if ($htmlContent -match '<script[^>]+src=') {
            $Warnings += 'index.html has script src. Prefer inlined JS (webview-008). External JS often fails in WebView.'
        }
    }
    
    if (-not (Test-Path $IndexJs)) {
        $Issues += "js/index.js not found: $IndexJs"
    }
    
    if (-not (Test-Path $JuceIndexJs)) {
        $Warnings += "js/juce/index.js not found - JUCE frontend library missing. Prefer npm @juce-framework/webview or copy _tools/JUCE/modules/juce_gui_extra/native/typescript/webview-interop/dist/index.js (JUCE 9)."
    }
}

# Check 5: Resource provider function exists
if (Test-Path $EditorCpp) {
    $cppContent = Get-Content $EditorCpp -Raw
    if ($cppContent -notmatch "getResource.*String.*url") {
        $Issues += 'getResource function not found - Resource provider will not work'
    }
}

# Check 6: Resource loading mechanism exists
if (Test-Path $EditorCpp) {
    $cppContent = Get-Content $EditorCpp -Raw
    if ($cppContent -notmatch "getZipFile|createAssetInputStream|BinaryData::getNamedResource") {
        $Issues += "No resource loading mechanism found - Need getZipFile(), createAssetInputStream(), or BinaryData::getNamedResource()"
    }
}

# Report results
Write-Host ""
if ($Issues.Count -eq 0 -and $Warnings.Count -eq 0) {
    Write-Host "All checks passed! WebView setup looks correct." -ForegroundColor Green
    exit 0
}

if ($Issues.Count -gt 0) {
    Write-Host "CRITICAL ISSUES FOUND:" -ForegroundColor Red
    foreach ($issue in $Issues) {
        Write-Host "  [X] $issue" -ForegroundColor Red
    }
}

if ($Warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNINGS:" -ForegroundColor Yellow
    foreach ($warning in $Warnings) {
        Write-Host "  [!] $warning" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Validation Summary:" -ForegroundColor Cyan
$issueColor = if ($Issues.Count -gt 0) { "Red" } else { "Green" }
$warningColor = if ($Warnings.Count -gt 0) { "Yellow" } else { "Green" }
Write-Host "  Issues: $($Issues.Count)" -ForegroundColor $issueColor
Write-Host "  Warnings: $($Warnings.Count)" -ForegroundColor $warningColor

if ($Issues.Count -gt 0) {
    Write-Host ""
    Write-Host "See templates in .claude/templates/webview/ for correct implementation" -ForegroundColor Cyan
    exit 1
}

exit 0
