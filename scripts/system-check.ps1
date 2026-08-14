<#
.SYNOPSIS
    Automated dependency validation for APC (audio-plugin-coder)
#>

param(
    [string]$Command = "--check-all",
    [string]$JucePath,
    [switch]$Human
)

function Write-JsonOutput { param([string]$Json) Write-Output $Json }

function Escape-JsonString {
    param([string]$Value)
    if ($null -eq $Value) { return "" }
    return $Value.Replace('\', '\\').Replace('"', '\"')
}

function Test-VersionGreaterOrEqual {
    param([string]$Version1, [string]$Version2)
    try { return [version]$Version1 -ge [version]$Version2 } catch { return $false }
}

function Invoke-DetectPlatform {
    $platform = "windows"
    $ver = (Get-CimInstance Win32_OperatingSystem).Version
    Write-JsonOutput -Json ("{`"platform`":`"windows`",`"version`":`"$(Escape-JsonString $ver)`"}")
}

function Invoke-CheckGit {
    try {
        $out = git --version 2>&1
        $ver = if ("$out" -match '(\d+\.\d+\.\d+)') { $matches[1] } else { "unknown" }
        Write-JsonOutput -Json ("{`"found`":true,`"version`":`"$ver`",`"ok`":true}")
    } catch {
        Write-JsonOutput -Json ("{`"found`":false,`"ok`":false}")
    }
}

function Invoke-CheckNode {
    try {
        $out = node --version 2>&1
        $ver = if ("$out" -match 'v?(\d+\.\d+\.\d+)') { $matches[1] } else { "0.0.0" }
        $ok = Test-VersionGreaterOrEqual $ver "18.0.0"
        Write-JsonOutput -Json ("{`"found`":true,`"version`":`"$ver`",`"ok`":$($ok.ToString().ToLower())}")
    } catch {
        Write-JsonOutput -Json ("{`"found`":false,`"ok`":false}")
    }
}

