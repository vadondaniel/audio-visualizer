# Windows Global System Media Transport Controls watcher.
# Emits one compact JSON snapshot whenever the active media item changes.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$getAwaiter = ([System.WindowsRuntimeSystemExtensions].GetMember('GetAwaiter') |
  Where-Object {
    $_.IsGenericMethod -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1)

function Await-WinRt($operation, [type]$resultType) {
  return $getAwaiter.MakeGenericMethod($resultType).Invoke($null, @($operation)).GetResult()
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]

$lastKey = $null

while ($true) {
  try {
    $manager = Await-WinRt ($managerType::RequestAsync()) $managerType
    $session = $manager.GetCurrentSession()

    $snapshot = [ordered]@{
      available = $false
      playing = $false
      title = $null
      artist = $null
      album = $null
      albumArtist = $null
      thumbnailDataUrl = $null
      sourceApp = $null
    }

    if ($session) {
      $snapshot.available = $true
      $snapshot.sourceApp = [string]$session.SourceAppUserModelId

      $playback = $session.GetPlaybackInfo()
      $snapshot.playing = ([string]$playback.PlaybackStatus -eq 'Playing')

      $props = Await-WinRt ($session.TryGetMediaPropertiesAsync()) $mediaType
      if ($props) {
        $snapshot.title = [string]$props.Title
        $snapshot.artist = [string]$props.Artist
        $snapshot.album = [string]$props.AlbumTitle
        $snapshot.albumArtist = [string]$props.AlbumArtist

        if ($props.Thumbnail) {
          try {
            $stream = Await-WinRt ($props.Thumbnail.OpenReadAsync()) $streamType
            $size = [uint64]$stream.Size
            # Album art is normally tiny; cap pathological payloads so a broken
            # session can never flood stdout or the renderer.
            if ($size -gt 0 -and $size -le 4194304) {
              # Convert the WinRT input stream to a normal .NET stream and
              # copy it into memory. This is substantially less fragile than
              # driving DataReader.LoadAsync through PowerShell's WinRT type
              # adapter, especially for GSMTC thumbnail streams.
              $input = $stream.GetInputStreamAt(0)
              $managedStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($input)
              try {
                $memory = New-Object System.IO.MemoryStream
                $managedStream.CopyTo($memory)
                $bytes = $memory.ToArray()
                $memory.Dispose()
              } finally {
                $managedStream.Dispose()
                $input.Close()
                $stream.Close()
              }
              if ($bytes.Length -ne [int]$size) {
                throw "Thumbnail stream returned an unexpected byte count ($($bytes.Length) vs $size)."
              }
              $mime = [string]$stream.ContentType
              if ([string]::IsNullOrWhiteSpace($mime)) { $mime = 'image/jpeg' }
              $snapshot.thumbnailDataUrl = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
            }
          } catch {
            # Metadata remains useful without album art.
          }
        }
      }
    }

    $key = ($snapshot.available.ToString() + '|' +
      $snapshot.playing.ToString() + '|' +
      [string]$snapshot.title + '|' +
      [string]$snapshot.artist + '|' +
      [string]$snapshot.album + '|' +
      [string]$snapshot.albumArtist + '|' +
      [string]$snapshot.thumbnailDataUrl)

    if ($key -ne $lastKey) {
      $lastKey = $key
      $snapshot | ConvertTo-Json -Compress -Depth 4
      [Console]::Out.Flush()
    }
  } catch {
    if ($lastKey -ne 'error') {
      $lastKey = 'error'
      [Console]::Out.WriteLine('{"available":false,"playing":false,"title":null,"artist":null,"album":null,"albumArtist":null,"thumbnailDataUrl":null,"sourceApp":null}')
      [Console]::Out.Flush()
    }
  }

  Start-Sleep -Milliseconds 850
}
