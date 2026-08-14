<#
.SYNOPSIS
    Resolve APC paths from apc.config.json (plugins / build / release).
.DESCRIPTION
    Dot-source this script, then call Get-ApcPaths. Relative paths resolve from the repo root.
#>

function Get-ApcRepoRoot {
    # This file lives in scripts/lib/ — repo root is two levels up.
    $candidates = @(
        (Join-Path $PSScriptRoot "..\.."),
        (Join-Path $PSScriptRoot ".."),
        (Get-Location).Path
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "CMakeLists.txt")) {
            return (Resolve-Path $candidate).Path
        }
    }
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-ApcDefaultConfig {
    return [ordered]@{
        version = 1
        juce = @{
            required_major = 9
            pin = "9.0.1"
        }
        paths = @{
            plugins_dir = "plugins"
            build_dir = "build"
            release_dir = "release"
        }
        defaults = @{
            ui_framework_preference = "webview"
            enable_visage = $false
        }
        models = @{
            profile = "balanced"
            phases = @{}
        }
        setup = @{
            completed = $false
            completed_at = $null
            platform = $null
        }
    }
}

function Read-ApcConfig {
    param(
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )

    $configPath = Join-Path $RepoRoot "apc.config.json"
    $examplePath = Join-Path $RepoRoot "apc.config.example.json"

    if (Test-Path $configPath) {
        return Get-Content $configPath -Raw | ConvertFrom-Json
    }
    if (Test-Path $examplePath) {
        return Get-Content $examplePath -Raw | ConvertFrom-Json
    }
    return (Get-ApcDefaultConfig | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
}

function Resolve-ApcPath {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue,
        [Parameter(Mandatory = $true)][string]$RepoRoot
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        throw "Empty path value"
    }
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $PathValue))
}

function Get-ApcPaths {
<#
.SYNOPSIS
    Returns resolved absolute paths for plugins, build, and release directories.
#>
    param(
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )

    $cfg = Read-ApcConfig -RepoRoot $RepoRoot
    $pluginsRel = if ($cfg.paths.plugins_dir) { $cfg.paths.plugins_dir } else { "plugins" }
    $buildRel = if ($cfg.paths.build_dir) { $cfg.paths.build_dir } else { "build" }
    $releaseRel = if ($cfg.paths.release_dir) { $cfg.paths.release_dir } else { "release" }

    $plugins = Resolve-ApcPath -PathValue $pluginsRel -RepoRoot $RepoRoot
    $build = Resolve-ApcPath -PathValue $buildRel -RepoRoot $RepoRoot
    $release = Resolve-ApcPath -PathValue $releaseRel -RepoRoot $RepoRoot

    return [pscustomobject]@{
        RepoRoot     = $RepoRoot
        ConfigPath   = (Join-Path $RepoRoot "apc.config.json")
        PluginsDir   = $plugins
        BuildDir     = $build
        ReleaseDir   = $release
        PluginsRel   = $pluginsRel
        BuildRel     = $buildRel
        ReleaseRel   = $releaseRel
        Config       = $cfg
    }
}

function Get-ApcPluginPath {
    param(
        [Parameter(Mandatory = $true)][string]$PluginName,
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )
    $paths = Get-ApcPaths -RepoRoot $RepoRoot
    return (Join-Path $paths.PluginsDir $PluginName)
}

function Get-ApcModelForPhase {
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )
    $cfg = Read-ApcConfig -RepoRoot $RepoRoot
    if ($cfg.models -and $cfg.models.phases -and $cfg.models.phases.$Phase) {
        return $cfg.models.phases.$Phase
    }
    return $null
}

function Write-ApcConfig {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )
    $path = Join-Path $RepoRoot "apc.config.json"
    $json = $Config | ConvertTo-Json -Depth 12
    Set-Content -Path $path -Value $json -Encoding UTF8
    return $path
}

function Test-ApcSetupCompleted {
    param([string]$RepoRoot = (Get-ApcRepoRoot))
    $cfg = Read-ApcConfig -RepoRoot $RepoRoot
    return [bool]($cfg.setup -and $cfg.setup.completed)
}