function Invoke-CheckPython {
    $min = "3.8"
    try {
        $out = py --version 2>&1
        if (-not $out) { $out = python --version 2>&1 }

        if ($out -match "Microsoft Store") {
            Write-JsonOutput -Json ("{`"found`":false,`"error`":`"Microsoft Store Redirect`",`"ok`":false}")
            return
        }

        $ver = if ($out -match '(\d+\.\d+\.\d+)') { $matches[1] } else { "0.0.0" }
        $ok = Test-VersionGreaterOrEqual $ver $min
        Write-JsonOutput -Json ("{`"found`":true,`"version`":`"$ver`",`"ok`":$($ok.ToString().ToLower())}")
    } catch {
        Write-JsonOutput -Json ("{`"found`":false,`"ok`":false}")
    }
}

function Invoke-CheckVisualStudio {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $ver = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion
        if ($ver) {
            Write-JsonOutput -Json ("{`"found`":true,`"version`":`"$ver`",`"ok`":true}")
            return
        }
    }
    Write-JsonOutput -Json ("{`"found`":false,`"ok`":false}")
}

function Resolve-CMakeExe {
    $cmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles "CMake\bin\cmake.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "CMake\bin\cmake.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\CMake\bin\cmake.exe"),
        "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    return $null
}

function Invoke-CheckCMake {
    try {
        $cmakeExe = Resolve-CMakeExe
        if (-not $cmakeExe) {
            Write-JsonOutput -Json ("{`"found`":false,`"ok`":false}")
            return
        }

        # Force a single string — array -match does not populate $matches and used to throw.
        $out = & $cmakeExe --version 2>&1 | Out-String
        $ver = if ($out -match 'version\s+(\d+\.\d+\.\d+)') { $matches[1] } else { "0.0.0" }
        $ok = Test-VersionGreaterOrEqual $ver "3.22"
        $pathJson = Escape-JsonString $cmakeExe
        Write-JsonOutput -Json ("{`"found`":true,`"version`":`"$ver`",`"ok`":$($ok.ToString().ToLower()),`"path`":`"$pathJson`"}")
    } catch {
        Write-JsonOutput -Json ("{`"found`":false,`"ok`":false,`"error`":`"$(Escape-JsonString $_.Exception.Message)`"}")
    }
}

function Invoke-CheckWebView2 {
    $edgeUpdate = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    $pv = $null
    try { $pv = (Get-ItemProperty -Path $edgeUpdate -ErrorAction SilentlyContinue).pv } catch {}
    if ($pv) {
        Write-JsonOutput -Json ("{`"found`":true,`"version`":`"$pv`",`"ok`":true}")
    } else {
        Write-JsonOutput -Json ("{`"found`":false,`"ok`":false,`"hint`":`"Install WebView2 Evergreen Runtime`"}")
    }
}

function Invoke-CheckJUCE {
    $path = if ($JucePath) { $JucePath } else { ".\_tools\JUCE" }
    $header = Join-Path $path "modules\juce_core\system\juce_StandardHeader.h"
    $core = Join-Path $path "modules\juce_core\juce_core.h"
    $pathJson = Escape-JsonString $path

    if (-not (Test-Path $core)) {
        Write-JsonOutput -Json ("{`"found`":false,`"path`":`"$pathJson`",`"ok`":false}")
        return
    }

    $major = 0
    if (Test-Path $header) {
        $content = Get-Content $header -Raw
        if ($content -match 'JUCE_MAJOR_VERSION\s+(\d+)') {
            $major = [int]$matches[1]
        }
    }

    $ok = $major -ge 9
    Write-JsonOutput -Json ("{`"found`":true,`"path`":`"$pathJson`",`"major`":$major,`"ok`":$($ok.ToString().ToLower()),`"required_major`":9}")
}

function Invoke-CheckPluginval {
    $path = ".\_tools\pluginval\pluginval.exe"
    if (Test-Path $path) {
        Write-JsonOutput -Json ("{`"found`":true,`"path`":`"$(Escape-JsonString $path)`",`"ok`":true}")
    } else {
        if (Test-Path ".\_tools\pluginval\CMakeLists.txt") {
            Write-JsonOutput -Json ("{`"found`":true,`"path`":`".\\\\_tools\\\\pluginval`",`"ok`":true,`"built`":false}")
        } else {
            Write-JsonOutput -Json ("{`"found`":false,`"ok`":false}")
        }
    }
}

function Invoke-CheckConfig {
    $hasLocal = Test-Path ".\apc.config.json"
    $hasExample = Test-Path ".\apc.config.example.json"
    $completed = $false
    if ($hasLocal) {
        try {
            $cfg = Get-Content ".\apc.config.json" -Raw | ConvertFrom-Json
            $completed = [bool]$cfg.setup.completed
        } catch {}
    }
    Write-JsonOutput -Json ("{`"config_present`":$($hasLocal.ToString().ToLower()),`"example_present`":$($hasExample.ToString().ToLower()),`"setup_completed`":$($completed.ToString().ToLower())}")
}

function Invoke-CheckAll {
    Write-Output "{"
    Write-Output "  `"platform`": $(Invoke-DetectPlatform),"
    Write-Output "  `"git`": $(Invoke-CheckGit),"
    Write-Output "  `"node`": $(Invoke-CheckNode),"
    Write-Output "  `"python`": $(Invoke-CheckPython),"
    Write-Output "  `"vs2022`": $(Invoke-CheckVisualStudio),"
    Write-Output "  `"cmake`": $(Invoke-CheckCMake),"
    Write-Output "  `"webview2`": $(Invoke-CheckWebView2),"
    Write-Output "  `"juce`": $(Invoke-CheckJUCE),"
    Write-Output "  `"pluginval`": $(Invoke-CheckPluginval),"
    Write-Output "  `"apc_config`": $(Invoke-CheckConfig)"
    Write-Output "}"
}

function Show-HumanSummary {
    $json = (Invoke-CheckAll | Out-String).Trim()
    try {
        $obj = $json | ConvertFrom-Json
    } catch {
        Write-Host "Raw system-check JSON (parse failed):" -ForegroundColor Yellow
        Write-Host $json
        return
    }
    Write-Host ""
    Write-Host "APC System Check (Windows)" -ForegroundColor Cyan
    Write-Host "--------------------------"
    $map = [ordered]@{
        git = "Git"
        node = "Node.js (>=18)"
        python = "Python (>=3.8)"
        vs2022 = "Visual Studio C++"
        cmake = "CMake (>=3.22)"
        webview2 = "WebView2 Runtime"
        juce = "JUCE (>=9)"
        pluginval = "pluginval"
    }
    foreach ($key in $map.Keys) {
        $item = $obj.$key
        $ok = $false
        if ($null -ne $item -and $item.PSObject.Properties.Name -contains 'ok') {
            $ok = [bool]$item.ok
        }
        $label = $map[$key]
        if ($ok) {
            Write-Host ("  [OK]  {0}" -f $label) -ForegroundColor Green
        } else {
            Write-Host ("  [!!]  {0}" -f $label) -ForegroundColor Yellow
        }
    }
    if ($obj.apc_config -and $obj.apc_config.setup_completed) {
        Write-Host "  [OK]  apc.config.json setup completed" -ForegroundColor Green
    } else {
        Write-Host "  [--]  Run /apc-setup to create apc.config.json" -ForegroundColor DarkGray
    }
    Write-Host ""
}

switch ($Command) {
    "--check-all" {
        if ($Human) { Show-HumanSummary } else { Invoke-CheckAll }
    }
    "--human" { Show-HumanSummary }
    default {
        if ($Human) { Show-HumanSummary } else { Invoke-CheckAll }
    }
}
