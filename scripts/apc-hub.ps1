<#
.SYNOPSIS
    Start the APC Hub live dashboard (read-only command center).
.DESCRIPTION
    Launches hub/server.js (Node stdlib only, loopback 127.0.0.1) and opens
    the dashboard in the default browser. The server never writes, builds,
    or executes anything.
.PARAMETER Port
    Local port to listen on. Default 4872.
.PARAMETER NoOpen
    Start the server without opening the browser.
#>
param(
    [int]$Port = 4872,
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Server = Join-Path $RepoRoot 'hub' 'server.js'
$Node = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source

if (-not (Test-Path $Server)) { throw "Hub server not found: $Server" }
if (-not $Node) { throw 'Node.js (>=18) is required for APC Hub. See docs/hub.md.' }

$NodeArgs = @($Server, '--port', "$Port")
if ($NoOpen) { $NodeArgs += '--no-open' }

Write-Host "-> APC Hub starting (http://localhost:$Port/)" -ForegroundColor Cyan
& $Node @NodeArgs
