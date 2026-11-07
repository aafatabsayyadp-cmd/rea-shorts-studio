# REA Shorts Studio

A browser-based editor for turning local videos into vertical short-form clips, with a local URL importer.

## Features

- Import a local video and preview it in a 9:16 frame
- Import supported public media URLs through the optional local yt-dlp helper
- Trim start and end points
- Generate timed subtitles with Whisper running locally in a browser worker
- Edit each caption's text and timing
- Preview timed captions and burn them into the exported video
- Download subtitles as an SRT file
- Export a vertical 1080 × 1920 video using browser recording support
- Video importing and editing run on your PC; no REA cloud upload is used

## Release testing

See [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) for the Windows smoke-test procedure and the current release gates. A passing automated build does not replace testing local video import, audio, transcription, and export on the target PC.

## Run the editor

Requirements: Node.js 18+

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

## Enable URL importing on Windows

1. Install Python 3.10+ from https://www.python.org/downloads/ and enable the PATH option.
2. Install FFmpeg and add it to Windows PATH if you want yt-dlp to merge separate audio/video streams when needed.
3. Open the `local-importer` folder in the project.
4. Double-click `run-windows.bat`. The first run creates a private Python environment and installs yt-dlp and the small local API.
5. Keep the terminal window open. Return to Shorts Studio and refresh the page.
6. Paste a supported media URL into **Import from a link**. The helper downloads the media to `local-importer/downloads`, then passes the file into the editor.

The helper listens only on 127.0.0.1:8765. It has no public internet-facing server. Its API accepts a URL rather than arbitrary command arguments or file paths, disables playlist downloads, and applies a 500 MB file-size limit. It rejects localhost and non-public network destinations. The helper's CORS allowlist currently supports the local Vite and preview origins only.

Only import videos you own or have permission to download. A site's technical support in yt-dlp does not mean its terms allow downloading; follow the site's rules and applicable law. DRM, paywalls, login restrictions, and other access controls are not bypassed by this app.

## Local subtitles

The first transcription downloads the Whisper tiny model from Hugging Face and caches it in the browser. Later uses can reuse the cached model. Internet is required for the initial model download; video audio is captured and processed locally.

## Build

```bash
npm run build
npm run preview
```

## Architecture: local first, cloud ready

The editor now talks to a small local importer API instead of depending on a third-party Cobalt endpoint. The API boundary is intentionally separate from the React editor. A future hosted importer can implement the same import contract behind an authenticated cloud API, with job limits, abuse prevention, storage expiry, and bandwidth controls. Cloud importing is **not deployed or enabled yet**; hosting and media bandwidth may have costs.

## Current limitations

- yt-dlp supports many sites, but individual extractors can change or stop working as platforms change.
- Some sites may require authentication or may prohibit downloading; this helper does not bypass DRM or access controls.
- The helper currently supports local Vite/preview origins, not a deployed public website.
- Audio capture plays the video once in real time before transcription starts.
- The first Whisper model download is approximately 75 MB; transcription speed depends on the computer.
- Subtitle timing is segment-level, not word-by-word karaoke timing.
- Export format depends on browser MediaRecorder support. Chrome or Edge are recommended; MP4 is used when supported, otherwise WebM.
