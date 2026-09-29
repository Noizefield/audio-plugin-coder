<#
.SYNOPSIS
    Deploy built VST3 bundles and launch standalone plugin builds.
.DESCRIPTION
    Scans <build_dir>/plugins/<Name>/<Name>_artefacts/<Config>/ for:
      - VST3 bundles  (VST3/*.vst3)        -> copied to paths.vst3_install_dir
                                              from apc.config.json
                                              (default: C:\Program Files\Common Files\VST3)
      - Standalone apps (Standalone/*.exe) -> launched directly, no install needed
    Picker: numbered console list for standalones and -Menu mode;
    Out-GridView for VST3 installs when available (-NoGrid forces the list).
.EXAMPLE
    .\copy-vst3.ps1                          # interactive VST3 picker
    .\copy-vst3.ps1 -Menu                    # launcher menu (used by copy-vst3.bat)
    .\copy-vst3.ps1 -Standalone              # pick a standalone .exe and run it
    .\copy-vst3.ps1 -Standalone -Latest      # launch the newest standalone build
    .\copy-vst3.ps1 -Standalone -Names XENON # launch the XENON standalone, no prompt
    .\copy-vst3.ps1 -All                     # install every built VST3 bundle
    .\copy-vst3.ps1 -Latest                  # install only the newest VST3 artifact
    .\copy-vst3.ps1 -Names NoizeMeter,XENON  # install VST3s by name, no prompt
    .\copy-vst3.ps1 -Destination D:\VST3Test # override install folder
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string[]]$Names,
    [switch]$All,
    [switch]$Latest,
    [string]$Destination,
    [switch]$NoGrid,
    [switch]$Standalone,
    [switch]$Menu
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib\Get-ApcPaths.ps1"

# --- Artifact scanning -----------------------------------------------------

function Get-Vst3Artifacts {
    param([Parameter(Mandatory = $true)][string]$PluginsBuildRoot)

    foreach ($pluginDir in (Get-ChildItem $PluginsBuildRoot -Directory -ErrorAction SilentlyContinue)) {
        foreach ($artefactsDir in (Get-ChildItem $pluginDir.FullName -Directory -Filter "*_artefacts" -ErrorAction SilentlyContinue)) {
            foreach ($configDir in (Get-ChildItem $artefactsDir.FullName -Directory -ErrorAction SilentlyContinue)) {
                $vst3Dir = Join-Path $configDir.FullName "VST3"
                if (-not (Test-Path $vst3Dir)) { continue }
                foreach ($bundle in (Get-ChildItem $vst3Dir -Directory -Filter "*.vst3" -ErrorAction SilentlyContinue)) {
                    $size = (Get-ChildItem $bundle.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
                        Measure-Object -Property Length -Sum).Sum
                    [pscustomobject]@{
                        Plugin = $pluginDir.Name
                        Bundle = $bundle.Name
                        Config = $configDir.Name
                        Built  = $bundle.LastWriteTime
                        SizeMB = [math]::Round(($size / 1MB), 1)
                        Path   = $bundle.FullName
                    }
                }
            }
        }
    }
}

function Get-StandaloneArtifacts {
    param([Parameter(Mandatory = $true)][string]$PluginsBuildRoot)

    $seen = @{}
    foreach ($pluginDir in (Get-ChildItem $PluginsBuildRoot -Directory -ErrorAction SilentlyContinue)) {
        foreach ($artefactsDir in (Get-ChildItem $pluginDir.FullName -Directory -Filter "*_artefacts" -ErrorAction SilentlyContinue)) {
            # <artefacts>/<Config>/Standalone for multi-config generators,
            # <artefacts>/Standalone for layouts without a config level.
            $standaloneDirs = @(Get-ChildItem $artefactsDir.FullName -Directory -Recurse -Depth 1 -Filter "Standalone" -ErrorAction SilentlyContinue)
            foreach ($standaloneDir in $standaloneDirs) {
                $configName = Split-Path (Split-Path $standaloneDir.FullName -Parent) -Leaf
                if ($configName -eq $artefactsDir.Name) { $configName = "(default)" }
                foreach ($exe in (Get-ChildItem $standaloneDir.FullName -File -Filter "*.exe" -ErrorAction SilentlyContinue)) {
                    if ($seen.ContainsKey($exe.FullName)) { continue }
                    $seen[$exe.FullName] = $true
                    [pscustomobject]@{
                        Plugin = $pluginDir.Name
                        Bundle = $exe.Name
                        Config = $configName
                        Built  = $exe.LastWriteTime
                        SizeMB = [math]::Round(($exe.Length / 1MB), 1)
                        Path   = $exe.FullName
                    }
                }
            }
        }
    }
}

# --- Selection helpers -----------------------------------------------------

function Read-ArtifactSelection {
    param([Parameter(Mandatory = $true)][array]$Items)

    Write-Host ("     {0,-26} {1,-7} {2,-16} {3,7}" -f "NAME", "CONFIG", "BUILT", "SIZE") -ForegroundColor DarkGray
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $a = $Items[$i]
        Write-Host ("{0,3}) {1,-26} {2,-7} {3,-16} {4,6} MB" -f ($i + 1), $a.Bundle, $a.Config, $a.Built.ToString("yyyy-MM-dd HH:mm"), $a.SizeMB)
    }

    $choice = (Read-Host "`nSelect number(s), e.g. 1,3 or 2-4 ('all', empty to cancel)").Trim()
    if ([string]::IsNullOrWhiteSpace($choice)) { return @() }
    if ($choice -match '^(all|a|\*)$') { return $Items }

    $picked = foreach ($token in ($choice -split '[,\s]+' | Where-Object { $_ })) {
        if ($token -match '^(\d+)-(\d+)$') {
            $lo = [int]$Matches[1]; $hi = [int]$Matches[2]
            if ($lo -gt $hi) { $tmp = $lo; $lo = $hi; $hi = $tmp }
            for ($n = $lo; $n -le $hi; $n++) { $n }
        }
        elseif ($token -match '^\d+$') { [int]$token }
        else { Write-Warning "Ignoring '$token' - not a number or range." }
    }

    $result = @()
    foreach ($n in ($picked | Sort-Object -Unique)) {
        if ($n -ge 1 -and $n -le $Items.Count) { $result += $Items[$n - 1] }
        else { Write-Warning "Ignoring $n - out of range (1-$($Items.Count))." }
    }
    return $result
}

function Select-Artifacts {
    param(
        [Parameter(Mandatory = $true)][array]$Artifacts,
        [Parameter(Mandatory = $true)][string]$GridTitle,
        [Parameter(Mandatory = $true)][string]$ListTitle,
        [switch]$ConsoleOnly
    )

    if ($All)    { return $Artifacts }
    if ($Latest) { return @($Artifacts[0]) }
    if ($Names) {
        $wanted = @($Names | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $result = @()
        foreach ($w in $wanted) {
            $found = @($Artifacts | Where-Object {
                $_.Plugin -eq $w -or $_.Bundle -eq $w -or
                $_.Bundle -eq "$w.vst3" -or $_.Bundle -eq "$w.exe"
            })
            if ($found.Count -eq 0) { Write-Warning "No built artifact matches '$w'." }
            $result += $found
        }
        return @($result | Sort-Object Path -Unique)
    }

    $useGrid = (-not $NoGrid) -and (-not $ConsoleOnly) -and
        [bool](Get-Command Out-GridView -ErrorAction SilentlyContinue)
    if ($useGrid) {
        return @($Artifacts | Out-GridView -Title $GridTitle -PassThru)
    }
    Write-Host "`n$ListTitle (newest first):" -ForegroundColor Cyan
    return @(Read-ArtifactSelection -Items $Artifacts)
}

# Debug and Release of the same plugin share one bundle name / destination.
# Keep a single artifact per bundle name: Release preferred, then newest.
function Select-PreferredConfig {
    param([Parameter(Mandatory = $true)][array]$Selected)

    $deduped = @($Selected |
        Sort-Object @{ Expression = { $_.Config -eq 'Release' }; Descending = $true }, @{ Expression = 'Built'; Descending = $true } |
        Group-Object Bundle | ForEach-Object { $_.Group[0] })
    if ($deduped.Count -lt $Selected.Count) {
        Write-Host "Note: several configs share the same name; keeping Release/newest per artifact." -ForegroundColor DarkYellow
    }
    return $deduped
}

# --- Flows -----------------------------------------------------------------

function Invoke-Vst3Deploy {
    [CmdletBinding(SupportsShouldProcess)]
    param()

    Write-Host "--- APC VST3 DEPLOY ---" -ForegroundColor Cyan
    Write-Host "Builds:      $pluginsRoot" -ForegroundColor DarkGray
    Write-Host "Destination: $InstallDir" -ForegroundColor DarkGray

    $artifacts = @(Get-Vst3Artifacts -PluginsBuildRoot $pluginsRoot | Sort-Object Built -Descending)
    if ($artifacts.Count -eq 0) {
        Write-Host "No built VST3 bundles found under $pluginsRoot" -ForegroundColor Yellow
        return
    }

    $selected = @(Select-Artifacts -Artifacts $artifacts `
        -GridTitle "Select VST3 bundles to install -> $InstallDir (Ctrl/Shift-click for multi-select)" `
        -ListTitle "Built VST3 bundles" -ConsoleOnly:$Menu)
    if ($selected.Count -eq 0) {
        Write-Host "Nothing selected." -ForegroundColor Yellow
        return
    }

    $selected = @(Select-PreferredConfig -Selected $selected)

    # --- Destination writability / elevation ---------------------------------
    $isWindows = ($env:OS -eq 'Windows_NT')
    $elevated = $false
    if ($isWindows) {
        $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
    }

    if (-not $WhatIfPreference) {
        $writable = $false
        try {
            if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
            $probe = Join-Path $InstallDir (".apc_write_test_{0}" -f [guid]::NewGuid().ToString("N"))
            New-Item -ItemType File -Path $probe -Force | Out-Null
            Remove-Item $probe -Force
            $writable = $true
        }
        catch { $writable = $false }

        if (-not $writable) {
            if ($isWindows -and -not $elevated -and $PSCommandPath) {
                $bundleNames = ($selected | ForEach-Object { $_.Bundle }) -join ','
                $answer = (Read-Host "'$InstallDir' needs administrator rights. Relaunch elevated? [Y/n]").Trim()
                if ($answer -notmatch '^[nN]') {
                    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Destination `"$InstallDir`" -Names `"$bundleNames`""
                    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList
                    Write-Host "Relaunched with elevation - continue in the new window." -ForegroundColor Cyan
                    exit 0
                }
            }
            Write-Warning "Destination '$InstallDir' is not writable. Copies will likely fail."
        }
    }

    # --- Copy -----------------------------------------------------------------
    Write-Host ""
    $copied = 0
    $failed = 0
    foreach ($a in $selected) {
        $dest = Join-Path $InstallDir $a.Bundle
        if ($PSCmdlet.ShouldProcess($dest, "Copy $($a.Bundle) [$($a.Config)]")) {
            try {
                if (Test-Path $dest) { Remove-Item -Path $dest -Recurse -Force -ErrorAction Stop }
                Copy-Item -Path $a.Path -Destination $dest -Recurse -Force -ErrorAction Stop
                Write-Host "[OK] $($a.Bundle) ($($a.Config)) -> $dest" -ForegroundColor Green
                $copied++
            }
            catch {
                $failed++
                Write-Warning "Failed: $($a.Bundle) - $($_.Exception.Message) (If a DAW has it loaded, close the DAW and retry.)"
            }
        }
    }

    Write-Host ""
    $summaryColor = if ($failed -gt 0) { "Yellow" } else { "Green" }
    Write-Host "Done: $copied copied, $failed failed." -ForegroundColor $summaryColor
    if ($failed -gt 0) { exit 1 }
}

function Invoke-StandaloneRun {
    [CmdletBinding(SupportsShouldProcess)]
    param()

    if ($Destination) {
        Write-Host "Note: -Destination only applies to VST3 installs; ignoring it." -ForegroundColor DarkYellow
    }

    Write-Host "--- APC STANDALONE LAUNCHER ---" -ForegroundColor Cyan
    Write-Host "Builds: $pluginsRoot" -ForegroundColor DarkGray

    $apps = @(Get-StandaloneArtifacts -PluginsBuildRoot $pluginsRoot | Sort-Object Built -Descending)
    if ($apps.Count -eq 0) {
        Write-Host "No standalone builds found under $pluginsRoot" -ForegroundColor Yellow
        Write-Host "(JUCE writes them to <plugin>_artefacts\<Config>\Standalone\*.exe - build a Standalone target first.)" -ForegroundColor DarkGray
        return
    }

    $selected = @(Select-Artifacts -Artifacts $apps `
        -GridTitle "Select standalone apps to launch (Ctrl/Shift-click for multi-select)" `
        -ListTitle "Built standalone apps" -ConsoleOnly)
    if ($selected.Count -eq 0) {
        Write-Host "Nothing selected." -ForegroundColor Yellow
        return
    }

    $selected = @(Select-PreferredConfig -Selected $selected)

    Write-Host ""
    foreach ($a in $selected) {
        if ($PSCmdlet.ShouldProcess($a.Path, "Launch $($a.Bundle) [$($a.Config)]")) {
            try {
                Start-Process -FilePath $a.Path -WorkingDirectory (Split-Path $a.Path -Parent) -ErrorAction Stop
                Write-Host "[OK] Launched $($a.Bundle) ($($a.Config))" -ForegroundColor Green
            }
            catch {
                Write-Warning "Failed to launch $($a.Bundle) - $($_.Exception.Message)"
            }
        }
    }
}

# --- Dispatch ---------------------------------------------------------------

$ApcPaths = Get-ApcPaths
$InstallDir = if ($Destination) { [System.IO.Path]::GetFullPath($Destination) } else { $ApcPaths.Vst3InstallDir }
$pluginsRoot = Join-Path $ApcPaths.BuildDir "plugins"

if (-not (Test-Path $pluginsRoot)) {
    throw "Plugin build folder not found: $pluginsRoot"
}

if ($Menu) {
    while ($true) {
        Write-Host ""
        Write-Host "=== APC PLUGIN LAUNCHER ===" -ForegroundColor Cyan
        Write-Host "  [1] Install VST3 bundles -> $InstallDir"
        Write-Host "  [2] Launch a standalone build"
        Write-Host "  [Q] Quit"
        $m = (Read-Host "Choice").Trim()
        switch -Regex ($m) {
            '^1$'           { Invoke-Vst3Deploy }
            '^2$'           { Invoke-StandaloneRun }
            '^(q|quit|exit)$' { exit 0 }
            default         { Write-Host "Invalid choice '$m'." -ForegroundColor Yellow }
        }
    }
}
elseif ($Standalone) {
    Invoke-StandaloneRun
}
else {
    Invoke-Vst3Deploy
}
