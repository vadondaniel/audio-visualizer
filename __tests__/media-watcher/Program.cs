static void Check(bool value, string message)
{
    if (!value) throw new Exception(message);
}

static async Task StopAsync(CancellationTokenSource stop, Task task)
{
    stop.Cancel();
    try { await task.WaitAsync(TimeSpan.FromSeconds(2)); }
    catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
}

// Late artwork must replace the initial cover even when no text changes.
{
    var old = new MediaSnapshot { sourceApp = "browser", title = "video", thumbnailDataUrl = "first-cover" };
    var late = new MediaSnapshot { sourceApp = "browser", title = "video", thumbnailDataUrl = "late-cover" };
    Check(MediaSnapshot.SelectArtwork(late, old) == "late-cover", "Unchanged text blocked a new cover");
    late.thumbnailDataUrl = null;
    Check(MediaSnapshot.SelectArtwork(late, old) == "first-cover", "Transient failure cleared the same item's cover");
    late.title = "next video";
    Check(MediaSnapshot.SelectArtwork(late, old) == null, "New track inherited the previous cover");
    late.title = old.title;
    late.sourceApp = "spotify";
    Check(MediaSnapshot.SelectArtwork(late, old) == null, "New source inherited the previous cover");
    Console.WriteLine("PASS: late artwork replaces same-title covers; fallback stays within the same item/source");
}

// Burst coalescing and finite retries: quiet sessions must stop calling WinRT.
{
    var pump = new RefreshPump([10, 10, 10], 1);
    using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    for (var i = 0; i < 50_000; i++) pump.Request("burst");
    var reads = 0;
    var settled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var settledAgain = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var task = pump.RunAsync((revision, reason, token) =>
    {
        Check(pump.Commit(revision, () => { }), "Current revision was rejected");
        var count = Interlocked.Increment(ref reads);
        if (count == 4) settled.SetResult();
        if (count == 8) settledAgain.SetResult();
        return Task.CompletedTask;
    }, stop.Token);
    await settled.Task.WaitAsync(stop.Token);
    await Task.Delay(100, stop.Token);
    Check(reads == 4, $"Expected one initial read plus three retries, got {reads}");
    // A later event must still wake the worker after the recovery window expires.
    pump.Request("later track");
    await settledAgain.Task.WaitAsync(stop.Token);
    await Task.Delay(100, stop.Token);
    Check(reads == 8, $"Later event did not receive its own bounded recovery window: {reads}");
    await StopAsync(stop, task);
    Console.WriteLine("PASS: 50,000-event burst coalesces, retries stop, later events wake worker");
}

// Simulate a song/session switch while an old thumbnail read is in flight.
{
    var pump = new RefreshPump([], 1);
    using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var reads = 0;
    var published = new List<string>();
    pump.Request("old song");
    var task = pump.RunAsync(async (revision, reason, token) =>
    {
        var index = Interlocked.Increment(ref reads);
        if (index == 1)
        {
            entered.SetResult();
            await release.Task.WaitAsync(token);
            Check(!pump.Commit(revision, () => published.Add(reason)), "Stale result was accepted");
        }
        else
        {
            Check(index == 2, "Unexpected concurrent/extra read");
            Check(pump.Commit(revision, () => published.Add(reason)), "New result was rejected");
            done.SetResult();
        }
    }, stop.Token);
    await entered.Task.WaitAsync(stop.Token);
    for (var i = 0; i < 50_000; i++) pump.Request("new session");
    Check(reads == 1, "Reads overlapped");
    release.SetResult();
    await done.Task.WaitAsync(stop.Token);
    Check(published.SequenceEqual(["new session"]), "Wrong session published");
    await StopAsync(stop, task);
    Console.WriteLine("PASS: in-flight obsolete results rejected; reads never overlap");
}
