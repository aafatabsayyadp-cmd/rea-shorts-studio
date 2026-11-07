# REA Shorts Studio

A browser-based workspace for turning local video clips into vertical short-form videos.

## Current MVP

- Import a local video (MP4, MOV, WebM and other browser-supported formats)
- Preview the clip in a 9:16 frame
- Set trim start and end points
- Add a simple editable caption overlay
- Export a vertical 1080 × 1920 video in a browser-supported recording format
- Keep source footage local in the browser; no upload or backend is used

## Run locally

Requirements: Node.js 18+

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
npm run preview
```

## Notes

- Export format depends on browser MediaRecorder support. Chrome and Edge are recommended for the first test.
- MP4 output is used when the browser supports H.264/AAC recording; otherwise the app downloads WebM.
- This is an early MVP. Automatic transcription, word-level captions, multi-clip timelines, and advanced reframing are not included yet.
