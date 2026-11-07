import { ChangeEvent, useEffect, useRef, useState } from "react";

type ExportState = "idle" | "rendering" | "done" | "error";
type Caption = { id: number; start: number; end: number; text: string };
type WorkerMessage =
  | { type: "model-progress"; progress: { status?: string; progress?: number; file?: string } }
  | { type: "result"; text: string; chunks: { timestamp: [number, number]; text: string }[] }
  | { type: "error"; message: string };

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "00:00";
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function srtTime(value: number) {
  const ms = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isExportingRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [caption, setCaption] = useState("Your next big idea starts here.");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [transcriptionState, setTranscriptionState] = useState<"idle" | "capturing" | "loading" | "transcribing" | "done" | "error">("idle");
  const [transcriptionMessage, setTranscriptionMessage] = useState("");
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [language, setLanguage] = useState("auto");
  const [importUrl, setImportUrl] = useState("");
  const [importerStatus, setImporterStatus] = useState<"checking" | "online" | "offline">("checking");
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("http://127.0.0.1:8765/api/health", { signal: AbortSignal.timeout(2500) })
      .then((response) => { if (!response.ok) throw new Error("offline"); return response.json(); })
      .then(() => { if (active) setImporterStatus("online"); })
      .catch(() => { if (active) setImporterStatus("offline"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      workerRef.current?.terminate();
    };
  }, [videoUrl]);

  const loadFile = (selected: File | undefined) => {
    if (!selected || !selected.type.startsWith("video/")) return;
    const nextUrl = URL.createObjectURL(selected);
    setVideoUrl(nextUrl);
    setFile(selected);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setCaptions([]);
    setTranscriptionState("idle");
    setTranscriptionMessage("");
    setExportState("idle");
    setExportMessage("");
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
  };
  const importFromUrl = async () => {
    const value = importUrl.trim();
    if (!value) { setImportMessage("Paste a video URL first."); return; }
    let parsed: URL;
    try { parsed = new URL(value); } catch { setImportMessage("Enter a valid video URL."); return; }
    if (!["http:", "https:"].includes(parsed.protocol)) { setImportMessage("Only HTTP and HTTPS links are supported."); return; }
    setImportBusy(true);
    setImportMessage("Connecting to your local importer…");
    try {
      const response = await fetch("http://127.0.0.1:8765/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: parsed.toString() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Import failed.");
      setImportMessage("Downloading video to this PC…");
      const fileResponse = await fetch(`http://127.0.0.1:8765${result.download_url}`);
      if (!fileResponse.ok) throw new Error("The importer could not return the downloaded file.");
      const blob = await fileResponse.blob();
      const extension = String(result.filename).split(".").pop()?.toLowerCase();
      const mime = extension === "webm" ? "video/webm" : extension === "mov" ? "video/quicktime" : "video/mp4";
      const imported = new File([blob], result.filename || "imported-video.mp4", { type: mime });
      loadFile(imported);
      setImportMessage(`Imported “${result.title}” to this browser. You can now edit it.`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Could not connect to the local importer.");
    } finally {
      setImportBusy(false);
    }
  };


  const onMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setTrimEnd(video.duration);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < trimStart || video.currentTime >= trimEnd) video.currentTime = trimStart;
      await video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const captionAt = (time: number) => {
    const active = captions.find((item) => time >= item.start && time <= item.end);
    return active?.text ?? (captions.length ? "" : caption);
  };

  const drawFrame = (ctx: CanvasRenderingContext2D, video: HTMLVideoElement, text: string) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.fillStyle = "#08080b";
    ctx.fillRect(0, 0, width, height);
    const sourceRatio = video.videoWidth / video.videoHeight;
    const targetRatio = width / height;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceRatio > targetRatio) {
      sw = video.videoHeight * targetRatio;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / targetRatio;
      sy = (video.videoHeight - sh) / 2;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    if (!text.trim()) return;
    const maxWidth = width * 0.82;
    const fontSize = 76;
    ctx.font = `800 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const words = text.trim().split(/\s+/);
    const lines: string[] = [];
    let line = "";
    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    });
    if (line) lines.push(line);
    const lineHeight = fontSize * 1.18;
    const startY = height * 0.76 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((item, index) => {
      const y = startY + index * lineHeight;
      ctx.lineWidth = 16;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,.88)";
      ctx.strokeText(item, width / 2, y, maxWidth);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(item, width / 2, y, maxWidth);
    });
  };

  const startTranscription = async () => {
    const video = videoRef.current;
    if (!video || !file || transcriptionState === "capturing" || transcriptionState === "loading" || transcriptionState === "transcribing") return;
    if (!("MediaRecorder" in window)) {
      setTranscriptionState("error");
      setTranscriptionMessage("Audio capture is not supported in this browser. Try the latest Chrome or Edge.");
      return;
    }
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
      ?? (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
    const audioTracks = capture?.getAudioTracks() ?? [];
    if (!audioTracks.length) {
      setTranscriptionState("error");
      setTranscriptionMessage("This video has no audio track to transcribe.");
      return;
    }

    try {
      video.pause();
      video.currentTime = 0;
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2 && video.currentTime === 0) resolve();
        else video.addEventListener("seeked", () => resolve(), { once: true });
      });
      const audioOnly = new MediaStream(audioTracks);
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(audioOnly, { mimeType });
      const parts: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
      const audioReady = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Could not capture audio from this video."));
        recorder.onstop = () => resolve(new Blob(parts, { type: mimeType }));
      });
      isTranscribingRef.current = true;
      setTranscriptionState("capturing");
      setTranscriptionMessage("Playing the video once to capture its audio…");
      setTranscriptionProgress(0);
      recorder.start(500);
      await video.play();
      await new Promise<void>((resolve) => {
        const onEnded = () => { video.removeEventListener("ended", onEnded); resolve(); };
        video.addEventListener("ended", onEnded);
      });
      video.pause();
      recorder.stop();
      const audioBlob = await audioReady;
      isTranscribingRef.current = false;
      setPlaying(false);
      if (!audioBlob.size) throw new Error("No audio data was captured.");

      setTranscriptionState("loading");
      setTranscriptionMessage("Loading the free Whisper model (first use downloads it once)…");
      const worker = new Worker(new URL("./transcription.worker.ts", import.meta.url), { type: "module" });
      workerRef.current?.terminate();
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "model-progress") {
          const p = message.progress;
          if (typeof p.progress === "number") setTranscriptionProgress(Math.round(p.progress));
          if (p.status) setTranscriptionMessage(`Loading model: ${p.status}`);
          setTranscriptionState("loading");
        } else if (message.type === "result") {
          const next = message.chunks
            .filter((chunk) => chunk.timestamp && Number.isFinite(chunk.timestamp[0]) && Number.isFinite(chunk.timestamp[1]) && chunk.timestamp[1] > chunk.timestamp[0] && chunk.text.trim())
            .map((chunk, index) => ({ id: index + 1, start: chunk.timestamp[0], end: chunk.timestamp[1], text: chunk.text.trim() }));
          setCaptions(next);
          setTranscriptionState("done");
          setTranscriptionProgress(100);
          setTranscriptionMessage(next.length ? `Created ${next.length} timed caption lines. Review them before exporting.` : "Whisper returned no timed captions. Try another clip.");
          worker.terminate();
        } else if (message.type === "error") {
          setTranscriptionState("error");
          setTranscriptionMessage(message.message);
          worker.terminate();
        }
      };
      worker.onerror = () => {
        setTranscriptionState("error");
        setTranscriptionMessage("The transcription worker stopped unexpectedly. Try again in Chrome or Edge.");
        worker.terminate();
      };
      setTranscriptionState("transcribing");
      setTranscriptionMessage("Transcribing locally on this device…");
      worker.postMessage({ type: "transcribe", audio: audioBlob, language });
    } catch (error) {
      isTranscribingRef.current = false;
      setTranscriptionState("error");
      setTranscriptionMessage(error instanceof Error ? error.message : "Transcription failed.");
    }
  };

  const updateCaption = (id: number, field: "start" | "end" | "text", value: number | string) => {
    setCaptions((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const downloadSrt = () => {
    const content = captions.map((item, index) => `${index + 1}\n${srtTime(item.start)} --> ${srtTime(item.end)}\n${item.text}\n`).join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name.replace(/\.[^.]+$/, "") || "captions"}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportVideo = async () => {
    const video = videoRef.current;
    if (!video || !file) return;
    if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream) {
      setExportState("error"); setExportMessage("Video export is not supported by this browser. Try Chrome or Edge."); return;
    }
    if (trimEnd <= trimStart) { setExportState("error"); setExportMessage("Choose a valid trim range first."); return; }
    setExportState("rendering"); setProgress(0); setExportMessage("Preparing your vertical video…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080; canvas.height = 1920;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the export canvas.");
      const canvasStream = canvas.captureStream(30);
      const sourceStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
        ?? (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
      sourceStream?.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      const mimeType = MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac") ? "video/mp4;codecs=h264,aac"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const recorder = new MediaRecorder(canvasStream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("The browser stopped the export unexpectedly."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      video.pause(); video.currentTime = trimStart;
      await new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - trimStart) < 0.05) resolve();
        else video.addEventListener("seeked", () => resolve(), { once: true });
      });
      isExportingRef.current = true;
      recorder.start(250);
      await video.play();
      let animation = 0;
      const render = () => {
        drawFrame(context, video, captionAt(video.currentTime));
        const currentProgress = Math.min(100, ((video.currentTime - trimStart) / (trimEnd - trimStart)) * 100);
        setProgress(currentProgress);
        if (video.currentTime >= trimEnd || video.ended) { video.pause(); cancelAnimationFrame(animation); recorder.stop(); return; }
        animation = requestAnimationFrame(render);
      };
      render();
      const blob = await finished;
      isExportingRef.current = false;
      canvasStream.getTracks().forEach((track) => track.stop());
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${file.name.replace(/\.[^.]+$/, "")}-short.${extension}`;
      anchor.click(); URL.revokeObjectURL(downloadUrl);
      setExportState("done"); setExportMessage(`Your ${extension.toUpperCase()} is ready and downloaded.`);
      setProgress(100); setPlaying(false);
    } catch (error) {
      isExportingRef.current = false;
      setExportState("error");
      setExportMessage(error instanceof Error ? error.message : "Export failed. Please try again.");
    }
  };

  const activeCaption = captionAt(playhead);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">R</div><div><strong>REA</strong><span>SHORTS STUDIO</span></div></div>
        <div className="side-label">WORKSPACE</div>
        <button className="nav-item active"><span>▣</span> Editor</button>
        <button className="nav-item" onClick={() => fileInputRef.current?.click()}><span>＋</span> New project</button>
        <div className="sidebar-bottom"><div className="local-badge"><span /> LOCAL PROCESSING</div><p>Your videos and transcription stay on this device.</p><div className="version">EARLY ACCESS · 0.2.0</div></div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div><div className="eyebrow">VIDEO WORKSPACE</div><h1>Shorts editor</h1></div>
          <div className="top-actions"><span className="autosave"><i /> Saved locally</span><button className="export-button" onClick={exportVideo} disabled={!file || exportState === "rendering"}>{exportState === "rendering" ? "Exporting…" : "Export short"} <span>↗</span></button></div>
        </header>

        <div className="editor-layout">
          <section className="preview-column">
            <div className="section-heading"><div><span className="step">01</span><strong>Preview</strong></div><span className="format-pill">9:16 VERTICAL</span></div>
            <div className="preview-stage">
              {file ? <div className="phone-frame">
                <video ref={videoRef} src={videoUrl} onLoadedMetadata={onMetadata} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                  onTimeUpdate={() => { const v = videoRef.current; if (v) setPlayhead(v.currentTime); if (!isExportingRef.current && !isTranscribingRef.current && v && v.currentTime >= trimEnd && !v.paused) { v.pause(); v.currentTime = trimStart; } }} />
                <div className="preview-caption">{activeCaption || (captions.length ? "" : "Your caption appears here")}</div>
                <button className="play-overlay" onClick={togglePlayback} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? "Ⅱ" : "▶"}</button>
              </div> : <button className="upload-card" onClick={() => fileInputRef.current?.click()}>
                <div className="upload-icon">↑</div><strong>Drop a video to get started</strong><span>or click to browse files</span><small>MP4 · MOV · WEBM · Local files only</small>
              </button>}
            </div>
            <div className="preview-footer"><span>{file ? file.name : "No video selected"}</span><span>{file ? `${formatTime(duration)} total` : "1080 × 1920 output"}</span></div>
          </section>

          <section className="controls-column">
            <div className="section-heading"><div><span className="step">02</span><strong>Make it yours</strong></div></div>
            <div className="control-card">
              <div className="control-title"><span className="control-icon">◫</span><div><strong>Source video</strong><small>Choose a clip from your device</small></div></div>
              <input ref={fileInputRef} className="hidden-input" type="file" accept="video/*" onChange={onFileChange} />
              <button className="file-picker" onClick={() => fileInputRef.current?.click()}>{file ? "Replace video" : "Choose video"} <span>＋</span></button>
              {file && <div className="file-name"><span className="file-dot" />{file.name}</div>}
            </div>

            <div className="control-card importer-card">
              <div className="control-title"><span className="control-icon">⇩</span><div><strong>Import from a link</strong><small>yt-dlp local engine · many supported sites</small></div></div>
              <div className={`importer-status ${importerStatus}`}><span />{importerStatus === "online" ? "Local importer connected" : importerStatus === "checking" ? "Checking local importer…" : "Local importer not running"}</div>
              <input className="import-url" type="url" placeholder="Paste a video URL…" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} disabled={importBusy} />
              <button className="file-picker import-button" onClick={importFromUrl} disabled={importBusy || importerStatus !== "online"}>{importBusy ? "Importing…" : "Import video"} <span>↓</span></button>
              {importMessage && <p className="import-message">{importMessage}</p>}
              {importerStatus === "offline" && <p className="micro-note">Start <b>local-importer/run-windows.bat</b> from the project folder, then refresh this page. Keep its terminal window open.</p>}
              <p className="micro-note">Downloads run on your PC. Import only videos you own or are authorized to download; platform rules still apply.</p>
            </div>

            <div className="control-card">
              <div className="control-title"><span className="control-icon">⌁</span><div><strong>Trim clip</strong><small>Keep the best moment</small></div></div>
              <div className="time-row"><label>START <b>{formatTime(trimStart)}</b></label><label>END <b>{formatTime(trimEnd)}</b></label></div>
              <div className="range-control"><input aria-label="Trim start" type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={trimStart} disabled={!file} onChange={(e) => { const value = Number(e.target.value); setTrimStart(Math.min(value, trimEnd - 0.1)); if (videoRef.current) videoRef.current.currentTime = value; }} /></div>
              <div className="range-control"><input aria-label="Trim end" type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={trimEnd} disabled={!file} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))} /></div>
              <div className="duration-note">{file ? `${formatTime(Math.max(0, trimEnd - trimStart))} selected` : "Upload a video to set trim points"}</div>
            </div>

            <div className="control-card">
              <div className="control-title"><span className="control-icon">✦</span><div><strong>Auto subtitles</strong><small>Free Whisper AI · runs locally in your browser</small></div></div>
              <div className="subtitle-options">
                <label htmlFor="subtitle-language">Speech language</label>
                <select id="subtitle-language" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={transcriptionState === "capturing" || transcriptionState === "loading" || transcriptionState === "transcribing"}>
                  <option value="auto">Auto detect</option><option value="english">English</option><option value="hindi">Hindi</option><option value="marathi">Marathi</option><option value="urdu">Urdu</option><option value="spanish">Spanish</option><option value="french">French</option>
                </select>
              </div>
              <button className="file-picker transcribe-button" onClick={startTranscription} disabled={!file || ["capturing","loading","transcribing"].includes(transcriptionState)}>
                {transcriptionState === "capturing" ? "Capturing audio…" : transcriptionState === "loading" ? "Loading Whisper…" : transcriptionState === "transcribing" ? "Transcribing…" : captions.length ? "Regenerate subtitles" : "Generate auto subtitles"} <span>✦</span>
              </button>
              {["capturing","loading","transcribing"].includes(transcriptionState) && <div className="progress-track subtitle-progress"><div style={{ width: `${transcriptionState === "capturing" ? (duration ? (playhead / duration) * 100 : 0) : transcriptionProgress}%` }} /></div>}
              {transcriptionMessage && <p className={`transcription-message ${transcriptionState}`}>{transcriptionMessage}</p>}
              <p className="micro-note">First use downloads the small Whisper model. Internet is needed for that download; your video audio is processed on this device.</p>
              {captions.length > 0 && <>
                <div className="caption-list-head"><strong>{captions.length} caption lines</strong><button onClick={downloadSrt}>Download .SRT ↓</button></div>
                <div className="caption-list">
                  {captions.map((item) => <div className="caption-row" key={item.id}>
                    <div className="caption-times">
                      <label>IN <input type="number" min="0" max={duration} step="0.1" value={item.start.toFixed(1)} onChange={(e) => updateCaption(item.id, "start", Number(e.target.value))} /></label>
                      <label>OUT <input type="number" min="0" max={duration} step="0.1" value={item.end.toFixed(1)} onChange={(e) => updateCaption(item.id, "end", Number(e.target.value))} /></label>
                      <button title="Preview this caption" onClick={() => { if (videoRef.current) { videoRef.current.currentTime = item.start; videoRef.current.pause(); } }}>▶</button>
                    </div>
                    <textarea aria-label={`Caption ${item.id} text`} value={item.text} onChange={(e) => updateCaption(item.id, "text", e.target.value)} rows={2} />
                  </div>)}
                </div>
              </>}
            </div>

            <div className="control-card">
              <div className="control-title"><span className="control-icon">T</span><div><strong>Manual caption</strong><small>Used when auto subtitles are not generated</small></div></div>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={90} placeholder="Type your caption…" />
              <div className="caption-meta"><span>Preview updates as you type</span><span>{caption.length}/90</span></div>
            </div>

            <div className="export-panel">
              <div className="export-panel-head"><div><strong>Ready to export?</strong><small>Vertical video · 1080 × 1920 · 30 FPS</small></div><span className="sparkle">✳</span></div>
              <button className="export-button full" onClick={exportVideo} disabled={!file || exportState === "rendering"}>{exportState === "rendering" ? "Rendering your short…" : "Export video"} <span>↗</span></button>
              {exportState === "rendering" && <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>}
              {exportMessage && <p className={`export-message ${exportState}`}>{exportMessage}</p>}
              <p className="privacy-note">🔒 Video and captions are rendered in your browser.</p>
            </div>
          </section>
        </div>
        <footer className="footer"><span>Made for creators, one short at a time.</span><span>REA SHORTS STUDIO</span></footer>
      </section>
    </main>
  );
}
