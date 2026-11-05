using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

internal static class Program
{
    private static readonly Dictionary<GlobalSystemMediaTransportControlsSession, SessionRegistration> Sessions = new();
    private static readonly JsonSerializerOptions JsonOptions = new();

    private static GlobalSystemMediaTransportControlsSessionManager? _manager;
    private static MediaSnapshot _snapshot = EmptySnapshot();
    private static readonly RefreshPump Pump = new();
    private static readonly CancellationTokenSource Stop = new();
    private static bool _diagnostic;
    private static string _lastOutputKey = "";

    private sealed class SessionRegistration
    {
        public required TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> MediaChanged { get; init; }
        public required TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> PlaybackChanged { get; init; }
    }

    private static MediaSnapshot EmptySnapshot() => new()
    {
        available = false,
        playing = false,
        title = null,
        artist = null,
        album = null,
        albumArtist = null,
        thumbnailDataUrl = null,
        sourceApp = null,
    };

    public static int Main(string[] args)
    {
        _diagnostic = args.Length == 2 && args[0] == "--diagnose";
        if (args.Length != 0 && (!_diagnostic || !int.TryParse(args[1], out var seconds) || seconds < 1 || seconds > 86400))
        {
            Console.Error.WriteLine("Usage: media-watcher [--diagnose <seconds: 1..86400>]");
            return 2;
        }
        if (_diagnostic) Stop.CancelAfter(TimeSpan.FromSeconds(int.Parse(args[1])));
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            Stop.Cancel();
        };

