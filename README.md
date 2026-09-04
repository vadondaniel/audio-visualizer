# Music Visualizer

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
| `Esc`     | Quit                                     |

Move the mouse to bring back the control hint overlay; it fades out on its own.

The 5 visual styles are: **bars**, **radial spectrum**, **waveform**,
**particles** (bass-reactive bursts), and **kaleidoscope**.

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
- Tested against Electron 33. If you bump the Electron version in
  `package.json`, loopback audio capture requires Electron ~29+.

## How it works, briefly

`main.js` registers a `setDisplayMediaRequestHandler` that answers
`getDisplayMedia()` calls with `{ video: <screen>, audio: 'loopback' }` —
this is what gives you system-wide audio without extra software. The video
track is immediately discarded; only the audio track is used. That audio
feeds a Web Audio `AnalyserNode` (`renderer.js`), which extracts real-time
frequency (FFT) and waveform data, 60 times a second, which drives all five
canvas-based visualizations plus a simple bass-based beat detector for the
pulse/particle effects.
