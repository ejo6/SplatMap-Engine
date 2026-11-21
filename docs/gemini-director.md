# S1b Gemini director

Run after S0 and S1a in the ingest environment:

```bash
python pipeline/run.py --youtube-id VIDEO_ID --stages S1b
```

S1a owns the reconstruction window. S1b always writes that window and a baseline `person` prompt to `S1/director.json`. With `GEMINI_API_KEY` exported, S1b sends `S0/video.mp4` and the chosen shot to Gemini for a scene card and optional animal and vehicle hints. Run it only on clips approved for that upload.

When the key is absent or Gemini fails, S1b writes a local scene card using the S0 title. Older S0 outputs use the video ID. SAM 3 always uses its generic person prompt and adds distinct animal and vehicle nouns from the director output if present. Multiple person nouns would risk duplicate tracks for the same people.

To verify the no-key path when a cached result exists:

```bash
env -u GEMINI_API_KEY python pipeline/run.py --youtube-id VIDEO_ID --stages S1b --force
```
