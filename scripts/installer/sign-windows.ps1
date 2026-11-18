<#
.SYNOPSIS
    Authenticode-sign Windows plugin binaries / installers with signtool (APC release flow).

.DESCRIPTION
    Configuration comes ONLY from environment variables - nothing is hardcoded and no
    credential is ever printed (secrets are masked in -DryRun output and logs).
    If no signing configuration is present the script SKIPS with a clear message and
    exits 0 (the artifact is simply left unsigned); pass -Require to turn a skip into a failure.

    Methods (APC_SIGN_METHOD = azure | pfx | certstore, or auto-detected in that order):
      azure      Azure Trusted Signing through signtool + Azure.CodeSigning.Dlib
                   APC_SIGN_AZURE_DLIB      path to Azure.CodeSigning.Dlib.dll
                   APC_SIGN_AZURE_ENDPOINT  e.g. https://eus.codesigning.azure.net
                   APC_SIGN_AZURE_ACCOUNT   Trusted Signing account name
                   APC_SIGN_AZURE_PROFILE   certificate profile name
                   (Azure auth itself - az login / AZURE_TENANT_ID, AZURE_CLIENT_ID,
                    AZURE_CLIENT_SECRET - is handled by the Azure SDK, not by this script.)
      pfx        Certificate file
                   APC_SIGN_PFX_PATH        path to the .pfx
                   APC_SIGN_PFX_PASSWORD    optional password (visible to local process listings
                                            while signtool runs - prefer certstore on shared machines)
      certstore  Cert in a Windows store, e.g. an EV token or HSM
                   APC_SIGN_CERT_SHA1       thumbprint   (or)
                   APC_SIGN_CERT_SUBJECT    subject name substring
                   APC_SIGN_MACHINE_STORE   "1" to search the machine store (/sm)
                   (EV tokens prompt for the PIN through their own middleware.)

    Common:
      APC_SIGN_TIMESTAMP_URL  RFC 3161 server (default http://timestamp.digicert.com)
      APC_SIGNTOOL            explicit path to signtool.exe (else Windows SDK / PATH)

    After signing every file is verified with `signtool verify /pa`.

    REAL SIGNING WAS NOT EXERCISED when this script was written (no certificate available);
    only -DryRun output and PowerShell syntax were checked.

.PARAMETER Path
    One or more files to sign (.vst3 / .clap / .exe / .dll / .msi ...).

.PARAMETER DryRun
    Print the exact commands that would run, execute nothing, write nothing.

.PARAMETER Require
    Treat "no signing configuration" as an error (exit 1) instead of a skip.

.PARAMETER Method
    auto (default), azure, pfx or certstore. Overrides APC_SIGN_METHOD.

.PARAMETER TimestampUrl
    Overrides APC_SIGN_TIMESTAMP_URL.

.EXAMPLE
    .\scripts\installer\sign-windows.ps1 -DryRun release\MyPlugin-1.0.0-Windows-Setup.exe

.NOTES
    Exit codes: 0 signed or skipped, 1 failed (or skipped with -Require), 2 usage.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Path,
    [switch]$DryRun,
    [switch]$Require,
    [ValidateSet('auto', 'azure', 'pfx', 'certstore')]
    [string]$Method = 'auto',
    [string]$TimestampUrl
)

$ErrorActionPreference = 'Stop'

function Get-Env([string]$Name) {
    $v = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($v)) { return $null }
    return $v
}

function New-Arg([string]$Value, [switch]$Secret) {
    [pscustomobject]@{ Value = $Value; Secret = [bool]$Secret }
}

function Format-Command([string]$Exe, [object[]]$CmdArgs) {
    $exeText = if ($Exe -match '[\s"]') { '"' + $Exe + '"' } else { $Exe }
    $parts = @($exeText) + @($CmdArgs | ForEach-Object {
        $t = if ($_.Secret) { '********' } else { $_.Value }
        if ($t -match '[\s"]') { '"' + ($t -replace '"', '\"') + '"' } else { $t }
    })
    return ($parts -join ' ')
}

