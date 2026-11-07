from __future__ import annotations

import ipaddress
import os
import socket
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

ROOT = Path(__file__).resolve().parent
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(exist_ok=True)
MAX_BYTES = 500 * 1024 * 1024

app = FastAPI(title="REA Shorts Studio Local Importer", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:4173", "http://127.0.0.1:4173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ImportRequest(BaseModel):
    url: HttpUrl


def validate_public_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(400, "Only public HTTP or HTTPS media URLs are supported.")
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost") or host.endswith(".local"):
        raise HTTPException(400, "Local and private network addresses are not allowed.")
    try:
        addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        for item in addresses:
            ip = ipaddress.ip_address(item[4][0])
            if not ip.is_global:
                raise HTTPException(400, "Private or local network addresses are not allowed.")
    except socket.gaierror:
        raise HTTPException(400, "The media host could not be resolved.")
    return value


@app.get("/api/health")
def health():
    return {"ok": True, "service": "rea-shorts-local-importer", "max_file_mb": MAX_BYTES // (1024 * 1024)}


@app.post("/api/import")
def import_media(request: ImportRequest):
    url = validate_public_url(str(request.url))
    job_id = uuid.uuid4().hex
    job_dir = DOWNLOADS / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    options = {
        "outtmpl": str(job_dir / "%(title).100B-%(id)s.%(ext)s"),
        "format": "best[ext=mp4]/best",
        "noplaylist": True,
        "max_filesize": MAX_BYTES,
        "socket_timeout": 20,
        "retries": 2,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "windowsfilenames": True,
    }
    try:
        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
            if info.get("_type") == "playlist":
                raise HTTPException(400, "Playlists are not supported. Paste a single video URL.")
            filename = Path(ydl.prepare_filename(info))
            if not filename.exists():
                # Some extractors change the final extension after post-processing.
                matches = list(job_dir.glob("*"))
                if not matches:
                    raise HTTPException(502, "The importer finished without producing a video file.")
                filename = matches[0]
            if filename.stat().st_size > MAX_BYTES:
                filename.unlink(missing_ok=True)
                raise HTTPException(413, "The video is larger than the 500 MB import limit.")
            return {
                "id": job_id,
                "title": info.get("title") or filename.stem,
                "filename": filename.name,
                "size": filename.stat().st_size,
                "download_url": f"/api/files/{job_id}",
            }
    except HTTPException:
        raise
    except DownloadError as exc:
        raise HTTPException(422, f"Could not import this URL: {str(exc)[:350]}")
    except Exception as exc:
        raise HTTPException(500, f"Import failed: {str(exc)[:250]}")


@app.get("/api/files/{job_id}")
def get_imported_file(job_id: str):
    if len(job_id) != 32 or any(ch not in "0123456789abcdef" for ch in job_id):
        raise HTTPException(404, "File not found.")
    folder = (DOWNLOADS / job_id).resolve()
    if folder.parent != DOWNLOADS.resolve() or not folder.is_dir():
        raise HTTPException(404, "File not found.")
    files = [p for p in folder.iterdir() if p.is_file()]
    if len(files) != 1:
        raise HTTPException(404, "Imported file not found.")
    return FileResponse(files[0], filename=files[0].name, media_type="application/octet-stream")
