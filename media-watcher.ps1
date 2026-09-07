# Windows Global System Media Transport Controls watcher.
# Event-driven: no polling of the GSMTC API. Metadata/artwork is fetched only
# when Windows reports a relevant media-session event.
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
[Windows.Media.Control.GlobalSystemMediaTransportControlsSession,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.CurrentSessionChangedEventArgs,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.MediaPropertiesChangedEventArgs,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.PlaybackInfoChangedEventArgs,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$sessionType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSession]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$randomAccessStreamType = [Windows.Storage.Streams.IRandomAccessStream]
$asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethod(
  'AsStream', [type[]]@($randomAccessStreamType))

# WinRT events cannot be subscribed with Register-ObjectEvent in Windows
# PowerShell 5.1. Use the projected add_*/remove_* methods directly with the
# correctly typed TypedEventHandler delegates instead.
$eventSignal = [System.Threading.AutoResetEvent]::new($false)
$eventQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

function Queue-MediaEvent([string]$name) {
  try {
    $script:eventQueue.Enqueue($name) | Out-Null
    $script:eventSignal.Set() | Out-Null
  } catch {
    # Never let an event callback escape an exception back into WinRT.
  }
}

$currentSession = $null
$currentSessionGeneration = 0
$managerEventToken = $null
$sessionMediaEventToken = $null
$sessionPlaybackEventToken = $null
$managerHandler = $null
$sessionMediaHandler = $null
$sessionPlaybackHandler = $null

$lastMediaKey = $null
$lastSnapshotKey = $null
$cachedThumbnailDataUrl = $null
$lastThumbnailErrorKey = $null
$cachedMetadata = @{
  title = $null
  artist = $null
  album = $null
  albumArtist = $null
  sourceApp = $null
}

function New-EmptySnapshot {
  return [ordered]@{
    available = $false
    playing = $false
    title = $null
    artist = $null
    album = $null
    albumArtist = $null
    thumbnailDataUrl = $null
    sourceApp = $null
  }
}

function Get-CurrentPlaybackState($session) {
  if ($null -eq $session) { return $false }
  try {
    $playback = $session.GetPlaybackInfo()
    return ([string]$playback.PlaybackStatus -eq 'Playing')
  } catch {
    return $false
  }
}

function Get-MediaProperties($session) {
  if ($null -eq $session) { return $null }
  return Get-WinRtResult ($session.TryGetMediaPropertiesAsync()) $mediaType
}

function Get-MediaKey($metadata) {
  return ([string]$metadata.sourceApp + '|' +
    [string]$metadata.title + '|' +
    [string]$metadata.artist + '|' +
    [string]$metadata.album + '|' +
    [string]$metadata.albumArtist)
}

function Read-ThumbnailDataUrl($props, $metadata) {
  if ($null -eq $props -or $null -eq $props.Thumbnail) {
    return $null
  }

  try {
    $stream = Get-WinRtResult ($props.Thumbnail.OpenReadAsync()) $streamType
    $mime = [string]$stream.ContentType
    $managedStream = $asStreamMethod.Invoke($null, @($stream))
    try {
      $memory = New-Object System.IO.MemoryStream
      try {
        $managedStream.CopyTo($memory)
        $bytes = $memory.ToArray()
      } finally {
        $memory.Dispose()
      }
    } finally {
      $managedStream.Dispose()
    }

    if ($bytes.Length -eq 0 -or $bytes.Length -gt 16777216) {
      throw "Thumbnail stream returned an invalid byte count ($($bytes.Length))."
    }

    if ([string]::IsNullOrWhiteSpace($mime)) {
      if ($bytes.Length -ge 8 -and
          $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and
          $bytes[2] -eq 0x4e -and $bytes[3] -eq 0x47) {
        $mime = 'image/png'
      } elseif ($bytes.Length -ge 3 -and
          $bytes[0] -eq 0xff -and $bytes[1] -eq 0xd8 -and $bytes[2] -eq 0xff) {
        $mime = 'image/jpeg'
      } elseif ($bytes.Length -ge 6 -and
          (([System.Text.Encoding]::ASCII.GetString($bytes, 0, 6) -eq 'GIF89a') -or
           ([System.Text.Encoding]::ASCII.GetString($bytes, 0, 6) -eq 'GIF87a'))) {
        $mime = 'image/gif'
      } else {
        $mime = 'image/jpeg'
      }
    }

    return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
  } catch {
    $thumbnailErrorKey = (
      [string]$metadata.sourceApp + '|' +
      [string]$metadata.title + '|' +
      [string]$metadata.artist + '|' +
      [string]$metadata.album
    )
    if ($thumbnailErrorKey -ne $script:lastThumbnailErrorKey) {
      $script:lastThumbnailErrorKey = $thumbnailErrorKey
      [Console]::Error.WriteLine(('Thumbnail read error: ' + $_.Exception.Message))
      [Console]::Error.Flush()
    }
    return $null
  }
}

