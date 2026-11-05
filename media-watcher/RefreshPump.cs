using System.Threading.Channels;

// One reader, one pending signal, and a finite recovery window per event burst.
// No periodic WinRT calls, unbounded task queue, or overlapping thumbnail streams.
internal sealed class RefreshPump
{
    private readonly object _gate = new();
    private readonly Channel<bool> _signals = Channel.CreateBounded<bool>(1);
    private readonly int[] _retryDelays;
    private readonly int _debounceMs;
    private long _revision;
    private string _reason = "startup";

    public RefreshPump(int[]? retryDelays = null, int debounceMs = 75)
    {
        _retryDelays = retryDelays ?? [250, 750, 2000];
        _debounceMs = debounceMs;
    }

    public void Request(string reason)
    {
        lock (_gate)
        {
            _revision++;
            _reason = reason;
            _signals.Writer.TryWrite(true);
        }
    }

    public bool Commit(long revision, Action publish)
    {
        lock (_gate)
        {
            if (revision != _revision) return false;
            publish();
            return true;
        }
    }

    public async Task RunAsync(Func<long, string, CancellationToken, Task> refresh, CancellationToken stop)
    {
        var retry = _retryDelays.Length;
        while (!stop.IsCancellationRequested)
        {
            var signaled = false;
            using (var wait = CancellationTokenSource.CreateLinkedTokenSource(stop))
            {
                if (retry < _retryDelays.Length) wait.CancelAfter(_retryDelays[retry]);
                try { signaled = await _signals.Reader.WaitToReadAsync(wait.Token); }
                catch (OperationCanceledException) when (!stop.IsCancellationRequested) { }
            }
            if (signaled)
            {
                await Task.Delay(_debounceMs, stop);
                retry = 0;
            }
            else retry++;

            long revision;
            string reason;
            lock (_gate)
            {
                // Drain and capture together so a racing event cannot be lost.
                while (_signals.Reader.TryRead(out _)) signaled = true;
                if (signaled) retry = 0;
                revision = _revision;
                reason = signaled ? _reason : $"settle-{retry}";
            }
            await refresh(revision, reason, stop);
        }
    }
}
