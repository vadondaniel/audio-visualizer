# Audio Visualizer

A standalone Windows app that visualizes whatever audio is currently playing
on your PC — any app, not just a browser tab — in real time, NCS-video style.

No virtual audio cable needed. It uses Electron's built-in Windows loopback
capture (WASAPI under the hood) to grab your system audio directly.

## 1. Install Node.js (if you don't have it)

Download and install from <https://nodejs.org> (LTS version). This gives you
`npm`, which is all you need — you don't need to know JavaScript to run this.

## 2. Install dependencies

Open a terminal (PowerShell) in this folder and run:

```bash
npm install
```

This downloads Electron itself (~150-200MB), one time only.

## 3. Run it

```bash
npm start
```

A window opens (on your second monitor if you have one). Click **START**.
Windows may briefly show a screen-share style prompt the very first time —
just confirm it. After that, whatever is playing anywhere on your PC
(Spotify, a game, a browser, anything) drives the visuals.

## Controls

| Key       | Action                                   |
|-----------|------------------------------------------|
| `1`-`5`   | Switch visual style                      |
| `C`       | Cycle color theme                        |
| `Space`   | Toggle auto-cycle through visual styles  |
| `F`       | Toggle fullscreen                        |
| `T`       | Toggle always-on-top                     |
| `B`       | Toggle background panel                  |
| `Esc`     | Quit                                     |

Move the mouse to bring back the control hint overlay; it fades out on its own.

The 5 visual styles are: **bars**, **radial spectrum**, **waveform**,
**particles** (bass-reactive bursts), and **kaleidoscope**.

## Settings panel

Click the gear icon (top-right) or press `B` to open it. Like the control
hint overlay in the corner, the gear icon itself fades out when the mouse
sits idle, and the panel (if open) fades with it — move the mouse to bring
both back.

- **Visual** / **Color theme** — dropdowns, same as `1`-`5` and `C`, for
  when a mouse is easier than remembering keys.
- **Background** — a Solid color / Image switch. Picking an image
  switches to it automatically; switching back to Solid color keeps the
  image remembered so you can flip back without re-picking the file.
- **Brightness** / **Blur** — tune the background so it doesn't compete
  with the visuals; these only affect the background layer, never the
  bars/particles/etc. themselves.

Everything above — including the background image itself — is saved
locally and restored next time you launch the app. Images are automatically
downscaled/compressed on upload so a full-resolution photo doesn't blow
past the browser storage quota (which was silently failing to save large
images before).

## 4. (Optional) Turn it into a real .exe

If you want a double-clickable app instead of running it from a terminal:

```bash
npm run dist
```

This uses `electron-builder` to produce a portable `.exe` in the `dist/`
folder. First run will download some extra tooling.

## Notes / troubleshooting

- **"No audio track" error**: make sure something is actually playing before
  clicking Start, and that your default Windows playback device is set
  correctly (Settings > System > Sound).
- **Silent/laggy visuals**: some apps route audio in ways loopback capture
  can miss (rare). Try playing through a browser tab or your default media
  player first to confirm it works, then troubleshoot the specific app.
- **`F`/`T`/`Esc` doing nothing**: this was a real bug, now fixed — Electron
  defaults `sandbox: true` since v20, which silently breaks a sandboxed
  preload script's `require()` of a local file (`ipc-channels.js`). If
  you're merging this into a fork, make sure `main.js`'s `webPreferences`
  keeps `sandbox: false`.
- Everything runs locally — no data leaves your machine, no accounts needed.
- Tested against the Electron version pinned in `package.json` (currently
  44.x). Loopback audio capture requires Electron ~29+, so older pins won't
  work.

## How it works, briefly

`main.js` registers a `setDisplayMediaRequestHandler` that answers
`getDisplayMedia()` calls with `{ video: <screen>, audio: 'loopback' }` —
this is what gives you system-wide audio without extra software. The video
track is immediately discarded; only the audio track is used. That audio
feeds a Web Audio `AnalyserNode` (`renderer.js`), which extracts real-time
frequency (FFT) and waveform data once per display refresh. All the motion —
bar/particle smoothing, kaleidoscope spin, the trail fade, the beat
detector — is driven by real elapsed time rather than a fixed frame count,
so it looks the same whether your display is 60Hz, 120Hz, or 144Hz.
