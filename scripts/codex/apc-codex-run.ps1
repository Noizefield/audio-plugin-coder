<#
.SYNOPSIS
    Cost-aware Codex CLI runner for APC (ChatGPT auth, tier routing, JSONL usage log).
.DESCRIPTION
    Deterministic heuristics (and optional phase map from models.codex) pick luna/terra/sol/astra,
    then invoke `codex exec --json`. Aborts on API-key auth when require_chatgpt_auth is true,
    and on Plus usage-limit errors. Optional bounded escalation after a failed verify command.
.EXAMPLE
    pwsh -File scripts/codex/apc-codex-run.ps1 -Phase status -Prompt "Summarize VinylNoize status.json"
    pwsh -File scripts/codex/apc-codex-run.ps1 -Prompt "find TODOs in Source/" -DryRun
    pwsh -File scripts/codex/apc-codex-run.ps1 -Phase impl -Prompt "Implement the requested change" -EscalateOnVerifyFail
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Prompt,

    [string]$Phase = "",
    [ValidateSet("", "luna", "terra", "sol", "astra")]
    [string]$Tier = "",
    [string]$RepoRoot = "",
    [string]$PluginName = "",
    [switch]$DryRun,
    [switch]$SkipAuthCheck,
    [switch]$EscalateOnVerifyFail,
    [string]$VerifyCommand = "",
    [switch]$UseProfile,
    [string]$WorkingDirectory = ""
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "..\lib\Get-ApcPaths.ps1")

if (-not $RepoRoot) {
    $RepoRoot = Get-ApcRepoRoot
}
if (-not $WorkingDirectory) {
    $WorkingDirectory = $RepoRoot
}

$codexCfg = Get-ApcCodexConfig -RepoRoot $RepoRoot

function Get-HeuristicTier([string]$Text) {
    $t = $Text.ToLowerInvariant()
    $solHints = @(
        "architecture", "race condition", "root cause", "security", "distributed",
        "migration", "intermittent", "complex state", "concurrency", "deadlock"
    )
    foreach ($h in $solHints) {
        if ($t.Contains($h)) { return "sol" }
    }
    $lunaHints = @(
        "find ", "list ", "search", "extract", "summarize", "format ", "rename",
        "locate", "grep", "document this small", "todo"
    )
    foreach ($h in $lunaHints) {
        if ($t.Contains($h)) { return "luna" }
    }
    $terraHints = @(
        "implement", "add endpoint", "write tests", "refactor", "update dependency",
        "fix ", "bug"
    )
    foreach ($h in $terraHints) {
        if ($t.Contains($h)) { return "terra" }
    }
    return $null
}

function Resolve-InitialTier {
    if ($Tier) { return $Tier.ToLowerInvariant() }
    $h = Get-HeuristicTier -Text $Prompt
    if ($h) { return $h }
    if ($Phase) {
        $p = Get-ApcCodexTierForPhase -Phase $Phase -RepoRoot $RepoRoot
        if ($p) { return $p }
    }
    if ($codexCfg -and $codexCfg.default_tier) {
        return [string]$codexCfg.default_tier
    }
    return "terra"
}

function Test-ChatGptAuth {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        throw "codex CLI not found on PATH"
    }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = (& codex login status 2>&1 | ForEach-Object { "$_" }) -join "`n"
    }
    finally {
        $ErrorActionPreference = $prev
    }
    $require = $true
    if ($codexCfg -and $null -ne $codexCfg.require_chatgpt_auth) {
        $require = [bool]$codexCfg.require_chatgpt_auth
    }
    if ($require -and ($out -match "(?i)api.?key")) {
        throw "Codex is authenticated with an API key. Sign in with ChatGPT (codex login) to stay on Plus allowance, or set models.codex.require_chatgpt_auth=false."
    }
    return $out.Trim()
}

