<#
.SYNOPSIS
    Zips a folder with forward-slash entry names, so the archive unpacks the same on
    Windows, macOS and Linux.
.DESCRIPTION
    Compress-Archive in Windows PowerShell 5.1 (Microsoft.PowerShell.Archive 1.0.x) stores
    entry names with backslashes (Windows\VST3\Plugin.vst3\...). The zip format uses '/',
    so macOS and Linux unzip those entries as flat files whose names contain backslashes.
    This helper uses the .NET zip classes that ship with both Windows PowerShell 5.1 and
    PowerShell 7, so there is nothing to install.

    Dot-source it, then:
        New-ReleaseZip -SourceDir <folder> -DestinationZip <file.zip>
    The folder's contents go at the root of the zip, as with
    Compress-Archive -Path "<folder>\*". An existing destination file is replaced.
    Returns the full path of the zip.
#>

function New-ReleaseZip {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$DestinationZip
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) { throw "New-ReleaseZip: no folder at $SourceDir" }
    $src = (Get-Item -LiteralPath $SourceDir).FullName.TrimEnd('\', '/')
    # .NET resolves relative paths against the process directory, not the PowerShell location
    $dst = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationZip)
    $dstDir = Split-Path -Parent $dst
    if ($dstDir -and -not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }

    $zip = [System.IO.Compression.ZipFile]::Open($dst, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($item in Get-ChildItem -LiteralPath $src -Recurse -Force) {
            $name = $item.FullName.Substring($src.Length + 1).Replace('\', '/')
            if ($item.PSIsContainer) {
                $null = $zip.CreateEntry("$name/")   # keeps empty folders
            } else {
                $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zip, $item.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal)
            }
        }
    } finally {
        $zip.Dispose()
    }
    return $dst
}