function Invoke-Tool([string]$Exe, [object[]]$CmdArgs) {
    if ($DryRun) {
        Write-Host ("[dry-run] " + (Format-Command $Exe $CmdArgs))
        return 0
    }
    Write-Host ("> " + (Format-Command $Exe $CmdArgs))
    & $Exe @($CmdArgs | ForEach-Object { $_.Value })
    return $LASTEXITCODE
}

function Find-SignTool {
    $explicit = Get-Env 'APC_SIGNTOOL'
    if ($explicit) { return $explicit }
    $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if ($kits -and (Test-Path $kits)) {
        $hit = Get-ChildItem -Path $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' } |
            Sort-Object FullName -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

function Skip([string]$Reason) {
    Write-Host "SKIPPED (artifacts NOT signed): $Reason" -ForegroundColor Yellow
    if ($Require) { Write-Host 'ERROR: -Require was given, so a skipped signing step is a failure.' -ForegroundColor Red; exit 1 }
    exit 0
}

# --- resolve method ---------------------------------------------------------
$azureVars   = 'APC_SIGN_AZURE_DLIB', 'APC_SIGN_AZURE_ENDPOINT', 'APC_SIGN_AZURE_ACCOUNT', 'APC_SIGN_AZURE_PROFILE'
$azureMissing = @($azureVars | Where-Object { -not (Get-Env $_) })
$haveAzure   = $azureMissing.Count -eq 0
$havePfx     = [bool](Get-Env 'APC_SIGN_PFX_PATH')
$haveStore   = [bool]((Get-Env 'APC_SIGN_CERT_SHA1') -or (Get-Env 'APC_SIGN_CERT_SUBJECT'))

$chosen = $Method
if ($chosen -eq 'auto') { $chosen = Get-Env 'APC_SIGN_METHOD' }
if (-not $chosen -or $chosen -eq 'auto') {
    if ($haveAzure) { $chosen = 'azure' } elseif ($havePfx) { $chosen = 'pfx' } elseif ($haveStore) { $chosen = 'certstore' } else { $chosen = $null }
}
if (-not $chosen) {
    Skip ('no signing configuration in the environment. Set one of: ' +
          'APC_SIGN_AZURE_{DLIB,ENDPOINT,ACCOUNT,PROFILE} (Azure Trusted Signing), ' +
          'APC_SIGN_PFX_PATH [+ APC_SIGN_PFX_PASSWORD] (pfx), ' +
          'APC_SIGN_CERT_SHA1 or APC_SIGN_CERT_SUBJECT (certificate store / EV token). See scripts/installer/README.md.')
}
if ($chosen -notin @('azure', 'pfx', 'certstore')) { Write-Host "ERROR: unknown APC_SIGN_METHOD '$chosen'" -ForegroundColor Red; exit 2 }

switch ($chosen) {
    'azure'     { if (-not $haveAzure)  { Skip ("method 'azure' selected but missing: " + ($azureMissing -join ', ')) } }
    'pfx'       { if (-not $havePfx)    { Skip "method 'pfx' selected but APC_SIGN_PFX_PATH is not set" } }
    'certstore' { if (-not $haveStore)  { Skip "method 'certstore' selected but neither APC_SIGN_CERT_SHA1 nor APC_SIGN_CERT_SUBJECT is set" } }
}

$ts = if ($TimestampUrl) { $TimestampUrl } elseif (Get-Env 'APC_SIGN_TIMESTAMP_URL') { Get-Env 'APC_SIGN_TIMESTAMP_URL' } else { 'http://timestamp.digicert.com' }

$signtool = Find-SignTool
if (-not $signtool) {
    if ($DryRun) { $signtool = 'signtool.exe'; Write-Host '[dry-run] note: signtool.exe not found here; the command below uses the bare name' }
    else { Write-Host 'ERROR: signtool.exe not found (install the Windows SDK or set APC_SIGNTOOL).' -ForegroundColor Red; exit 1 }
}

if (-not $DryRun) {
    foreach ($p in $Path) { if (-not (Test-Path -LiteralPath $p)) { Write-Host "ERROR: file not found: $p" -ForegroundColor Red; exit 1 } }
    if ($chosen -eq 'pfx' -and -not (Test-Path -LiteralPath (Get-Env 'APC_SIGN_PFX_PATH'))) {
        Write-Host 'ERROR: APC_SIGN_PFX_PATH does not exist.' -ForegroundColor Red; exit 1
    }
    if ($chosen -eq 'azure' -and -not (Test-Path -LiteralPath (Get-Env 'APC_SIGN_AZURE_DLIB'))) {
        Write-Host 'ERROR: APC_SIGN_AZURE_DLIB does not exist.' -ForegroundColor Red; exit 1
    }
}

Write-Host "Signing method: $chosen   timestamp: $ts"

# --- azure metadata file ----------------------------------------------------
$metadataPath = $null
if ($chosen -eq 'azure') {
    $metadata = [ordered]@{
        Endpoint               = Get-Env 'APC_SIGN_AZURE_ENDPOINT'
        CodeSigningAccountName = Get-Env 'APC_SIGN_AZURE_ACCOUNT'
        CertificateProfileName = Get-Env 'APC_SIGN_AZURE_PROFILE'
    } | ConvertTo-Json
    if ($DryRun) {
        $metadataPath = Join-Path ([IO.Path]::GetTempPath()) 'apc-azure-signing-metadata.json'
        Write-Host "[dry-run] would write $metadataPath :"
        Write-Host $metadata
    } else {
        $metadataPath = Join-Path ([IO.Path]::GetTempPath()) ("apc-azure-signing-" + [guid]::NewGuid().ToString('N') + '.json')
        Set-Content -LiteralPath $metadataPath -Value $metadata -Encoding UTF8
    }
}

# --- sign + verify ----------------------------------------------------------
$failed = 0
try {
    foreach ($file in $Path) {
        $a = @((New-Arg 'sign'), (New-Arg '/fd'), (New-Arg 'SHA256'), (New-Arg '/tr'), (New-Arg $ts), (New-Arg '/td'), (New-Arg 'SHA256'))
        switch ($chosen) {
            'azure' {
                $a += @((New-Arg '/v'), (New-Arg '/dlib'), (New-Arg (Get-Env 'APC_SIGN_AZURE_DLIB')), (New-Arg '/dmdf'), (New-Arg $metadataPath))
            }
            'pfx' {
                $a += @((New-Arg '/f'), (New-Arg (Get-Env 'APC_SIGN_PFX_PATH')))
                if (Get-Env 'APC_SIGN_PFX_PASSWORD') { $a += @((New-Arg '/p'), (New-Arg (Get-Env 'APC_SIGN_PFX_PASSWORD') -Secret)) }
            }
            'certstore' {
                if (Get-Env 'APC_SIGN_CERT_SHA1') { $a += @((New-Arg '/sha1'), (New-Arg (Get-Env 'APC_SIGN_CERT_SHA1'))) }
                else { $a += @((New-Arg '/n'), (New-Arg (Get-Env 'APC_SIGN_CERT_SUBJECT'))) }
                if ((Get-Env 'APC_SIGN_MACHINE_STORE') -eq '1') { $a += (New-Arg '/sm') }
            }
        }
        $a += (New-Arg $file)

        $rc = Invoke-Tool $signtool $a
        if ($rc -ne 0) { Write-Host "ERROR: signtool sign failed ($rc) for $file" -ForegroundColor Red; $failed++; continue }

        $rc = Invoke-Tool $signtool @((New-Arg 'verify'), (New-Arg '/pa'), (New-Arg '/v'), (New-Arg $file))
        if ($rc -ne 0) { Write-Host "ERROR: signtool verify failed ($rc) for $file" -ForegroundColor Red; $failed++ }
    }
}
finally {
    if ($metadataPath -and -not $DryRun -and (Test-Path -LiteralPath $metadataPath)) { Remove-Item -LiteralPath $metadataPath -Force }
}

if ($failed -gt 0) { exit 1 }
if ($DryRun) { Write-Host 'DRY RUN complete - nothing was signed.' } else { Write-Host "Signed and verified $($Path.Count) file(s)." }
exit 0