        try
        {
            RunAsync().GetAwaiter().GetResult();
            return 0;
        }
        catch (Exception ex)
        {
            LogError("Fatal error: " + ex);
            Emit(EmptySnapshot());
            return 1;
        }
    }

    private static async Task RunAsync()
    {
        Log("GSMTC native media watcher starting");
        Log("Runtime=" + Environment.Version + " OS=" + Environment.OSVersion);
        Log("Direct WinRT GSMTC events; no continuous polling");

        _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask(Stop.Token);
        if (_manager == null)
            throw new InvalidOperationException("GSMTC manager request returned null.");

        _manager.CurrentSessionChanged += OnCurrentSessionChanged;
        _manager.SessionsChanged += OnSessionsChanged;

        Pump.Request("startup");
        Log("READY - event-driven with three bounded settling reads per burst.");
        try { await Pump.RunAsync(RefreshAsync, Stop.Token); }
        catch (OperationCanceledException) when (Stop.IsCancellationRequested) { }
        finally
        {
            _manager.CurrentSessionChanged -= OnCurrentSessionChanged;
            _manager.SessionsChanged -= OnSessionsChanged;
            foreach (var pair in Sessions.ToArray()) Unsubscribe(pair.Key, pair.Value);
            Sessions.Clear();
            _snapshot = EmptySnapshot();
        }
        if (_diagnostic)
        {
            using var process = System.Diagnostics.Process.GetCurrentProcess();
            Log($"DIAGNOSTIC finished workingSet={process.WorkingSet64} privateBytes={process.PrivateMemorySize64} managedBytes={GC.GetTotalMemory(false)} handles={process.HandleCount}");
        }
    }

    private static void OnCurrentSessionChanged(
        GlobalSystemMediaTransportControlsSessionManager sender,
        CurrentSessionChangedEventArgs args) => Pump.Request("CurrentSessionChanged");

    private static void OnSessionsChanged(
        GlobalSystemMediaTransportControlsSessionManager sender,
        SessionsChangedEventArgs args) => Pump.Request("SessionsChanged");

    // Only the pump touches session registrations or reads WinRT properties.
    private static void ReconcileSessions(string reason)
    {
        if (_manager == null) return;
        var sessions = _manager.GetSessions().ToArray();
        foreach (var old in Sessions.Keys.Where(x => !sessions.Contains(x)).ToArray())
        {
            Unsubscribe(old, Sessions[old]);
            Sessions.Remove(old);
        }
        foreach (var session in sessions)
            if (!Sessions.ContainsKey(session)) Subscribe(session, reason);
    }

    private static void Subscribe(GlobalSystemMediaTransportControlsSession session, string reason)
    {
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> mediaChanged =
            (sender, args) => HandleSessionEvent("MediaPropertiesChanged");
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> playbackChanged =
            (sender, args) => HandleSessionEvent("PlaybackInfoChanged");

        try
        {
            session.MediaPropertiesChanged += mediaChanged;
            session.PlaybackInfoChanged += playbackChanged;
        }
        catch
        {
            try { session.MediaPropertiesChanged -= mediaChanged; } catch { }
            try { session.PlaybackInfoChanged -= playbackChanged; } catch { }
            throw;
        }

        Sessions[session] = new SessionRegistration { MediaChanged = mediaChanged, PlaybackChanged = playbackChanged };

        string status;
        try { status = session.GetPlaybackInfo()?.PlaybackStatus.ToString() ?? "Unknown"; }
        catch { status = "Unknown"; }
        Log($"REGISTER sourceApp=\"{EscapeLog(session.SourceAppUserModelId)}\" reason=\"{reason}\" playback=\"{status}\"");
    }

    private static void Unsubscribe(GlobalSystemMediaTransportControlsSession session, SessionRegistration registration)
    {
        try { session.MediaPropertiesChanged -= registration.MediaChanged; } catch { }
        try { session.PlaybackInfoChanged -= registration.PlaybackChanged; } catch { }
    }

    private static void HandleSessionEvent(string reason)
    {
        // A callback sender and GetCurrentSession need not share a managed wrapper.
        // Treat any registered event as an invalidation, then read the manager's
        // selected session in the worker. Never publish the callback sender's data.
        if (_diagnostic) Log($"EVENT {reason}");
        Pump.Request(reason);
    }

    private static async Task RefreshAsync(long revision, string reason, CancellationToken stop)
    {
        // Cancellation is passed to WinRT rather than abandoning timed-out tasks.
        using var read = CancellationTokenSource.CreateLinkedTokenSource(stop);
        read.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            ReconcileSessions(reason);
            var session = _manager!.GetCurrentSession();
            if (session == null)
            {
                Pump.Commit(revision, () => { _snapshot = EmptySnapshot(); Emit(_snapshot); });
                return;
            }

            var props = await session.TryGetMediaPropertiesAsync().AsTask(read.Token);
            if (props == null) return;
            var next = new MediaSnapshot
            {
                available = true,
                title = props.Title,
                artist = props.Artist,
                album = props.AlbumTitle,
                albumArtist = props.AlbumArtist,
                sourceApp = session.SourceAppUserModelId,
                playing = session.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
            };
            // Keep titles independent of a slow thumbnail stream.
            if (!Publish(revision, next)) return;
            // Artwork can arrive separately, even with completely unchanged text.
            // Never use another track's cover as a fallback for a missing one.
            next.thumbnailDataUrl = await ReadThumbnailDataUrlAsync(props, read.Token);
            next.playing = session.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            var published = Publish(revision, next);
            var hash = _diagnostic && next.thumbnailDataUrl != null
                ? Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(next.thumbnailDataUrl)))[..12]
                : "-";
            Log($"MEDIA reason=\"{reason}\" sourceApp=\"{EscapeLog(next.sourceApp)}\" title=\"{EscapeLog(next.title)}\" artChars={next.thumbnailDataUrl?.Length ?? 0} artHash={hash} published={published}");
            if (_diagnostic)
            {
                using var process = System.Diagnostics.Process.GetCurrentProcess();
                Log($"RESOURCES privateBytes={process.PrivateMemorySize64} managedBytes={GC.GetTotalMemory(false)} handles={process.HandleCount} sessions={Sessions.Count}");
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { throw; }
        catch (Exception ex) { LogError($"Refresh reason={reason}: {ex.Message}"); }
    }

    private static bool Publish(long revision, MediaSnapshot next) =>
        Pump.Commit(revision, () =>
        {
            // WinRT may return a different wrapper for the same session on each read.
            // The item key includes the source app; wrapper identity is not a key.
            next.thumbnailDataUrl = MediaSnapshot.SelectArtwork(next, _snapshot);
            // Store separately so the in-flight read cannot mutate published state.
            _snapshot = new MediaSnapshot
            {
                available = next.available,
                playing = next.playing,
                title = next.title,
                artist = next.artist,
                album = next.album,
                albumArtist = next.albumArtist,
                sourceApp = next.sourceApp,
                thumbnailDataUrl = next.thumbnailDataUrl,
            };
            Emit(_snapshot);
        });

    private static async Task<string?> ReadThumbnailDataUrlAsync(GlobalSystemMediaTransportControlsSessionMediaProperties props, CancellationToken stop)
    {
        try
        {
            var reference = props.Thumbnail;
            if (reference == null) return null;

            using var stream = await reference.OpenReadAsync().AsTask(stop);
            if (stream == null || stream.Size <= 0 || stream.Size > 16 * 1024 * 1024) return null;

            var length = checked((int)stream.Size);
            var buffer = new Windows.Storage.Streams.Buffer((uint)length);
            var result = await stream.ReadAsync(buffer, (uint)length, InputStreamOptions.None).AsTask(stop);
            if (result.Length != length) throw new IOException($"Incomplete thumbnail: {result.Length}/{length} bytes");
            var bytes = new byte[checked((int)result.Length)];
            using var reader = DataReader.FromBuffer(result);
            reader.ReadBytes(bytes);

            var mime = string.IsNullOrWhiteSpace(stream.ContentType) ? DetectMime(bytes) : stream.ContentType;
            return "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            LogError("Thumbnail read: " + ex.Message);
            return null;
        }
    }

    private static string DetectMime(byte[] bytes)
    {
        if (bytes.Length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return "image/jpeg";
        if (bytes.Length >= 6 && (Encoding.ASCII.GetString(bytes, 0, 6) == "GIF87a" || Encoding.ASCII.GetString(bytes, 0, 6) == "GIF89a")) return "image/gif";
        return "image/jpeg";
    }

    private static void Emit(MediaSnapshot snapshot)
    {
        var key = string.Join("|", new[]
        {
            snapshot.available.ToString(), snapshot.playing.ToString(), snapshot.title ?? "",
            snapshot.artist ?? "", snapshot.album ?? "", snapshot.albumArtist ?? "",
            snapshot.sourceApp ?? "", snapshot.thumbnailDataUrl ?? ""
        });

        if (key == _lastOutputKey) return;
        _lastOutputKey = key;

        // Diagnostics log cover size, never megabytes of base64.
        if (_diagnostic) return;
        Console.Out.WriteLine(JsonSerializer.Serialize(snapshot, JsonOptions));
        Console.Out.Flush();
    }

    private static string EscapeLog(string? value) => (value ?? "").Replace("\"", "'").Replace("\r", " ").Replace("\n", " ");
    private static void Log(string message) { Console.Error.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}"); Console.Error.Flush(); }
    private static void LogError(string message) { Console.Error.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] ERROR {message}"); Console.Error.Flush(); }
}
