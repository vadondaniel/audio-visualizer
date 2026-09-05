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

Click the gear icon (top-right) or press `B` to open it:

- **Visual** / **Color theme** — dropdowns, same as `1`-`5` and `C`, for
  when a mouse is easier than remembering keys.
- **Background color** / **image** — pick a solid color or an image file
  (cover-fit automatically).
- **Brightness** / **Blur** — tune the background so it doesn't compete
  with the visuals; these only affect the background layer, never the
  bars/particles/etc. themselves.

Everything above is saved locally and restored automatically next time you
launch the app — it reopens the way you left it instead of resetting to
defaults.

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
