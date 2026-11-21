# S0 video ingest

S0 takes a YouTube ID and an optional source time window. Run it with the pipeline runner from the repo root.

```bash
python pipeline/run.py --stages S0 --youtube-id VIDEO_ID --window 0,47
```

Use the ingest environment for yt-dlp and the optional PO-token plugin. The encoding FFmpeg must support `libx264`. If the system FFmpeg lacks it, put a compatible build on PATH or set `S0_ENCODER_FFMPEG` to its executable. Deno should be on PATH or next to the ingest Python. If the video needs authenticated access, set `YTDLP_COOKIES` to a local yt-dlp cookies file. Keep that file outside Git.

Times are seconds from the original YouTube upload. The default window requests the first 60 seconds, and shorter sources end at their actual duration. For a trim already uploaded as its own YouTube video, start at zero.

S0 writes to `work/<id>/S0/`:

- `source.mp4` contains the downloaded window.
- `video.mp4` contains 1280×720, 30 fps H.264 video with a maximum 15-frame GOP and AAC audio when the source has audio. The source aspect ratio is preserved with padding.
- `frames/` contains one zero-indexed JPEG per encoded video frame.
- `thumbs.jpg` and `thumbs.json` contain the 2 fps seek-bar sprite and its index, with the first tile at playback time zero.
- `ingest.json` records the requested source start, FPS, and encoded frame count.

Repeating the same runner invocation skips S0. Use `--force` to regenerate outputs, including after an output is removed manually. An unsuccessful ingest keeps the previous S0 output directory in place.
