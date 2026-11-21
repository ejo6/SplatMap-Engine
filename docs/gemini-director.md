# S1b Gemini director

Run after S0 and S1a in the ingest environment:

```bash
python pipeline/run.py --youtube-id VIDEO_ID --stages S1b
```

With `GEMINI_API_KEY` exported, the director sends `S0/video.mp4` and the detected shot ranges to Gemini. Run it only on clips approved for that upload. The input is the S0 window, which is at most 60 seconds. To analyze a different part of a long source, rerun S0 with a different `--window`.

`S1/director.json` contains shot suitability with reasons, the chosen shot ID and playback window, time ranges and segmentation nouns for people, animals, and vehicles, and a scene card with a title and two sentences. The existing SAM 3 stage reads each subject's noun and kind. The director uses the detected frame-aligned shot boundaries for its selection.

If the key is unset, the request fails, or the response is invalid, the director selects the S1a default shot, uses the prompt `person`, and titles the card from S0 metadata. Older S0 outputs use the video ID as a title. A valid Gemini assessment with no usable shots returns `no_usable_shot`. Use `--force` to compare Gemini and fallback runs.
