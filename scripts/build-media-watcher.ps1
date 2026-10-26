$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'media-watcher\media-watcher.csproj'
$out = Join-Path $root 'media-watcher\publish'

function Find-DotNetSdk {
    $candidates = @()
    $cmd = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    $standard = 'C:\Program Files\dotnet\dotnet.exe'
    if (Test-Path $standard) { $candidates += $standard }
    $tempPattern = Join-Path $env:TEMP 'gsmct-dotnet-sdk-*\dotnet.exe'
    $candidates += @(Get-ChildItem $tempPattern -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -ExpandProperty FullName)
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        try {
            $sdks = & $candidate --list-sdks 2>$null
            if ($LASTEXITCODE -eq 0 -and @($sdks).Count -gt 0) { return $candidate }
        }
        catch {}
    }
    return $null
}

$dotnet = Find-DotNetSdk
if (-not $dotnet) {
    throw 'No .NET SDK found. Install the .NET 10 SDK and rerun build.bat.'
}

Write-Host "Using .NET SDK: $dotnet"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
& $dotnet publish $project -c Release -r win-x64 --self-contained true -o $out /p:PublishSingleFile=true /p:InvariantGlobalization=true
if ($LASTEXITCODE -ne 0) { throw "Native media watcher build failed (exit code $LASTEXITCODE)." }

$exe = Join-Path $out 'media-watcher.exe'
if (-not (Test-Path $exe)) { throw "Publish succeeded but $exe was not produced." }
Write-Host "Media watcher ready: $exe"

