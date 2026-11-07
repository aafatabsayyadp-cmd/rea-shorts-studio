import { ChangeEvent, useEffect, useRef, useState } from "react";

type ExportState = "idle" | "rendering" | "done" | "error";

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "00:00";
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [caption, setCaption] = useState("Your next big idea starts here.");
  const [playing, setPlaying] = useState(false);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
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
    setExportState("idle");
    setExportMessage("");
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
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

    if (text.trim()) {
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
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = test;
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
    }
  };

  const exportVideo = async () => {
    const video = videoRef.current;
    if (!video || !file) return;
    if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream) {
      setExportState("error");
      setExportMessage("MP4 export is not supported by this browser. Try Chrome or Edge.");
      return;
    }
    if (trimEnd <= trimStart) {
      setExportState("error");
      setExportMessage("Choose a valid trim range first.");
      return;
    }

    setExportState("rendering");
    setProgress(0);
    setExportMessage("Preparing your vertical video…");

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the export canvas.");

      const canvasStream = canvas.captureStream(30);
      const sourceStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
        ?? (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
      if (sourceStream) {
        sourceStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      }

      const mimeType = MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac")
        ? "video/mp4;codecs=h264,aac"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";
      const recorder = new MediaRecorder(canvasStream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };

      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("The browser stopped the export unexpectedly."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      video.pause();
      video.currentTime = trimStart;
      await new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - trimStart) < 0.05) resolve();
        else video.addEventListener("seeked", () => resolve(), { once: true });
      });

      recorder.start(250);
      await video.play();
      let animation = 0;
      const render = () => {
        if (context) drawFrame(context, video, caption);
        const currentProgress = Math.min(100, ((video.currentTime - trimStart) / (trimEnd - trimStart)) * 100);
        setProgress(currentProgress);
        if (video.currentTime >= trimEnd || video.ended) {
          video.pause();
          cancelAnimationFrame(animation);
          recorder.stop();
          return;
        }
        animation = requestAnimationFrame(render);
      };
      render();

      const blob = await finished;
      canvasStream.getTracks().forEach((track) => track.stop());
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${file.name.replace(/\.[^.]+$/, "")}-short.${extension}`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      setExportState("done");
      setExportMessage(`Your ${extension.toUpperCase()} is ready and downloaded.`);
      setProgress(100);
      setPlaying(false);
    } catch (error) {
      setExportState("error");
      setExportMessage(error instanceof Error ? error.message : "Export failed. Please try again.");
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">R</div><div><strong>REA</strong><span>SHORTS STUDIO</span></div></div>
        <div className="side-label">WORKSPACE</div>
        <button className="nav-item active"><span>▣</span> Editor</button>
        <button className="nav-item" onClick={() => fileInputRef.current?.click()}><span>＋</span> New project</button>
        <div className="sidebar-bottom"><div className="local-badge"><span /> LOCAL PROCESSING</div><p>Your videos stay on this device. Nothing is uploaded.</p><div className="version">EARLY ACCESS · 0.1.0</div></div>
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
              {file ? (
                <div className="phone-frame">
                  <video ref={videoRef} src={videoUrl} onLoadedMetadata={onMetadata} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={() => {
                    const v = videoRef.current;
                    if (v && v.currentTime >= trimEnd && !v.paused) { v.pause(); v.currentTime = trimStart; }
                  }} />
                  <div className="preview-caption">{caption || "Your caption appears here"}</div>
                  <button className="play-overlay" onClick={togglePlayback} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? "Ⅱ" : "▶"}</button>
                </div>
              ) : (
                <button className="upload-card" onClick={() => fileInputRef.current?.click()}>
                  <div className="upload-icon">↑</div><strong>Drop a video to get started</strong><span>or click to browse files</span><small>MP4 · MOV · WEBM · Local files only</small>
                </button>
              )}
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

            <div className="control-card">
              <div className="control-title"><span className="control-icon">⌁</span><div><strong>Trim clip</strong><small>Keep the best moment</small></div></div>
              <div className="time-row"><label>START <b>{formatTime(trimStart)}</b></label><label>END <b>{formatTime(trimEnd)}</b></label></div>
              <div className="range-control"><input aria-label="Trim start" type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={trimStart} disabled={!file} onChange={(e) => { const value = Number(e.target.value); setTrimStart(Math.min(value, trimEnd - 0.1)); if (videoRef.current) videoRef.current.currentTime = value; }} /></div>
              <div className="range-control"><input aria-label="Trim end" type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={trimEnd} disabled={!file} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))} /></div>
              <div className="duration-note">{file ? `${formatTime(Math.max(0, trimEnd - trimStart))} selected` : "Upload a video to set trim points"}</div>
            </div>

            <div className="control-card">
              <div className="control-title"><span className="control-icon">T</span><div><strong>Caption overlay</strong><small>Add a simple hook or subtitle</small></div></div>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={90} placeholder="Type your caption…" />
              <div className="caption-meta"><span>Preview updates as you type</span><span>{caption.length}/90</span></div>
            </div>

            <div className="export-panel">
              <div className="export-panel-head"><div><strong>Ready to export?</strong><small>Vertical video · 1080 × 1920 · 30 FPS</small></div><span className="sparkle">✳</span></div>
              <button className="export-button full" onClick={exportVideo} disabled={!file || exportState === "rendering"}>{exportState === "rendering" ? "Rendering your short…" : "Export video"} <span>↗</span></button>
              {exportState === "rendering" && <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>}
              {exportMessage && <p className={`export-message ${exportState}`}>{exportMessage}</p>}
              <p className="privacy-note">🔒 Processed in your browser. Your footage stays yours.</p>
            </div>
          </section>
        </div>
        <footer className="footer"><span>Made for creators, one short at a time.</span><span>REA SHORTS STUDIO</span></footer>
      </section>
    </main>
  );
}