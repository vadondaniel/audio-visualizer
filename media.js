// ---------- now-playing media metadata ----------
// Windows exposes the currently focused system media session through GSMTC.
// The main process watches that API and forwards only changed snapshots here.
const mediaState = {
  metadata: null,
  imageSrc: null,
  thumbnailImage: null,
};

const mediaOverlay = document.createElement("div");
mediaOverlay.id = "mediaOverlay";
mediaOverlay.setAttribute("aria-hidden", "true");
mediaOverlay.innerHTML = `
  <div class="mediaCard">
    <div class="mediaArtWrap">
      <img class="mediaArt" alt="" draggable="false" />
    </div>
    <div class="mediaCopy">
      <div class="mediaArtist"></div>
      <div class="mediaTitle"></div>
    </div>
  </div>
`;
document.body.appendChild(mediaOverlay);

const mediaCard = mediaOverlay.querySelector(".mediaCard");
const mediaArtWrap = mediaOverlay.querySelector(".mediaArtWrap");
const mediaArt = mediaOverlay.querySelector(".mediaArt");
const mediaCopy = mediaOverlay.querySelector(".mediaCopy");
const mediaArtist = mediaOverlay.querySelector(".mediaArtist");
const mediaTitle = mediaOverlay.querySelector(".mediaTitle");

// Render media text as per-character spans so the outline can use the exact
// renderer palette at each position. CSS text-stroke itself cannot consume a
// gradient, so a single solid stroke color can never reproduce the renderer's
// spatial/rainbow coloring.
const mediaTextCache = { title: "", artist: "" };

function setMediaText(element, text, cacheKey) {
  const value = String(text || "");
  if (mediaTextCache[cacheKey] === value) return;
  mediaTextCache[cacheKey] = value;
  element.replaceChildren();
  for (const char of Array.from(value)) {
    const span = document.createElement("span");
    span.className = "mediaTextChar";
    span.textContent = char;
    element.appendChild(span);
  }
}

function updateMediaRendererColors() {
  if (typeof currentHue !== "function" || typeof themeCssColor !== "function")
    return;

  const paintText = (element, text, kind) => {
    const chars = element.querySelectorAll(".mediaTextChar");
    if (!chars.length) return;
    const last = Math.max(1, chars.length - 1);
    chars.forEach((char, index) => {
      // This is deliberately the renderer's own spatial hue function.
      // Rainbow therefore traverses the same full ROYGBIV arc, Color Cycle
      // follows the same hueShift/spread, and regular themes use their stops.
      const offset = index / last;
      const stroke = themeCssColor(currentHue(offset), 95, 68, 1);
      const glow = themeCssColor(currentHue(offset), 95, 72, 0.48);
      const glowBlur =
        typeof getGlowBlur === "function"
          ? getGlowBlur(kind === "title" ? 10 : 7)
          : kind === "title"
            ? 10
            : 7;
      char.style.setProperty("--media-char-stroke", stroke);
      char.style.setProperty("--media-char-glow", glow);
      char.style.setProperty(
        "--media-char-glow-blur",
        `${glowBlur.toFixed(1)}px`
      );
      char.style.setProperty("--media-char-index", index);
    });
  };

  paintText(mediaTitle, mediaTitle.textContent, "title");
  paintText(mediaArtist, mediaArtist.textContent, "artist");
}

const MEDIA_DISPLAYS = {
  title: { cover: false, title: true, artist: false },
  "title-artist": { cover: false, title: true, artist: true },
  cover: { cover: true, title: false, artist: false },
  "cover-title": { cover: true, title: true, artist: false },
  "cover-title-artist": { cover: true, title: true, artist: true },
};

let lastMediaThemeKey = null;

function syncMediaThemeColors() {
  // The media outline is intentionally painted per character from the exact
  // renderer hue/color helpers. Do not derive it from UI CSS accent values.
  updateMediaRendererColors();
}

const MEDIA_POSITION_GROUPS = {
  focus: [
    { value: "above", label: "Above focus" },
    { value: "below", label: "Below focus" },
  ],
  free: [
    { value: "auto", label: "Best fit" },
    { value: "top-left", label: "Top left" },
    { value: "top", label: "Top" },
    { value: "top-right", label: "Top right" },
    { value: "right", label: "Right" },
    { value: "bottom-right", label: "Bottom right" },
    { value: "bottom", label: "Bottom" },
    { value: "bottom-left", label: "Bottom left" },
    { value: "left", label: "Left" },
  ],
};

function isFocusMediaMode(mode) {
  return mode === "cascade" || mode === "radial";
}

const MEDIA_POSITION_VALUES = new Set([
  "auto",
  "above",
  "below",
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
]);

function getMediaPosition(mode = MODES[state.mode] || "bars") {
  return (
    state.mediaTextPositions?.[mode] ||
    (isFocusMediaMode(mode) ? "below" : "auto")
  );
}

function setMediaPosition(mode, position) {
  if (!MEDIA_POSITION_VALUES.has(position)) return;
  if (!state.mediaTextPositions || typeof state.mediaTextPositions !== "object")
    state.mediaTextPositions = {};
  state.mediaTextPositions[mode] = position;
}

