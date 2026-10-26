$ErrorActionPreference = 'Stop'

function Test-DotnetSdk {
    param([string]$Dotnet)

    if (-not (Test-Path $Dotnet)) {
        return $false
    }

    $sdks = & $Dotnet --list-sdks 2>$null
    return $LASTEXITCODE -eq 0 -and $sdks -and $sdks.Count -gt 0
}

# Prefer an SDK available through the current PATH.
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnetPath = if ($dotnet) { $dotnet.Source } else { $null }

if (-not (Test-DotnetSdk $dotnetPath)) {
    $privateSdk = Get-ChildItem "$env:TEMP" -Directory -Filter 'gsmct-dotnet-sdk-*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object {
            $candidate = Join-Path $_.FullName 'dotnet.exe'
            if (Test-DotnetSdk $candidate) {
                $candidate
                break
            }
        }

    if ($privateSdk) {
        $dotnetPath = $privateSdk
    }
}

if (-not (Test-DotnetSdk $dotnetPath)) {
    throw "No usable .NET SDK found."
}

Write-Host "Using .NET SDK: $dotnetPath"

$root = Split-Path -Parent $PSScriptRoot
& $dotnetPath format "$root\media-watcher\media-watcher.csproj"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
