// ---------- background ----------

// state.bgType is the explicit switch — an uploaded image stays remembered
// even while "Solid color" is selected, so flipping the dropdown back to
// "Image" doesn't require re-picking the file.
function applyBackground() {
  if (state.bgType === "image" && state.bgImageDataUrl) {
    bgLayer.style.backgroundImage = `url("${state.bgImageDataUrl}")`;
  } else {
    bgLayer.style.backgroundImage = "none";
    bgLayer.style.backgroundColor = state.bgColor;
  }
  // Filter lives on #bgLayer only (see style.css) — never on #canvas or
  // the UI — so cranking blur/brightness can't wash out the visuals.
  // Only meaningful for image backgrounds (see updateBgRowsVisibility,
  // which hides these controls for solid color) — a solid color is
  // already exactly the shade the swatch shows, and there's no image
  // detail for blur to smear, so a leftover value from a previous image
  // session must not silently tint or blur the flat color.
  const isImage = state.bgType === "image";
  bgLayer.style.filter = isImage
    ? `brightness(${state.bgBrightness}) blur(${state.bgBlur}px)`
    : "none";
}

function updateBgRowsVisibility() {
  bgTypeSelect.value = state.bgType;
  const isImage = state.bgType === "image";
  bgColorRow.style.display = isImage ? "none" : "";
  bgImageRow.style.display = isImage ? "" : "none";
  // Brightness/blur only act on #bgLayer's filter (see applyBackground) —
  // with a solid color, brightness is redundant with just picking a
  // darker color, and blur has nothing to smear since there's no image
  // detail, so both controls are pointless there and only shown for
  // "Image" backgrounds.
  brightnessRow.style.display = isImage ? "" : "none";
  blurRow.style.display = isImage ? "" : "none";
  bgImageName.textContent = state.bgImageName || "none chosen";
}

// Reads the file exactly as chosen — no re-encoding. Redrawing onto a
// canvas (an earlier version of this did that, to shrink file size) would
// flatten an animated GIF/WEBP to one static frame, so it's off the table.
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that image file"));
    reader.readAsDataURL(file);
  });
}

// ---------- settings panel sync helpers ----------

// Shows/hides the radial-shape and kaleidoscope-clip rows depending on
// which visual is currently selected — no point offering a
// kaleidoscope-only toggle while looking at the bars.
function updateVisualOptionRows() {
  radialModeRow.style.display = MODES[state.mode] === "radial" ? "" : "none";
  kaleidoClipRow.style.display =
    MODES[state.mode] === "kaleidoscope" ? "" : "none";
}

// Keeps the dropdowns showing whatever visual/theme is actually active,
// whether that came from the dropdown, a keyboard shortcut, or a restored
// setting on launch.
function syncSelectsToState() {
  modeSelect.value = state.mode;
  themeSelect.value = state.theme;
  updateVisualOptionRows();
}

function updateSliderLabels() {
  brightnessVal.textContent = `${Math.round(state.bgBrightness * 100)}%`;
  blurVal.textContent = `${state.bgBlur}px`;
}