function Get-UsageLogPath {
    $rel = ".tmp/codex-usage"
    if ($codexCfg -and $codexCfg.usage_log_dir) {
        $rel = [string]$codexCfg.usage_log_dir
    }
    $dir = if ([System.IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $RepoRoot $rel }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    return (Join-Path $dir "usage.jsonl")
}

function Write-UsageRecord($Record) {
    $path = Get-UsageLogPath
    ($Record | ConvertTo-Json -Compress -Depth 8) | Add-Content -Path $path -Encoding UTF8
}

function Invoke-CodexExec {
    param(
        [Parameter(Mandatory = $true)]$TierInfo,
        [Parameter(Mandatory = $true)][string]$TaskPrompt
    )

    $argList = [System.Collections.Generic.List[string]]::new()
    $argList.Add("exec") | Out-Null
    if ($UseProfile) {
        $argList.Add("--profile") | Out-Null
        $argList.Add($TierInfo.Profile) | Out-Null
    }
    else {
        $argList.Add("--model") | Out-Null
        $argList.Add($TierInfo.Model) | Out-Null
    }
    $argList.Add("--json") | Out-Null
    $argList.Add("-C") | Out-Null
    $argList.Add($WorkingDirectory) | Out-Null
    $argList.Add($TaskPrompt) | Out-Null

    Write-Host ("codex {0}" -f ($argList -join " "))
    $jsonlPath = Join-Path ([System.IO.Path]::GetTempPath()) ("apc-codex-{0}.jsonl" -f [guid]::NewGuid().ToString("n"))
    $exitCode = 0
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & codex @($argList.ToArray()) 2>&1 | ForEach-Object { "$_" }
        $exitCode = $LASTEXITCODE
        Set-Content -Path $jsonlPath -Value ($output -join "`n") -Encoding UTF8
        $output | ForEach-Object { Write-Host $_ }
    }
    catch {
        $exitCode = 1
        $_ | Out-File -FilePath $jsonlPath -Append
    }
    finally {
        $ErrorActionPreference = $prev
    }

    $raw = if (Test-Path $jsonlPath) { Get-Content $jsonlPath -Raw } else { "" }
    $usageLimit = $raw -match "(?i)usage limit"
    $usage = $null
    foreach ($line in (Get-Content $jsonlPath -ErrorAction SilentlyContinue)) {
        if ($line -match '^\s*\{') {
            try {
                $obj = $line | ConvertFrom-Json
                if ($obj.type -eq "turn.completed" -and $obj.usage) {
                    $usage = $obj.usage
                }
            }
            catch { }
        }
    }

    return [pscustomobject]@{
        ExitCode   = $exitCode
        JsonlPath  = $jsonlPath
        Raw        = $raw
        UsageLimit = [bool]$usageLimit
        Usage      = $usage
        Success    = (-not $usageLimit) -and ($exitCode -eq 0)
    }
}

