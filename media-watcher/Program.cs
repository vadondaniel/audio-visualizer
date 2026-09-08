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

internal sealed class MediaSnapshot
{
    public bool available { get; set; }
    public bool playing { get; set; }
    public string? title { get; set; }
    public string? artist { get; set; }
    public string? album { get; set; }
    public string? albumArtist { get; set; }
    public string? thumbnailDataUrl { get; set; }
    public string? sourceApp { get; set; }
}

internal static class Program
{
    private static readonly object Gate = new();
    private static readonly Dictionary<GlobalSystemMediaTransportControlsSession, SessionRegistration> Sessions = new();
    private static readonly ManualResetEventSlim ExitEvent = new(false);
    private static readonly JsonSerializerOptions JsonOptions = new();

    private static GlobalSystemMediaTransportControlsSessionManager? _manager;
    private static GlobalSystemMediaTransportControlsSession? _currentSession;
    private static MediaSnapshot _snapshot = EmptySnapshot();
    private static string _lastMediaKey = "";
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

    public static int Main()
    {
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            ExitEvent.Set();
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
        Log("Direct WinRT GSMTC events; no polling");

        _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        if (_manager == null)
            throw new InvalidOperationException("GSMTC manager request returned null.");

        _manager.CurrentSessionChanged += OnCurrentSessionChanged;
        _manager.SessionsChanged += OnSessionsChanged;

        await ReconcileSessionsAsync("startup");
        await SwitchCurrentSessionAsync(_manager.GetCurrentSession(), "startup", force: true);

        Log("READY — listening for media changes. Press Ctrl+C to exit.");
        ExitEvent.Wait();

        _manager.CurrentSessionChanged -= OnCurrentSessionChanged;
        _manager.SessionsChanged -= OnSessionsChanged;
        lock (Gate)
        {
            foreach (var pair in Sessions.ToArray())
                Unsubscribe(pair.Key, pair.Value);
            Sessions.Clear();
        }
    }

    private static async void OnCurrentSessionChanged(
        GlobalSystemMediaTransportControlsSessionManager sender,
        CurrentSessionChangedEventArgs args)
    {
        try
        {
            Log("EVENT CurrentSessionChanged");
            await ReconcileSessionsAsync("CurrentSessionChanged");
            await SwitchCurrentSessionAsync(sender.GetCurrentSession(), "CurrentSessionChanged", force: true);
        }
        catch (Exception ex) { LogError("CurrentSessionChanged: " + ex.Message); }
    }

    private static async void OnSessionsChanged(
        GlobalSystemMediaTransportControlsSessionManager sender,
        SessionsChangedEventArgs args)
    {
        try
        {
            Log("EVENT SessionsChanged");
            await ReconcileSessionsAsync("SessionsChanged");
            await SwitchCurrentSessionAsync(sender.GetCurrentSession(), "SessionsChanged", force: false);
        }
        catch (Exception ex) { LogError("SessionsChanged: " + ex.Message); }
    }

    private static async Task ReconcileSessionsAsync(string reason)
    {
        if (_manager == null) return;
        var sessions = _manager.GetSessions()?.ToArray() ?? Array.Empty<GlobalSystemMediaTransportControlsSession>();

        lock (Gate)
        {
            foreach (var old in Sessions.Keys.Where(x => !sessions.Contains(x)).ToArray())
            {
                Unsubscribe(old, Sessions[old]);
                Sessions.Remove(old);
            }
        }

        foreach (var session in sessions)
        {
            lock (Gate)
                if (Sessions.ContainsKey(session))
                    continue;
            Subscribe(session, reason);
        }

        Log($"SESSIONS reason=\"{reason}\" count={sessions.Length}");
    }

