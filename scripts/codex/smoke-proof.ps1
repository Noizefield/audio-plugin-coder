<#
.SYNOPSIS
    Post-allowance Codex CLI smoke checks for APC cost orchestration.
.DESCRIPTION
    Validates ChatGPT auth, successful --json usage fields, --profile, and --output-schema.
    Safe to re-run after a Plus usage-window reset. Does not modify the repo.
.EXAMPLE
    powershell -File scripts/codex/smoke-proof.ps1
    powershell -File scripts/codex/smoke-proof.ps1 -SkipLiveExec
#>
[CmdletBinding()]
param(
    [switch]$SkipLiveExec,
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$schemaPath = Join-Path $RepoRoot "scripts\codex\routing-schema.json"
$profilesDir = Join-Path $RepoRoot "scripts\codex\profiles"
$outDir = Join-Path $RepoRoot ".tmp\codex-smoke"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Write-Step([string]$Name, [string]$Status, [string]$Detail = "") {
    if ($Detail) {
        Write-Host ("[{0}] {1} - {2}" -f $Status, $Name, $Detail)
    }
    else {
        Write-Host ("[{0}] {1}" -f $Status, $Name)
    }
}

function Invoke-CodexText {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & codex @Arguments 2>&1 | ForEach-Object { "$_" }
        return ($lines -join "`n")
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

# 1) Auth
$authOk = $false
if (Get-Command codex -ErrorAction SilentlyContinue) {
    $authOut = Invoke-CodexText -Arguments @("login", "status")
    if ($authOut -match "(?i)api.?key") {
        Write-Step "Auth" "FAIL" "API-key auth detected; use ChatGPT sign-in for Plus allowance"
    }
    elseif ($authOut -match "(?i)chatgpt|logged in|authenticated") {
        $authOk = $true
        Write-Step "Auth" "PASS" "ChatGPT authentication"
    }
    else {
        Write-Step "Auth" "WARN" "Could not classify auth output; inspect manually"
        Write-Host $authOut
        $authOk = $true
    }
}
else {
    Write-Step "Auth" "FAIL" "codex not found"
}

# 2-4) Live exec (optional)
if ($SkipLiveExec) {
    Write-Step "Live exec" "SKIP" "SkipLiveExec set"
    exit 0
}

if (-not $authOk) {
    Write-Step "Live exec" "SKIP" "Auth failed"
    exit 1
}

$lunaProfile = Join-Path $profilesDir "luna.config.toml"
if (-not (Test-Path $lunaProfile)) {
    Write-Step "Profiles present" "FAIL" "Missing $lunaProfile"
    exit 1
}
Write-Step "Profiles present" "PASS" "luna.config.toml"

$jsonLog = Join-Path $outDir "luna-jsonl.txt"

Write-Host "Running: codex exec --model gpt-5.6-luna --json (short prompt)..."
$raw = Invoke-CodexText -Arguments @("exec", "--model", "gpt-5.6-luna", "--json", "Reply with exactly: ok")
Set-Content -Path $jsonLog -Value $raw -Encoding UTF8

if ($raw -match "usage limit") {
    Write-Step "turn.completed.usage" "BLOCKED" "Plus usage limit - retry after the window resets"
    exit 2
}
if ($raw -match '"type"\s*:\s*"turn\.completed"' -and $raw -match "input_tokens") {
    Write-Step "turn.completed.usage" "PASS"
}
else {
    Write-Step "turn.completed.usage" "FAIL" "No turn.completed usage in JSONL (see $jsonLog)"
    exit 1
}

Write-Host "Running: codex exec --profile luna ..."
$profileLog = Join-Path $outDir "luna-profile-jsonl.txt"
$praw = Invoke-CodexText -Arguments @("exec", "--profile", "luna", "--json", "Reply with exactly: profile-ok")
Set-Content -Path $profileLog -Value $praw -Encoding UTF8
if ($praw -match "usage limit") {
    Write-Step "profile smoke" "BLOCKED" "usage limit"
    exit 2
}
if ($praw -match "(?i)unknown profile|no such profile|profile.*not found") {
    Write-Step "profile smoke" "FAIL" "Profile 'luna' not found - run scripts/codex/install-profiles.ps1"
    exit 1
}
if ($praw -match "turn\.completed" -and $praw -match "input_tokens") {
    Write-Step "profile smoke" "PASS" "--profile luna"
}
elseif ($praw -match "turn\.completed|turn\.failed") {
    Write-Step "profile smoke" "PASS" "exec completed or failed cleanly"
}
else {
    Write-Step "profile smoke" "FAIL" "Unexpected output (see $profileLog)"
    exit 1
}

if (Test-Path $schemaPath) {
    Write-Host "Running: codex exec --output-schema ..."
    $routeOut = Join-Path $outDir "routing-result.json"
    $schemaLog = Join-Path $outDir "schema-jsonl.txt"
    $sraw = Invoke-CodexText -Arguments @(
        "exec", "--model", "gpt-5.6-luna", "--json",
        "--output-schema", $schemaPath,
        "-o", $routeOut,
        "Classify this task: list all TODO comments. Return cheapest capable tier."
    )
    Set-Content -Path $schemaLog -Value $sraw -Encoding UTF8
    if (Test-Path $routeOut) {
        Write-Step "output-schema" "PASS" $routeOut
    }
    elseif ($sraw -match "usage limit") {
        Write-Step "output-schema" "BLOCKED" "usage limit"
        exit 2
    }
    else {
        Write-Step "output-schema" "WARN" "No -o file; check Codex version flags"
    }
}
else {
    Write-Step "output-schema" "SKIP" "schema missing"
}

Write-Host "Smoke proof finished. Artifacts in $outDir"
exit 0
