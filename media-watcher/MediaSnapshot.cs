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
    // Text identifies the item, never whether its artwork needs refreshing.
    public static string? SelectArtwork(MediaSnapshot next, MediaSnapshot previous) =>
        next.thumbnailDataUrl ?? (next.sourceApp == previous.sourceApp &&
            next.title == previous.title && next.artist == previous.artist &&
            next.album == previous.album && next.albumArtist == previous.albumArtist
                ? previous.thumbnailDataUrl : null);
}