function Publish-Snapshot {
  param(
    [switch]$RefreshMediaProperties,
    [bool]$PlaybackStateChanged = $false
  )

  try {
    $session = $script:currentSession
    $snapshot = New-EmptySnapshot

    if ($null -eq $session) {
      $script:cachedMetadata = @{
        title = $null
        artist = $null
        album = $null
        albumArtist = $null
        sourceApp = $null
      }
      $script:lastMediaKey = $null
      $script:cachedThumbnailDataUrl = $null
      $script:lastThumbnailErrorKey = $null
    } elseif ($RefreshMediaProperties) {
      $snapshot.available = $true
      $metadata = @{
        sourceApp = [string]$session.SourceAppUserModelId
        title = $null
        artist = $null
        album = $null
        albumArtist = $null
      }

      $props = Get-MediaProperties $session
      if ($null -ne $props) {
        $metadata.title = [string]$props.Title
        $metadata.artist = [string]$props.Artist
        $metadata.album = [string]$props.AlbumTitle
        $metadata.albumArtist = [string]$props.AlbumArtist

        $mediaKey = Get-MediaKey $metadata
        $mediaChanged = ($mediaKey -ne $script:lastMediaKey)

        if ($mediaChanged) {
          # This is the ONLY place artwork is read. A playback event does not
          # call TryGetMediaPropertiesAsync, and duplicate property events for
          # the same media item do not re-open or re-encode the thumbnail.
          $script:cachedThumbnailDataUrl = Read-ThumbnailDataUrl $props $metadata
          $script:lastMediaKey = $mediaKey
          $script:lastThumbnailErrorKey = $null
        }

        $script:cachedMetadata = $metadata
      }

      $snapshot.title = $script:cachedMetadata.title
      $snapshot.artist = $script:cachedMetadata.artist
      $snapshot.album = $script:cachedMetadata.album
      $snapshot.albumArtist = $script:cachedMetadata.albumArtist
      $snapshot.sourceApp = $script:cachedMetadata.sourceApp
      $snapshot.thumbnailDataUrl = $script:cachedThumbnailDataUrl
      $snapshot.playing = Get-CurrentPlaybackState $session
    } else {
      # PlaybackInfoChanged: reuse the cached media metadata/artwork verbatim.
      $snapshot.available = $true
      $snapshot.title = $script:cachedMetadata.title
      $snapshot.artist = $script:cachedMetadata.artist
      $snapshot.album = $script:cachedMetadata.album
      $snapshot.albumArtist = $script:cachedMetadata.albumArtist
      $snapshot.sourceApp = $script:cachedMetadata.sourceApp
      $snapshot.thumbnailDataUrl = $script:cachedThumbnailDataUrl
      $snapshot.playing = Get-CurrentPlaybackState $session
    }

    $snapshotKey = ([string]$snapshot.available + '|' +
      [string]$snapshot.playing + '|' +
      [string]$snapshot.title + '|' +
      [string]$snapshot.artist + '|' +
      [string]$snapshot.album + '|' +
      [string]$snapshot.albumArtist + '|' +
      [string]$snapshot.sourceApp + '|' +
      [string]$snapshot.thumbnailDataUrl)

    if ($snapshotKey -ne $script:lastSnapshotKey) {
      $script:lastSnapshotKey = $snapshotKey
      $snapshot | ConvertTo-Json -Compress -Depth 4
      [Console]::Out.Flush()
    }
  } catch {
    if ($script:lastSnapshotKey -ne 'error') {
      $script:lastSnapshotKey = 'error'
      [Console]::Error.WriteLine(('Media watcher error: ' + $_.Exception.Message))
      [Console]::Error.Flush()
      [Console]::Out.WriteLine('{"available":false,"playing":false,"title":null,"artist":null,"album":null,"albumArtist":null,"thumbnailDataUrl":null,"sourceApp":null}')
      [Console]::Out.Flush()
    }
  }
}

