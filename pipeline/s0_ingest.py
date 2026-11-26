"""S0 ingest: normalize one local video for the pipeline. The clip must be one continuous shot (no cuts).

    python pipeline/s0_ingest.py --work work/<id> --video clip.mp4 [--window a,b] [--source-start s]

  out: work/<id>/S0/video.mp4    1280x720, 30 fps H.264 (15-frame GOP, no B-pyramid) + AAC; aspect kept with
                                 padding; HDR (iPhone HLG/PQ) is tone-mapped to SDR, or colours wash out
       work/<id>/S0/frames/      one zero-indexed JPEG per encoded frame
       work/<id>/S0/thumbs.jpg + thumbs.json   2 fps seek-bar sprite, first tile at t = 0
       work/<id>/S0/ingest.json  {inputs, sourceStart, fps, frameCount, title}
YouTube clips are downloaded on a laptop first (pipeline/fetch_youtube.sh): YouTube blocks the GPU box.
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

FPS = 30
MAX_SECONDS = 60
THUMB_FPS = 2
TILE_WIDTH, TILE_HEIGHT = 160, 90
TILE_COLS = 10
HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}  # HLG, PQ
TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,"
           "zscale=t=bt709:m=bt709:r=tv,format=yuv420p,")


def progress(pct):
    print(json.dumps({"stage": "S0", "pct": pct, "eta": None}), flush=True)


def parse_window(value):
    start, end = map(float, value.split(","))
    if not (0 <= start < end and end - start <= MAX_SECONDS):
        sys.exit(f"--window must be start,end with 0 <= start < end and at most {MAX_SECONDS} s")
    return start, end


def is_hdr(ffprobe, video):
    r = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer",
                        "-of", "csv=p=0", str(video)], capture_output=True, text=True, check=True)
    return r.stdout.strip() in HDR_TRANSFERS


def encode(ffmpeg, video, output, start, duration, hdr):
    command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    subprocess.run([
        *command, "-ss", f"{start:.6f}", "-i", str(video), "-t", f"{duration:.6f}",
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", (TONEMAP if hdr else "") + "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,"
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
        sys.exit("the window contains no video frames")
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True, help="local video file (one continuous shot)")
    parser.add_argument("--window", default=f"0,{MAX_SECONDS}", help="start,end in seconds into --video")
    parser.add_argument("--source-start", type=float,
                        help="seconds into the original video where this clip starts (YouTube sync); default: window start")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    output = args.work / "S0"
    if (output / "ingest.json").exists() and not args.force:
        progress(100)
        return
    if not args.video.is_file():
        sys.exit(f"no such video: {args.video}")
    start, end = parse_window(args.window)
    ffmpeg = shutil.which("ffmpeg") or sys.exit("ffmpeg (with libx264 and zscale) is required")
    ffprobe = shutil.which("ffprobe") or sys.exit("ffprobe is required")

    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True)
    progress(0)
    hdr = is_hdr(ffprobe, args.video)
    frame_count = encode(ffmpeg, args.video, output, start, end - start, hdr)
    (output / "ingest.json").write_text(json.dumps({
        "inputs": {"video": str(args.video), "start": start, "end": end, "hdr": hdr},
        "sourceStart": start if args.source_start is None else args.source_start,
        "fps": FPS, "frameCount": frame_count, "title": args.video.stem,
    }) + "\n")
    progress(100)


if __name__ == "__main__":
    main()
