"""Download and normalize one YouTube window for the reconstruction pipeline."""

import argparse
import fcntl
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FPS = 30
THUMB_FPS = 2
TILE_WIDTH, TILE_HEIGHT = 160, 90
TILE_COLS = 10


class IngestError(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code


def parse_window(value):
    try:
        start, end = map(float, value.split(","))
    except ValueError as exc:
        raise IngestError("invalid_url", "Window must be start,end in seconds.") from exc
    if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end
            and 1 / FPS <= end - start <= 60):
        raise IngestError("invalid_url", "Window must be positive and span one frame to 60 seconds.")
    return start, end


def progress(pct):
    print(json.dumps({"stage": "S0", "pct": pct, "eta": None}), flush=True)


def download(youtube_id, start, end, output, ffmpeg):
    args = [
        sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
        "--ffmpeg-location", ffmpeg,
        "--download-sections", f"*{start:.9f}-{end:.9f}",
        "--print", "after_move:%(title)j",
        "-f", "bv[height<=720][vcodec^=avc]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]",
        "--merge-output-format", "mp4", "--remux-video", "mp4",
        "--socket-timeout", "20", "--retries", "1", "-o", str(output / "source.%(ext)s"),
    ]
    deno = shutil.which("deno") or Path(sys.executable).with_name("deno")
    if Path(deno).is_file():
        args += ["--js-runtimes", f"deno:{deno}"]
    if cookies := os.environ.get("YTDLP_COOKIES"):
        args += ["--cookies", cookies]
    result = subprocess.run([*args, f"https://www.youtube.com/watch?v={youtube_id}"],
                            capture_output=True, text=True)
    if result.returncode or not nonempty(output / "source.mp4"):
        detail = result.stderr.lower()
        if any(marker in detail for marker in (
            "video unavailable", "private video", "has been removed",
            "not available in your country", "members-only", "not available anymore",
        )):
            raise IngestError("video_unavailable", "YouTube did not make this video available.")
        if "no matching chapters" in detail or "cannot download the selected section" in detail:
            raise IngestError("video_unavailable", "The requested video window is unavailable.")
        raise IngestError("download_blocked", "yt-dlp could not download the requested window.")
    title = result.stdout.strip().splitlines()
    return json.loads(title[-1]) if title else None


def encode(ffmpeg, output, duration):
    command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    subprocess.run([
        *command, "-i", str(output / "source.mp4"), "-t", f"{duration:.9f}",
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,"
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "18",
        "-g", "15", "-x264-params", "b-pyramid=none:open-gop=0",
        "-c:a", "aac", "-movflags", "+faststart", str(output / "video.mp4"),
    ], check=True)
    progress(55)
    frames = output / "frames"
    frames.mkdir()
    subprocess.run([
        *command, "-i", str(output / "video.mp4"), "-map", "0:v:0",
        "-q:v", "2", "-start_number", "0", str(frames / "%05d.jpg"),
    ], check=True)
    progress(80)
    frame_count = len(list(frames.glob("*.jpg")))
    if not frame_count:
        raise IngestError("video_unavailable", "The window contains no video frames.")
    count = math.ceil(frame_count / (FPS // THUMB_FPS))
    cols = min(TILE_COLS, count)
    rows = math.ceil(count / cols)
    subprocess.run([
        *command, "-i", str(output / "video.mp4"), "-vf",
        f"select=not(mod(n\\,{FPS // THUMB_FPS})),scale={TILE_WIDTH}:{TILE_HEIGHT},tile={cols}x{rows}",
        "-frames:v", "1", "-update", "1", "-q:v", "3", str(output / "thumbs.jpg"),
    ], check=True)
    (output / "thumbs.json").write_text(json.dumps({
        "sprite": "thumbs.jpg", "fps": THUMB_FPS, "cols": cols, "rows": rows,
        "count": count, "tileWidth": TILE_WIDTH, "tileHeight": TILE_HEIGHT,
    }) + "\n")
    return frame_count


def nonempty(path):
    return path.is_file() and path.stat().st_size > 0


def complete(output, inputs):
    try:
        record = json.loads((output / "ingest.json").read_text())
        return (record["inputs"] == inputs
                and all(nonempty(output / name) for name in (
                    "source.mp4", "video.mp4", "thumbs.jpg", "thumbs.json",
                ))
                and all(nonempty(output / "frames" / f"{i:05d}.jpg")
                        for i in range(record["frameCount"])))
    except (OSError, ValueError, KeyError):
        return False


def ingest(work, youtube_id, start, end, force):
    output = work / "S0"
    inputs = {"youtubeId": youtube_id, "start": start, "end": end}
    work.mkdir(parents=True, exist_ok=True)
    with (work / ".s0.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not force and complete(output, inputs):
            print(json.dumps({"stage": "S0", "pct": 100, "eta": 0, "skipped": True}), flush=True)
            return
        ffmpeg = shutil.which("ffmpeg") or shutil.which("ffmpeg", path=str(Path(sys.executable).parent))
        if not ffmpeg:
            raise IngestError("internal", "FFmpeg with libx264 is required.")
        with tempfile.TemporaryDirectory(prefix=".s0-", dir=work) as temp:
            staging = Path(temp) / "new"
            staging.mkdir()
            progress(0)
            title = download(youtube_id, start, end, staging, ffmpeg)
            progress(35)
            frame_count = encode(os.environ.get("S0_ENCODER_FFMPEG", ffmpeg), staging, end - start)
            (staging / "ingest.json").write_text(json.dumps({
                "inputs": inputs, "sourceStart": start, "fps": FPS, "frameCount": frame_count,
                "title": title,
            }) + "\n")
            previous = Path(temp) / "previous"
            if output.exists():
                output.rename(previous)
            try:
                staging.rename(output)
            except OSError:
                if previous.exists():
                    previous.rename(output)
                raise
    progress(100)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--youtube-id", required=True)
    parser.add_argument("--window", default="0,60", help="start,end in seconds")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", args.youtube_id):
            raise IngestError("invalid_url", "Expected an 11-character YouTube video ID.")
        start, end = parse_window(args.window)
        ingest(args.work, args.youtube_id, start, end, args.force)
    except IngestError as exc:
        print(json.dumps({"error": exc.code, "detail": str(exc)}), flush=True)
        return 1
    except (OSError, subprocess.CalledProcessError):
        print(json.dumps({"error": "internal", "detail": "S0 encoding or output writing failed."}),
              flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
