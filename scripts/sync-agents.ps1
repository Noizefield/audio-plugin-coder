#Requires -Version 5.1
<#
.SYNOPSIS
  Syncs canonical APC worker profiles (.agents/agents/*.md) to
  host-specific subagent formats (.claude/agents, .opencode/agent).

.DESCRIPTION
  .agents/agents/*.md is the single source of truth (Devin reads it
  natively). This script emits per-host adapters:

    .claude/agents/<name>.md    Claude Code subagents (tools allowlist)
    .opencode/agent/<name>.md   OpenCode subagents (mode + tools map)

  Codex workers stay as TOML in .codex/agents/ (Codex-only fields);
  this script validates name parity (cheap-worker <-> cheap_worker.toml).

  Canonical frontmatter:
    name          worker identifier (hyphenated)
    description   shown to the orchestrator when picking a profile
    allowed-tools optional allowlist using canonical tool names:
                  read grep glob exec edit write web_search webfetch

.PARAMETER Check
  Verify adapters are up to date without writing files (CI mode).

.EXAMPLE
  powershell -File scripts/sync-agents.ps1
  powershell -File scripts/sync-agents.ps1 -Check
#>

[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$CanonDir   = Join-Path $RepoRoot '.agents\agents'
$ClaudeDir  = Join-Path $RepoRoot '.claude\agents'
$OpenCodeDir = Join-Path $RepoRoot '.opencode\agent'
$CodexDir   = Join-Path $RepoRoot '.codex\agents'

# Canonical tool name -> host-specific spellings
$ClaudeToolMap = @{
    read          = 'Read'
    grep          = 'Grep'
    glob          = 'Glob'
    exec          = 'Bash'
    edit          = 'Edit'
    write         = 'Write'
    web_search    = 'WebSearch'
    webfetch      = 'WebFetch'
    notebook_edit = 'NotebookEdit'
}
# canonical -> list of opencode tool keys granted
$OpenCodeToolMap = @{
    read          = @('read')
    grep          = @('grep')
    glob          = @('glob', 'list')
    exec          = @('bash')
    edit          = @('edit')
    write         = @('write')
    web_search    = @('webfetch')
    webfetch      = @('webfetch')
    notebook_edit = @('edit')
}
# opencode keys hard-disabled when a profile is restricted and the
# canonical grant does not include them
$OpenCodeDenyable = @('write', 'edit', 'patch')

function Read-AgentFile {
    param([string]$Path)

    $lines = Get-Content -LiteralPath $Path
    if ($lines.Count -lt 3 -or $lines[0] -ne '---') {
        throw "Missing YAML frontmatter: $Path"
    }

    $agent = [ordered]@{
        Name         = $null
        Description  = $null
        AllowedTools = $null
        Body         = ''
    }

    $i = 1
    $inTools = $false
    while ($i -lt $lines.Count -and $lines[$i] -ne '---') {
        $line = $lines[$i]
        if ($line -match '^\s{2,}-\s+(.+)$' -and $inTools) {
            if ($null -eq $agent.AllowedTools) { $agent.AllowedTools = @() }
            $agent.AllowedTools += $Matches[1].Trim()
        }
        elseif ($line -match '^([A-Za-z_-]+):\s*(.*)$') {
            $inTools = $false
            $key = $Matches[1]; $val = $Matches[2].Trim().Trim('"').Trim("'")
            switch ($key) {
                'name'          { $agent.Name = $val }
                'description'   { $agent.Description = $val }
                'allowed-tools' { $inTools = $true; if ($null -eq $agent.AllowedTools) { $agent.AllowedTools = @() } }
                'tools'         { $inTools = $true; if ($null -eq $agent.AllowedTools) { $agent.AllowedTools = @() } }
            }
        }
        $i++
    }

    if (-not $agent.Name) {
        $agent.Name = [IO.Path]::GetFileNameWithoutExtension($Path)
    }
    $agent.Body = ($lines[($i + 1)..($lines.Count - 1)] -join "`n").Trim()
    return $agent
}

function ConvertTo-ClaudeAgent {
    param($Agent)

    $fm = @('---', "name: $($Agent.Name)", "description: $($Agent.Description)")
    if ($null -ne $Agent.AllowedTools -and $Agent.AllowedTools.Count -gt 0) {
        $tools = ($Agent.AllowedTools | ForEach-Object {
            if ($ClaudeToolMap.ContainsKey($_)) { $ClaudeToolMap[$_] } else { $_ }
        }) -join ', '
        $fm += "tools: $tools"
    }
    $fm += '---'
    $stamp = "_Generated from .agents/agents/$($Agent.Name).md by scripts/sync-agents - do not edit._"
    return ($fm -join "`n") + "`n`n" + $stamp + "`n`n" + $Agent.Body + "`n"
}

function ConvertTo-OpenCodeAgent {
    param($Agent)

    $fm = @('---', "description: $($Agent.Description)", 'mode: subagent')
    if ($null -ne $Agent.AllowedTools -and $Agent.AllowedTools.Count -gt 0) {
        $granted = @{}
        foreach ($t in $Agent.AllowedTools) {
            if ($OpenCodeToolMap.ContainsKey($t)) {
                foreach ($k in $OpenCodeToolMap[$t]) { $granted[$k] = $true }
            }
            else { $granted[$t] = $true }
        }
        $fm += 'tools:'
        foreach ($k in ($granted.Keys | Sort-Object)) { $fm += "  ${k}: true" }
        foreach ($k in $OpenCodeDenyable) {
            if (-not $granted.ContainsKey($k)) { $fm += "  ${k}: false" }
        }
    }
    $fm += '---'
    $stamp = "_Generated from .agents/agents/$($Agent.Name).md by scripts/sync-agents - do not edit._"
    return ($fm -join "`n") + "`n`n" + $stamp + "`n`n" + $Agent.Body + "`n"
}

function Write-IfChanged {
    param([string]$Path, [string]$Content)

    $existing = if (Test-Path -LiteralPath $Path) {
        (Get-Content -LiteralPath $Path -Raw) -replace "`r`n", "`n"
    } else { $null }
    $newNorm = $Content -replace "`r`n", "`n"

    if ($existing -eq $newNorm) {
        Write-Host "  ok (unchanged): $Path"
        return $true
    }
    if ($Check) {
        Write-Warning "  stale: $Path"
        return $false
    }
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    # UTF-8 without BOM - a BOM before '---' breaks frontmatter parsers
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
    Write-Host "  wrote: $Path"
    return $true
}

# ---- main -----------------------------------------------------------------

if (-not (Test-Path $CanonDir)) {
    throw "Canonical agents directory not found: $CanonDir"
}

$mdFiles = Get-ChildItem -LiteralPath $CanonDir -Filter '*.md' -File
if (-not $mdFiles) { throw "No canonical worker profiles found in $CanonDir" }

$allOk = $true
Write-Host "Syncing $($mdFiles.Count) worker profile(s) from $CanonDir`n"

foreach ($file in $mdFiles) {
    $agent = Read-AgentFile -Path $file.FullName
    Write-Host "worker: $($agent.Name)"

    $claudePath   = Join-Path $ClaudeDir   "$($agent.Name).md"
    $opencodePath = Join-Path $OpenCodeDir "$($agent.Name).md"
    $allOk = (Write-IfChanged -Path $claudePath   -Content (ConvertTo-ClaudeAgent   $agent)) -and $allOk
    $allOk = (Write-IfChanged -Path $opencodePath -Content (ConvertTo-OpenCodeAgent $agent)) -and $allOk

    # Codex parity check (TOMLs remain hand-maintained — codex-only fields;
    # file name is hyphenated like the .md, the TOML name field is underscored)
    $tomlName = "$($agent.Name).toml"
    $tomlPath = Join-Path $CodexDir $tomlName
    if (Test-Path -LiteralPath $tomlPath) {
        Write-Host "  codex parity: $tomlName"
    } else {
        Write-Warning "  no Codex TOML for $($agent.Name) (expected .codex/agents/$tomlName)"
    }
    Write-Host ''
}

if ($Check -and -not $allOk) {
    Write-Error 'Adapters are stale — run scripts/sync-agents.'
    exit 1
}
Write-Host 'Done.'
