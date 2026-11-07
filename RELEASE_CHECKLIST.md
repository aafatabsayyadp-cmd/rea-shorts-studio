# REA Shorts Studio — release checklist

This checklist separates automated build verification from hands-on product testing. A successful CI build does not prove that browser media capture, local downloading, transcription, or export works on every Windows PC.

## Current release status

- [x] React/TypeScript production build passes in GitHub Actions.
- [x] Local importer Python file passes syntax compilation in GitHub Actions.
- [x] Local-first architecture documented.
- [ ] Windows setup verified on the target PC.
- [ ] Local URL import tested with a video the tester owns or is authorized to download.
- [ ] Imported video playback and audio verified.
- [ ] Trim start/end behavior verified.
- [ ] Whisper transcription tested with clear speech; captions reviewed and edited.
- [ ] SRT download opened and checked in a subtitle editor/player.
- [ ] MP4 or WebM export played back with picture, audio, correct duration, vertical framing, and captions.
- [ ] Large-file and unsupported-URL errors checked.
- [ ] Browser refresh/restart behavior and disk cleanup reviewed.

## Windows smoke test

1. Install Node.js 18 or newer and Python 3.10 or newer.
2. Download or clone this repository; open a terminal in its folder.
3. Run `npm install`, then `npm run dev`.
4. Open the local Vite address shown in the terminal.
5. In a second terminal, run `local-importer\\run-windows.bat`; keep that window open.
6. Refresh Shorts Studio. The importer status should say **Local importer connected**.
7. Import a permitted test video. Confirm it appears in the preview and plays with sound.
8. Set a short trim range (for example, 5–15 seconds) and preview it.
9. Generate subtitles. First use needs internet to download the Whisper model; allow time for the video to play through once and for transcription to finish.
10. Edit one caption and export. Confirm the downloaded file plays, contains sound, respects the trim, is vertical, and shows the edited caption.
11. Download the SRT and check its timestamps and text.
12. Try one unsupported URL and confirm the app shows a readable error rather than freezing.

## Known limitations before public launch

- Cloud importing is not implemented or deployed.
- URL importing depends on yt-dlp extractors and platform rules; supported sites can change.
- Only import media you own or are authorized to download. The app does not bypass DRM, paywalls, or access controls.
- The local importer is intended for a trusted desktop environment and binds to loopback only.
- The first Whisper model download needs internet; transcription runs locally and takes approximately the source video's playback time plus model processing time.
- Captions are segment-timed, not word-by-word karaoke.
- Export format depends on browser MediaRecorder support: MP4 where supported, otherwise WebM.
- This version is an editor prototype, not a multi-project cloud workspace. Project persistence, user accounts, billing, hosted imports, and production monitoring are not included.

## Release decision

Do not describe the app as fully tested or production-ready until the Windows smoke test above passes on the intended machine. After the smoke test, record the browser/version, Windows version, source-video format and size, export format, and any errors so failures can be reproduced.