function syncMediaPositionOptions() {
  const mode = MODES[state.mode] || "bars";
  const options = isFocusMediaMode(mode)
    ? MEDIA_POSITION_GROUPS.focus
    : MEDIA_POSITION_GROUPS.free;
  const current = getMediaPosition(mode);
  mediaTextPositionSelect.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    })
  );

  const allowed = new Set(options.map((option) => option.value));
  if (!allowed.has(current)) {
    setMediaPosition(mode, isFocusMediaMode(mode) ? "below" : "auto");
  }
  mediaTextPositionSelect.value = getMediaPosition(mode);
}

function mediaHasContent() {
  if (!state.mediaMetadataEnabled || !mediaState.metadata) return false;
  const m = mediaState.metadata;
  return Boolean(
    m.available !== false && (m.title || m.artist || m.thumbnailDataUrl)
  );
}

function applyMediaMetadataUi() {
  const enabled = Boolean(state.mediaMetadataEnabled);
  mediaMetadataCheckbox.checked = enabled;
  mediaDisplayRow.hidden = !enabled;
  syncMediaPositionOptions();
  const display =
    MEDIA_DISPLAYS[state.mediaDisplay] || MEDIA_DISPLAYS["cover-title-artist"];
  mediaTextPositionRow.hidden = !enabled || !(display.title || display.artist);
  updateMediaLayout();
}

function setMediaMetadataEnabled(enabled) {
  state.mediaMetadataEnabled = Boolean(enabled);
  if (window.electronAPI?.setMediaMetadataEnabled) {
    window.electronAPI.setMediaMetadataEnabled(state.mediaMetadataEnabled);
  }
  applyMediaMetadataUi();
  saveSettings();
}

function updateMediaLayout() {
  syncMediaThemeColors();
  const mode = MODES[state.mode] || "bars";
  mediaOverlay.className = `mode-${mode}`;
  syncMediaPositionOptions();

  const display =
    MEDIA_DISPLAYS[state.mediaDisplay] || MEDIA_DISPLAYS["cover-title-artist"];
  const metadata = mediaState.metadata;
  const position = getMediaPosition(mode);
  mediaOverlay.dataset.display = state.mediaDisplay;
  mediaOverlay.dataset.position = position;

  // Cascade owns the visual focus itself. Album art is drawn into the canvas
  // there, while this DOM layer is reserved for the typographic lockup.
  const coverInOverlay =
    display.cover && mode !== "cascade" && Boolean(mediaState.thumbnailImage);
  mediaArtWrap.hidden = !coverInOverlay;
  mediaCopy.hidden = !display.title && !display.artist;
  mediaTitle.hidden = !display.title || !metadata?.title;
  mediaArtist.hidden = !display.artist || !metadata?.artist;

  const visibleText =
    (display.title && metadata?.title) || (display.artist && metadata?.artist);
  mediaOverlay.classList.toggle("text-only", !coverInOverlay);
  mediaOverlay.classList.toggle("no-text", !visibleText);
  mediaOverlay.classList.toggle(
    "enabled",
    Boolean(state.mediaMetadataEnabled && mediaHasContent())
  );
}

function updateMediaMetadata(metadata) {
  const next = metadata && typeof metadata === "object" ? metadata : null;
  const previousKey = mediaState.metadata
    ? `${mediaState.metadata.playing}|${mediaState.metadata.title}|${mediaState.metadata.artist}|${mediaState.metadata.album}|${mediaState.metadata.thumbnailDataUrl}`
    : "";
  const nextKey = next
    ? `${next.playing}|${next.title}|${next.artist}|${next.album}|${next.thumbnailDataUrl}`
    : "";

  mediaState.metadata = next;

  if (next?.thumbnailDataUrl && next.thumbnailDataUrl !== mediaState.imageSrc) {
    mediaState.imageSrc = next.thumbnailDataUrl;
    const artImage = new Image();
    mediaState.thumbnailImage = null;
    artImage.decoding = "async";
    artImage.onload = () => {
      mediaState.thumbnailImage = artImage;
      mediaArt.classList.add("loaded");
      updateMediaLayout();
    };
    artImage.onerror = () => {
      if (mediaState.imageSrc === next.thumbnailDataUrl)
        mediaState.thumbnailImage = null;
      mediaArt.classList.remove("loaded");
      updateMediaLayout();
    };
    artImage.src = next.thumbnailDataUrl;

    mediaArt.classList.remove("loaded");
    mediaArt.src = next.thumbnailDataUrl;
  } else if (!next?.thumbnailDataUrl) {
    mediaState.imageSrc = null;
    mediaState.thumbnailImage = null;
    mediaArt.removeAttribute("src");
    mediaArt.classList.remove("loaded");
  }

  setMediaText(mediaTitle, next?.title || "", "title");
  setMediaText(mediaArtist, next?.artist || "", "artist");

  const changed = previousKey !== nextKey;
  if (changed) mediaOverlay.classList.add("media-updated");
  requestAnimationFrame(() => mediaOverlay.classList.remove("media-updated"));

  updateMediaLayout();
}

if (window.electronAPI?.onMediaMetadata) {
  window.electronAPI.onMediaMetadata(updateMediaMetadata);
}

// Keep the composition attached to mode changes made by hotkeys/auto-cycle.
function refreshMediaForMode() {
  updateMediaLayout();
}

function refreshMediaThemeColors() {
  syncMediaThemeColors();
}
