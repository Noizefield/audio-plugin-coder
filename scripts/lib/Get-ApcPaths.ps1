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

function Get-ApcCodexConfig {
    param([string]$RepoRoot = (Get-ApcRepoRoot))
    $cfg = Read-ApcConfig -RepoRoot $RepoRoot
    if ($cfg.models -and $cfg.models.codex) {
        return $cfg.models.codex
    }
    return $null
}

function Get-ApcCodexTierForPhase {
<#
.SYNOPSIS
    Resolve Codex cost-tier name (luna|terra|sol|astra) for an APC phase.
#>
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )
    $builtin = @{
        setup  = "luna"
        status = "luna"
        resume = "luna"
        ship   = "luna"
        dream  = "terra"
        design = "terra"
        test   = "terra"
        plan   = "terra"
        impl   = "terra"
        debug  = "terra"
    }
    $codex = Get-ApcCodexConfig -RepoRoot $RepoRoot
    $key = $Phase.ToLowerInvariant()
    if ($codex -and $codex.phase_tiers -and $codex.phase_tiers.$key) {
        return [string]$codex.phase_tiers.$key
    }
    if ($codex -and $codex.default_tier) {
        return [string]$codex.default_tier
    }
    if ($builtin.ContainsKey($key)) {
        return $builtin[$key]
    }
    return "terra"
}

function Get-ApcCodexTierInfo {
<#
.SYNOPSIS
    Return model/profile/reasoning/max_attempts for a Codex tier name.
#>
    param(
        [Parameter(Mandatory = $true)][string]$Tier,
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )
    $codex = Get-ApcCodexConfig -RepoRoot $RepoRoot
    $name = $Tier.ToLowerInvariant()
    $defaults = @{
        luna  = @{ model = "gpt-5.6-luna";  profile = "luna";  reasoning = "low";    max_attempts = 1 }
        terra = @{ model = "gpt-5.6-terra"; profile = "terra"; reasoning = "medium"; max_attempts = 2 }
        sol   = @{ model = "gpt-5.6";       profile = "sol";   reasoning = "high";   max_attempts = 1 }
        astra = @{ model = "gpt-6-astra";   profile = "astra"; reasoning = "high";   max_attempts = 1 }
    }
    $base = $defaults[$name]
    if (-not $base) {
        return $null
    }
    if ($codex -and $codex.tiers -and $codex.tiers.$name) {
        $t = $codex.tiers.$name
        if ($t.model) { $base.model = [string]$t.model }
        if ($t.profile) { $base.profile = [string]$t.profile }
        if ($t.reasoning) { $base.reasoning = [string]$t.reasoning }
        if ($null -ne $t.max_attempts) { $base.max_attempts = [int]$t.max_attempts }
    }
    return [pscustomobject]@{
        Tier         = $name
        Model        = $base.model
        Profile      = $base.profile
        Reasoning    = $base.reasoning
        MaxAttempts  = [int]$base.max_attempts
    }
}

function Get-ApcCodexNextTier {
    param(
        [Parameter(Mandatory = $true)][string]$Tier,
        [string]$RepoRoot = (Get-ApcRepoRoot)
    )
    $codex = Get-ApcCodexConfig -RepoRoot $RepoRoot
    $order = @("luna", "terra", "sol", "astra")
    if ($codex -and $codex.escalation -and $codex.escalation.order) {
        $order = @($codex.escalation.order | ForEach-Object { [string]$_ })
    }
    $name = $Tier.ToLowerInvariant()
    $idx = [array]::IndexOf($order, $name)
    if ($idx -lt 0 -or $idx -ge ($order.Count - 1)) {
        return $null
    }
    return $order[$idx + 1]
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

function Test-ApcCMakeExe {
    <#
    .SYNOPSIS
        Returns $true when the given cmake.exe actually runs and reports a version.
        A stale pip/py "cmake" shim (e.g. from a 32-bit Python install) can sit on
        PATH, exit non-zero and print nothing; Get-Command alone cannot tell.
    #>
    param([string]$Exe)
    if (-not $Exe -or -not (Test-Path $Exe)) { return $false }
    try {
        $out = & $Exe --version 2>$null
        return ($LASTEXITCODE -eq 0 -and (($out -join "`n") -match 'cmake version'))
    } catch { return $false }
}

function Resolve-ApcCMakeExe {
    <#
    .SYNOPSIS
        Locate a WORKING cmake.exe: PATH first, then the copy bundled with any
        Visual Studio 2022 edition (via vswhere), then common standalone installs.
        Every candidate is verified with `cmake --version` before it is accepted.
    #>
    $cmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        if (Test-ApcCMakeExe $cmd.Source) { return $cmd.Source }
        Write-Warning "cmake on PATH does not run ($($cmd.Source)); looking for another install."
    }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        try {
            $found = & $vswhere -latest -products * -find "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" 2>$null
            foreach ($f in @($found)) {
                if ($f -and (Test-ApcCMakeExe $f)) { return $f }
            }
        } catch {}
    }

    $vsSuffix = "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    $candidates = @(
        (Join-Path $env:ProgramFiles "CMake\bin\cmake.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "CMake\bin\cmake.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\CMake\bin\cmake.exe")
    )
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        foreach ($edition in @("Community", "Professional", "Enterprise", "BuildTools")) {
            $candidates += (Join-Path $root "Microsoft Visual Studio\2022\$edition\$vsSuffix")
        }
    }
    foreach ($path in $candidates) {
        if ($path -and (Test-ApcCMakeExe $path)) { return $path }
    }
    return $null
}

function Initialize-ApcCMakePath {
    <#
    .SYNOPSIS
        Ensure `cmake` resolves to a working binary in this session. Prepends the
        resolved cmake directory to $env:PATH so it shadows any broken shim.
    #>
    $exe = Resolve-ApcCMakeExe
    if (-not $exe) {
        Write-Warning "No working cmake found on PATH or in a Visual Studio 2022 install. Install CMake >= 3.22 or the VS 'C++ CMake tools' component."
        return $false
    }
    $current = Get-Command cmake -ErrorAction SilentlyContinue
    if (-not $current -or $current.Source -ne $exe) {
        $env:PATH = (Split-Path $exe -Parent) + ";" + $env:PATH
        Write-Host "Using CMake: $exe" -ForegroundColor DarkGray
    }
    return $true
}
