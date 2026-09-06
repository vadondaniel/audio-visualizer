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

function Get-WinRtResult($operation, [type]$resultType) {
  return $getAwaiter.MakeGenericMethod($resultType).Invoke($null, @($operation)).GetResult()
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]

$lastKey = $null
$lastThumbnailErrorKey = $null

while ($true) {
  try {
    $manager = Get-WinRtResult ($managerType::RequestAsync()) $managerType
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

      $props = Get-WinRtResult ($session.TryGetMediaPropertiesAsync()) $mediaType
      if ($props) {
        $snapshot.title = [string]$props.Title
        $snapshot.artist = [string]$props.Artist
        $snapshot.album = [string]$props.AlbumTitle
        $snapshot.albumArtist = [string]$props.AlbumArtist

        if ($null -ne $props.Thumbnail) {
          try {
            $stream = Get-WinRtResult ($props.Thumbnail.OpenReadAsync()) $streamType
            # Read this before closing the WinRT stream below. Some Windows
            # media providers invalidate ContentType during/after cleanup.
            $mime = [string]$stream.ContentType
            # Do not impose a tiny byte cap here. Some media providers (notably
            # readers/ebooks) can expose perfectly valid cover art several MB in size.
            # The stream is already bounded by the provider and is only embedded in
            # a snapshot when the metadata actually changes.
            $randomAccessStreamType = [Windows.Storage.Streams.IRandomAccessStream]
            $asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethod(
              'AsStream', [type[]]@($randomAccessStreamType))
            $managedStream = $asStreamMethod.Invoke($null, @($stream))
            try {
              $memory = New-Object System.IO.MemoryStream
              $managedStream.CopyTo($memory)
              $bytes = $memory.ToArray()
              $memory.Dispose()
            } finally {
              $managedStream.Dispose()
            }
            if ($bytes.Length -eq 0 -or $bytes.Length -gt 16777216) {
              throw "Thumbnail stream returned an invalid byte count ($($bytes.Length))."
            }
            if ([string]::IsNullOrWhiteSpace($mime)) {
              # GSMTC occasionally omits ContentType. Use the common image
              # signatures so Chromium receives a valid data URL anyway.
              if ($bytes.Length -ge 8 -and
                  $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and
                  $bytes[2] -eq 0x4e -and $bytes[3] -eq 0x47) {
                $mime = 'image/png'
              } elseif ($bytes.Length -ge 3 -and
                  $bytes[0] -eq 0xff -and $bytes[1] -eq 0xd8 -and
                  $bytes[2] -eq 0xff) {
                $mime = 'image/jpeg'
              } elseif ($bytes.Length -ge 6 -and
                  [System.Text.Encoding]::ASCII.GetString($bytes, 0, 6) -eq 'GIF89a' -or
                  $bytes.Length -ge 6 -and
                  [System.Text.Encoding]::ASCII.GetString($bytes, 0, 6) -eq 'GIF87a') {
                $mime = 'image/gif'
              } else {
                $mime = 'image/jpeg'
              }
            }
            $snapshot.thumbnailDataUrl = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
            $lastThumbnailErrorKey = $null
          } catch {
            # Metadata remains useful without album art. Do not spam the same
            # error every polling cycle while a provider is transitioning media.
            $thumbnailErrorKey = (
              [string]$snapshot.sourceApp + '|' +
              [string]$snapshot.title + '|' +
              [string]$snapshot.artist + '|' +
              [string]$snapshot.album
            )
            if ($thumbnailErrorKey -ne $lastThumbnailErrorKey) {
              $lastThumbnailErrorKey = $thumbnailErrorKey
              [Console]::Error.WriteLine(('Thumbnail read error: ' + $_.Exception.Message))
              [Console]::Error.Flush()
            }
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
      [Console]::Error.WriteLine(('Media watcher error: ' + $_.Exception.Message))
      [Console]::Error.Flush()
      [Console]::Out.WriteLine('{"available":false,"playing":false,"title":null,"artist":null,"album":null,"albumArtist":null,"thumbnailDataUrl":null,"sourceApp":null}')
      [Console]::Out.Flush()
    }
  }

  Start-Sleep -Milliseconds 850
}
