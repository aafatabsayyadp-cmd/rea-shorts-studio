# REA Shorts Studio

A browser-based editor for turning local videos into vertical short-form clips.

## Features

- Import a local video and preview it in a 9:16 frame
- Trim start and end points
- Generate timed subtitles with Whisper running locally in a browser worker
- Edit each caption's text and timing
- Preview timed captions and burn them into the exported video
- Download subtitles as an SRT file
- Export a vertical 1080 × 1920 video using browser recording support
- No paid transcription API and no video upload

## Run locally

Requirements: Node.js 18+

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The first transcription downloads the Whisper tiny model from Hugging Face and caches it in the browser. Later uses can reuse the cached model. Internet is required for the initial model download; the video audio is captured and processed locally.

## Build

```bash
npm run build
npm run preview
```

## Current limitations

- Audio capture plays the video once in real time before transcription starts.
- The first model download is approximately 75 MB; transcription speed depends on the computer.
- Subtitle timing is segment-level, not word-by-word karaoke timing.
- Cobalt URL importing is not connected yet. It needs a separately hosted Cobalt API; the public service is not a dependable free third-party endpoint.
- Export format depends on browser MediaRecorder support. Chrome or Edge are recommended; MP4 is used when supported, otherwise WebM.