function Unregister-SessionEvents {
  $session = $script:currentSession

  if ($null -ne $session -and $null -ne $script:sessionMediaEventToken -and $null -ne $script:sessionMediaHandler) {
    try { $session.remove_MediaPropertiesChanged($script:sessionMediaEventToken) } catch {}
  }
  if ($null -ne $session -and $null -ne $script:sessionPlaybackEventToken -and $null -ne $script:sessionPlaybackHandler) {
    try { $session.remove_PlaybackInfoChanged($script:sessionPlaybackEventToken) } catch {}
  }

  $script:sessionMediaEventToken = $null
  $script:sessionPlaybackEventToken = $null
  $script:sessionMediaHandler = $null
  $script:sessionPlaybackHandler = $null
}

function Set-CurrentSession($session) {
  Unregister-SessionEvents

  $script:currentSession = $session
  $script:currentSessionGeneration++
  $generation = $script:currentSessionGeneration

  $script:lastMediaKey = $null
  $script:cachedThumbnailDataUrl = $null
  $script:lastThumbnailErrorKey = $null
  $script:cachedMetadata = @{
    title = $null
    artist = $null
    album = $null
    albumArtist = $null
    sourceApp = $null
  }

  if ($null -eq $session) {
    Publish-Snapshot -RefreshMediaProperties
    return
  }

  $mediaScript = {
    param($sender, $args)
    Queue-MediaEvent ("session.media.$generation")
  }.GetNewClosure()
  $playbackScript = {
    param($sender, $args)
    Queue-MediaEvent ("session.playback.$generation")
  }.GetNewClosure()

  $script:sessionMediaHandler = [Windows.Foundation.TypedEventHandler[Windows.Media.Control.GlobalSystemMediaTransportControlsSession,Windows.Media.Control.MediaPropertiesChangedEventArgs]]$mediaScript
  $script:sessionPlaybackHandler = [Windows.Foundation.TypedEventHandler[Windows.Media.Control.GlobalSystemMediaTransportControlsSession,Windows.Media.Control.PlaybackInfoChangedEventArgs]]$playbackScript

  $script:sessionMediaEventToken = $session.add_MediaPropertiesChanged($script:sessionMediaHandler)
  $script:sessionPlaybackEventToken = $session.add_PlaybackInfoChanged($script:sessionPlaybackHandler)

  # Initial read for this newly selected session. This is not polling.
  Publish-Snapshot -RefreshMediaProperties
}

# ---- Event subscriptions ----

$manager = $null
$managerEventToken = $null
$managerHandler = $null
$sessionMediaEventToken = $null
$sessionPlaybackEventToken = $null
$sessionMediaHandler = $null
$sessionPlaybackHandler = $null
$currentSession = $null
$currentSessionGeneration = 0

try {
  # Acquire the manager once and keep it alive. Windows calls the handler when
  # the current session changes; there is no GetCurrentSession() polling loop.
  $manager = Get-WinRtResult ($managerType::RequestAsync()) $managerType

  $managerScript = {
    param($sender, $args)
    Queue-MediaEvent 'manager.current'
  }.GetNewClosure()
  $managerHandler = [Windows.Foundation.TypedEventHandler[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control.CurrentSessionChangedEventArgs]]$managerScript
  $managerEventToken = $manager.add_CurrentSessionChanged($managerHandler)

  Set-CurrentSession ($manager.GetCurrentSession())

  while ($true) {
    # Block until one or more WinRT events signal the queue. There is no timer,
    # sleep, or media API polling here.
    $eventSignal.WaitOne() | Out-Null

    $eventName = $null
    while ($eventQueue.TryDequeue([ref]$eventName)) {
      if ($eventName -eq 'manager.current') {
        Set-CurrentSession ($manager.GetCurrentSession())
        continue
      }

      if ($eventName -like 'session.media.*') {
        $generationText = $eventName.Substring('session.media.'.Length)
        if ([int]$generationText -eq $script:currentSessionGeneration) {
          Publish-Snapshot -RefreshMediaProperties
        }
        continue
      }

      if ($eventName -like 'session.playback.*') {
        $generationText = $eventName.Substring('session.playback.'.Length)
        if ([int]$generationText -eq $script:currentSessionGeneration) {
          Publish-Snapshot
        }
      }
    }
  }
} finally {
  Unregister-SessionEvents
  if ($null -ne $manager -and $null -ne $managerEventToken -and $null -ne $managerHandler) {
    try { $manager.remove_CurrentSessionChanged($managerEventToken) } catch {}
  }
  if ($null -ne $eventSignal) { $eventSignal.Dispose() }
}
