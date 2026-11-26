#!/usr/bin/env bash
# Laptop only (YouTube blocks the GPU box): download one window of a YouTube video for the pipeline.
#   pipeline/fetch_youtube.sh <youtubeId> <start> <end>      times in seconds or [hh:]mm:ss
# Writes work/uploads/<youtubeId>.mp4 and prints the remote.sh command that builds it.
# Needs yt-dlp and ffmpeg (brew install yt-dlp ffmpeg). The clip must be one continuous shot, at most 60 s.
set -euo pipefail
[ $# -eq 3 ] || { sed -n 2,5p "$0"; exit 1; }
ID=$1 START=$2 END=$3
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/work/uploads && mkdir -p "$OUT"
secs() { awk -F: '{ s = 0; for (i = 1; i <= NF; i++) s = s * 60 + $i; print s }' <<< "$1"; }

yt-dlp -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]" --merge-output-format mp4 \
  --download-sections "*$START-$END" --force-keyframes-at-cuts \
  -o "$OUT/$ID.%(ext)s" "https://www.youtube.com/watch?v=$ID"

echo
echo "Saved $OUT/$ID.mp4. Build it with:"
echo "  pipeline/remote.sh <user@host:port> $OUT/$ID.mp4 --set S0.source-start=$(secs "$START")"
