# S1a shot detection

Run after S0 with the ingest environment:

```bash
python pipeline/run.py --youtube-id VIDEO_ID --stages S1a
```

S1a reads `work/<id>/S0/video.mp4` and writes `work/<id>/S1/shots.json`. PySceneDetect’s content detector detects hard cuts. A video without detected cuts produces one shot.

- `shots` lists all detected intervals in playback order. Each has an ID, start and end in seconds, start and end frame indices, and frame count. Intervals are zero-based and end-exclusive. Times are relative to the normalized video.
- `selected` is the default reconstruction interval. It uses the longest shot, with the earliest shot winning ties, and caps it at 60 seconds without crossing a cut. S1b uses this window for the scene card.
- `unreconstructed` covers the playback timeline outside the default selection. S9a packaging uses this field in the world manifest for the selected shot.