function Invoke-Verify {
    param([string]$Command)
    if (-not $Command) { return $null }
    Write-Host "Verify: $Command"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Invoke-Expression $Command | Out-Host
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        Write-Warning $_.Exception.Message
        return $false
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

# --- main ---
$authStatus = $null
if (-not $SkipAuthCheck) {
    $authStatus = Test-ChatGptAuth
}

$currentTier = Resolve-InitialTier
$escalationEnabled = $false
if ($EscalateOnVerifyFail) { $escalationEnabled = $true }
elseif ($codexCfg -and $codexCfg.escalation -and $codexCfg.escalation.enabled) {
    $escalationEnabled = [bool]$codexCfg.escalation.enabled
}

$verifyCmd = $VerifyCommand
if (-not $verifyCmd -and $codexCfg -and $codexCfg.escalation -and $codexCfg.escalation.verify_command) {
    $verifyCmd = [string]$codexCfg.escalation.verify_command
}
if (-not $verifyCmd -and $PluginName -and $escalationEnabled) {
    $ps = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
    if ($env:OS -match "Windows" -or $IsWindows) {
        $verifyCmd = "$ps -NoProfile -File `"$RepoRoot\scripts\build-and-install.ps1`" -PluginName $PluginName"
    }
    else {
        $verifyCmd = "bash `"$RepoRoot/scripts/build-and-install.sh`" $PluginName"
    }
}

Write-Host "APC Codex run: tier=$currentTier phase=$Phase dryRun=$DryRun escalate=$escalationEnabled"

if ($DryRun) {
    $info = Get-ApcCodexTierInfo -Tier $currentTier -RepoRoot $RepoRoot
    [pscustomobject]@{
        Tier      = $info.Tier
        Model     = $info.Model
        Profile   = $info.Profile
        Reasoning = $info.Reasoning
        Prompt    = $Prompt
        Auth      = $authStatus
    } | ConvertTo-Json -Depth 5
    exit 0
}

$attempted = @()
$maxEscalations = 3
$escalationCount = 0

while ($true) {
    $info = Get-ApcCodexTierInfo -Tier $currentTier -RepoRoot $RepoRoot
    if (-not $info) { throw "Unknown tier: $currentTier" }
    $attempted += $currentTier

    $attempts = [Math]::Max(1, [int]$info.MaxAttempts)
    $last = $null
    $attemptOk = $false
    for ($i = 1; $i -le $attempts; $i++) {
        Write-Host "Attempt $i/$attempts on tier $($info.Tier) ($($info.Model))"
        $last = Invoke-CodexExec -TierInfo $info -TaskPrompt $Prompt
        if ($last.UsageLimit) {
            Write-UsageRecord @{
                timestamp   = (Get-Date).ToString("o")
                phase       = $Phase
                tier        = $info.Tier
                model       = $info.Model
                usage_limit = $true
                verified    = $false
                escalated   = $false
            }
            throw "Codex usage limit hit. Check https://chatgpt.com/codex/settings/usage and retry after the window resets."
        }

        $verified = $null
        if ($last.Success -and $verifyCmd) {
            $verified = Invoke-Verify -Command $verifyCmd
        }
        elseif ($last.Success -and -not $verifyCmd) {
            $verified = $true
        }
        else {
            $verified = $false
        }

        Write-UsageRecord @{
            timestamp            = (Get-Date).ToString("o")
            phase                = $Phase
            tier                 = $info.Tier
            model                = $info.Model
            input_tokens         = if ($last.Usage) { $last.Usage.input_tokens } else { $null }
            cached_input_tokens  = if ($last.Usage) { $last.Usage.cached_input_tokens } else { $null }
            output_tokens        = if ($last.Usage) { $last.Usage.output_tokens } else { $null }
            exit_code            = $last.ExitCode
            verified             = [bool]$verified
            escalated            = $false
            jsonl                = $last.JsonlPath
        }

        if ($verified) {
            $attemptOk = $true
            break
        }
    }

    if ($attemptOk) {
        Write-Host "Done on tier $($info.Tier)"
        exit 0
    }

    if (-not $escalationEnabled) {
        throw "Codex run failed on tier $($info.Tier) (exit $($last.ExitCode)). Re-run with -EscalateOnVerifyFail or enable models.codex.escalation.enabled."
    }

    $next = Get-ApcCodexNextTier -Tier $currentTier -RepoRoot $RepoRoot
    if (-not $next) {
        throw "Escalation exhausted after tiers: $($attempted -join ', ')"
    }
    $escalationCount++
    if ($escalationCount -gt $maxEscalations) {
        throw "Escalation budget exceeded"
    }
    Write-Host "Escalating $($info.Tier) -> $next"
    Write-UsageRecord @{
        timestamp = (Get-Date).ToString("o")
        phase     = $Phase
        tier      = $info.Tier
        model     = $info.Model
        escalated = $true
        next_tier = $next
    }
    $currentTier = $next
}