    private static void Subscribe(GlobalSystemMediaTransportControlsSession session, string reason)
    {
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> mediaChanged =
            (sender, args) => { _ = HandleMediaChangedAsync(sender); };
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> playbackChanged =
            (sender, args) => { _ = HandlePlaybackChangedAsync(sender); };

        session.MediaPropertiesChanged += mediaChanged;
        session.PlaybackInfoChanged += playbackChanged;

        lock (Gate)
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

    private static async Task SwitchCurrentSessionAsync(
        GlobalSystemMediaTransportControlsSession? session,
        string reason,
        bool force)
    {
        bool changed;
        lock (Gate)
        {
            changed = !ReferenceEquals(_currentSession, session);
            _currentSession = session;
            _lastMediaKey = "";
            _snapshot = EmptySnapshot();
        }

        if (!changed && !force)
            return;

        if (session == null)
        {
            Log($"CURRENT reason=\"{reason}\" new=<none>");
            EmitCurrentSnapshot();
            return;
        }

        Log($"CURRENT reason=\"{reason}\" sourceApp=\"{EscapeLog(session.SourceAppUserModelId)}\"");
        await RefreshMetadataAsync(session, reason);
    }

    private static async Task HandleMediaChangedAsync(GlobalSystemMediaTransportControlsSession session)
    {
        try
        {
            if (!IsCurrent(session)) return;
            Log($"EVENT MediaPropertiesChanged sourceApp=\"{EscapeLog(session.SourceAppUserModelId)}\"");
            await RefreshMetadataAsync(session, "MediaPropertiesChanged");
        }
        catch (Exception ex) { LogError("MediaPropertiesChanged: " + ex.Message); }
    }

    private static async Task HandlePlaybackChangedAsync(GlobalSystemMediaTransportControlsSession session)
    {
        try
        {
            if (!IsCurrent(session)) return;
            var playing = session.GetPlaybackInfo()?.PlaybackStatus.ToString() == "Playing";
            Log($"EVENT PlaybackInfoChanged sourceApp=\"{EscapeLog(session.SourceAppUserModelId)}\" status=\"{(playing ? "Playing" : "NotPlaying")}\"");

            MediaSnapshot next;
            lock (Gate) next = Copy(_snapshot);
            next.available = true;
            next.playing = playing;
            next.sourceApp = session.SourceAppUserModelId;
            Emit(next);
        }
        catch (Exception ex) { LogError("PlaybackInfoChanged: " + ex.Message); }
    }

    private static bool IsCurrent(GlobalSystemMediaTransportControlsSession session)
    {
        lock (Gate)
        {
            if (_currentSession == null)
                return false;

            try
            {
                return string.Equals(
                    _currentSession.SourceAppUserModelId,
                    session.SourceAppUserModelId,
                    StringComparison.OrdinalIgnoreCase
                );
            }
            catch
            {
                return false;
            }
        }
    }

    private static async Task RefreshMetadataAsync(GlobalSystemMediaTransportControlsSession session, string reason)
    {
        var props = await session.TryGetMediaPropertiesAsync();
        if (props == null) return;

        var mediaKey = string.Join("|", new[]
        {
            session.SourceAppUserModelId ?? "",
            props.Title ?? "",
            props.Artist ?? "",
            props.AlbumTitle ?? "",
            props.AlbumArtist ?? "",
        });

        bool mediaChanged;
        lock (Gate) mediaChanged = !string.Equals(_lastMediaKey, mediaKey, StringComparison.Ordinal);

        var next = new MediaSnapshot
        {
            available = true,
            playing = session.GetPlaybackInfo()?.PlaybackStatus.ToString() == "Playing",
            title = props.Title,
            artist = props.Artist,
            album = props.AlbumTitle,
            albumArtist = props.AlbumArtist,
            sourceApp = session.SourceAppUserModelId,
            thumbnailDataUrl = null,
        };

        lock (Gate)
            next.thumbnailDataUrl = _snapshot.thumbnailDataUrl;

        if (mediaChanged)
            next.thumbnailDataUrl = await ReadThumbnailDataUrlAsync(props);

        lock (Gate)
        {
            _lastMediaKey = mediaKey;
            _snapshot = next;
        }

        Log($"MEDIA reason=\"{reason}\" title=\"{EscapeLog(props.Title)}\" artist=\"{EscapeLog(props.Artist)}\" album=\"{EscapeLog(props.AlbumTitle)}\" changed={mediaChanged}");
        Emit(next);
    }

    private static async Task<string?> ReadThumbnailDataUrlAsync(GlobalSystemMediaTransportControlsSessionMediaProperties props)
    {
        try
        {
            var reference = props.Thumbnail;
            if (reference == null) return null;

            using var stream = await reference.OpenReadAsync();
            if (stream == null || stream.Size <= 0 || stream.Size > 16 * 1024 * 1024) return null;

            var length = checked((int)stream.Size);
            var buffer = new Windows.Storage.Streams.Buffer((uint)length);
            await stream.ReadAsync(buffer, (uint)length, InputStreamOptions.None);
            var bytes = new byte[length];
            using var reader = DataReader.FromBuffer(buffer);
            reader.ReadBytes(bytes);

            var mime = string.IsNullOrWhiteSpace(stream.ContentType) ? DetectMime(bytes) : stream.ContentType;
            return "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
        }
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

    private static MediaSnapshot Copy(MediaSnapshot x) => new()
    {
        available = x.available,
        playing = x.playing,
        title = x.title,
        artist = x.artist,
        album = x.album,
        albumArtist = x.albumArtist,
        thumbnailDataUrl = x.thumbnailDataUrl,
        sourceApp = x.sourceApp,
    };

    private static void EmitCurrentSnapshot()
    {
        MediaSnapshot snapshot;
        lock (Gate) snapshot = Copy(_snapshot);
        Emit(snapshot);
    }

    private static void Emit(MediaSnapshot snapshot)
    {
        var key = string.Join("|", new[]
        {
            snapshot.available.ToString(), snapshot.playing.ToString(), snapshot.title ?? "",
            snapshot.artist ?? "", snapshot.album ?? "", snapshot.albumArtist ?? "",
            snapshot.sourceApp ?? "", snapshot.thumbnailDataUrl ?? ""
        });

        lock (Gate)
        {
            if (key == _lastOutputKey) return;
            _lastOutputKey = key;
        }

        Console.Out.WriteLine(JsonSerializer.Serialize(snapshot, JsonOptions));
        Console.Out.Flush();
    }

    private static string EscapeLog(string? value) => (value ?? "").Replace("\"", "'").Replace("\r", " ").Replace("\n", " ");
    private static void Log(string message) { Console.Error.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}"); Console.Error.Flush(); }
    private static void LogError(string message) { Console.Error.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] ERROR {message}"); Console.Error.Flush(); }
}
