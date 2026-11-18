<#
.SYNOPSIS
  Idempotent shallow fetch of the pinned JUCE tag (PowerShell twin of juce-shallow-clone.sh).

.DESCRIPTION
  Building block for `apc doctor --fix` and for checkouts with no git history
  (npx / zip installs) or a failed submodule init. Fetches one tag at depth 1
  into _tools/JUCE. If Dest already holds the tag it only verifies it.
  A non-empty Dest at another version is never overwritten unless -Force, which
  fetches the tag into the existing git checkout (nothing is deleted).

.PARAMETER Tag   JUCE release tag. Default: juce.pin from apc.config.json, else apc.config.example.json.
.PARAMETER Dest  Target directory. Default: <repo root>/_tools/JUCE
.PARAMETER Repo  Remote. Default: https://github.com/juce-framework/JUCE.git
.PARAMETER Force Fetch the tag into an existing, different checkout.
.PARAMETER Quiet Suppress progress output.

.NOTES
  Exit codes: 0 ok (already present or cloned+verified), 1 failed, 2 usage.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\lib\juce-shallow-clone.ps1
  powershell -ExecutionPolicy Bypass -File scripts\lib\juce-shallow-clone.ps1 -Tag 9.0.1 -Dest D:\JUCE
#>
[CmdletBinding()]
param(
    [string]$Tag = '',
    [string]$Dest = '',
    [string]$Repo = 'https://github.com/juce-framework/JUCE.git',
    [switch]$Force,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Dest) { $Dest = Join-Path $Root '_tools\JUCE' }

function Say([string]$m) { if (-not $Quiet) { Write-Host $m } }
function Fail([string]$m) { [Console]::Error.WriteLine("juce-shallow-clone: $m"); exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git is not installed' }

function Read-Pin([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return '' }
    try {
        $cfg = (Get-Content -Raw -LiteralPath $file -Encoding UTF8) -replace '^\uFEFF', '' | ConvertFrom-Json
        if ($cfg.juce -and $cfg.juce.pin) { return [string]$cfg.juce.pin }
    } catch { }
    return ''
}

if (-not $Tag) {
    $Tag = Read-Pin (Join-Path $Root 'apc.config.json')
    if (-not $Tag) { $Tag = Read-Pin (Join-Path $Root 'apc.config.example.json') }
    if (-not $Tag) { Fail 'no juce.pin found in apc.config.json / apc.config.example.json; pass -Tag' }
}
if ($Tag -notmatch '^\d+\.\d+\.\d+$') { Fail "tag '$Tag' does not look like a JUCE release tag (expected MAJOR.MINOR.PATCH, e.g. 9.0.1)" }

function Test-GitCheckout([string]$dir) {
    & git -C $dir rev-parse --git-dir *> $null
    return ($LASTEXITCODE -eq 0)
}

function Get-HeaderVersion {
    $h = Join-Path $Dest 'modules\juce_core\system\juce_StandardHeader.h'
    if (-not (Test-Path -LiteralPath $h)) { return '' }
    $t = Get-Content -Raw -LiteralPath $h
    $maj = [regex]::Match($t, '(?m)^#define\s+JUCE_MAJOR_VERSION\s+(\d+)')
    $min = [regex]::Match($t, '(?m)^#define\s+JUCE_MINOR_VERSION\s+(\d+)')
    $pat = [regex]::Match($t, '(?m)^#define\s+JUCE_BUILDNUMBER\s+(\d+)')
    if ($maj.Success -and $min.Success -and $pat.Success) { return "$($maj.Groups[1].Value).$($min.Groups[1].Value).$($pat.Groups[1].Value)" }
    return ''
}

# Returns '' when Dest is JUCE at exactly $Tag, else the reason.
function Test-Verify {
    if (-not (Test-Path -LiteralPath (Join-Path $Dest 'CMakeLists.txt'))) { return "no CMakeLists.txt in $Dest" }
    if (Test-GitCheckout $Dest) {
        $actual = (& git -C $Dest describe --tags --exact-match HEAD 2>$null)
        if ($LASTEXITCODE -ne 0) { $actual = '' }
        if ("$actual".Trim() -ne $Tag) { return "checkout is at '$("$actual".Trim())', wanted '$Tag'" }
    }
    $hv = Get-HeaderVersion
    if ($hv -and $hv -ne $Tag) { return "juce_StandardHeader.h reports $hv, wanted $Tag" }
    return ''
}

$nonEmpty = (Test-Path -LiteralPath $Dest) -and ($null -ne (Get-ChildItem -LiteralPath $Dest -Force | Select-Object -First 1))
if ($nonEmpty) {
    $reason = Test-Verify
    if (-not $reason) { Say "JUCE $Tag already present at $Dest"; exit 0 }
    if (-not $Force) { Fail "$Dest exists but is not JUCE $Tag ($reason). Re-run with -Force to fetch the tag into the existing checkout (nothing is deleted)." }
    if (-not (Test-GitCheckout $Dest)) { Fail "$Dest is not a git checkout; move it away or choose -Dest" }
    Say "fetching JUCE $Tag into existing checkout $Dest (depth 1)"
    & git -C $Dest fetch --depth 1 $Repo "refs/tags/${Tag}:refs/tags/${Tag}"
    if ($LASTEXITCODE -ne 0) { Fail "could not fetch tag $Tag from $Repo" }
    & git -C $Dest checkout --quiet --detach "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) { Fail "could not check out $Tag" }
} else {
    Say "cloning JUCE $Tag (depth 1) into $Dest"
    $parent = Split-Path -Parent $Dest
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    & git clone --quiet --depth 1 --branch $Tag $Repo $Dest
    if ($LASTEXITCODE -ne 0) { Fail "git clone of tag $Tag from $Repo failed (wrong tag? offline?)" }
}

$reason = Test-Verify
if (-not $reason) { Say "JUCE $Tag ready at $Dest"; exit 0 }
Fail "verification failed after fetch: $reason"
