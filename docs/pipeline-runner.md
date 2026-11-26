# Running the pipeline

One command turns a local video into a world package. Box setup: [gpu-setup.md](gpu-setup.md). Stage internals: [recon-pipeline.md](recon-pipeline.md), [people-pipeline.md](people-pipeline.md).

## The clip

- **One continuous shot, no cuts.** There is no cut detection: a cut fuses two places into one broken world. Trim the clip first.
- **60 s or less** (S0 keeps the first 60 s unless you pass `--window`). 15–40 s works best.
- **What works:** steady handheld walks in good light. iPhone 0.5× (ultra-wide) clips gave the best splats so far. Low-light clips came out poorly.
- iPhone HDR `.MOV` files are fine: S0 tone-maps HLG/PQ to SDR by itself.

## From your laptop (usual path)

```bash
pipeline/remote.sh root@<ip>:<port> ~/Movies/IMG_6714.MOV --preset fast
```

`remote.sh` copies `pipeline/`, `config/` and the clip to the box, then starts `run.py` there under `nohup` (a dropped ssh doesn't kill it) and streams its progress. When the run finishes, it copies `worlds/<id>/` back to your laptop, plus `run.json` and `qa/` into `work/<id>/`.

- Everything after the clip is passed to `run.py`.
- To re-run stages of a clip that's already on the box, pass `--id` instead of a file: `pipeline/remote.sh root@<ip>:<port> --id IMG_6714 --set S4.steps=50000`.
- `GPU=1` picks a GPU, and `SSH_OPTS="-i $HOME/.ssh/id_ed25519"` adds ssh options. Check that the GPU is free first (`nvidia-smi`). Use one clip per GPU, because S2 and S3 each need most of an A40. Never kill a process you didn't start.
- Then view the world: run `npm --prefix web run dev` and open `http://localhost:5173/w/<id>`. Click to look, WASD to walk, C to rejoin the camera.

**YouTube clips:** YouTube blocks the box, so download on the laptop first:

```bash
pipeline/fetch_youtube.sh <youtubeId> 34:53 35:30
```

This writes `work/uploads/<youtubeId>.mp4` and prints the `remote.sh` command for it. The printed command passes `--set S0.source-start=<seconds>` so the world stays in sync with the YouTube video in the extension. It needs `yt-dlp` and `ffmpeg` on the laptop.

## `run.py`

```
python pipeline/run.py --video clip.mp4 [--id NAME] [--window a,b] [--preset fast|quality]
                       [--set STAGE.flag=value ...] [--no-people] [--stages S0..S9] [--force] [--work-root work]
```

On the box, run it with `/workspace/envs/recon/bin/python` (it needs Python 3.11+ and nothing else).

| Option | Effect |
|---|---|
| `--video` | Local clip. Only needed until S0 has run; later runs can pass just `--id`. |
| `--id` | World id: output goes to `work/<id>/` and `worlds/<id>/v1/`. Defaults to the file name. Use the 11-character YouTube id for YouTube clips. |
| `--window a,b` | Seconds into the video for S0. |
| `--preset` | A table in [`config/pipeline.toml`](../config/pipeline.toml). `fast` is a 7k-step S4 for a quick look; `quality` is 50k steps. Without a preset, every stage uses its script defaults. |
| `--set STAGE.flag=value` | Passes `--flag value` to one stage and overrides the preset. Repeatable. Examples: `S4.steps=50000`, `S2.prompts=person,dog,car`, `S3.kf-fps=10`. The flags are each script's own argparse flags (`python pipeline/<script> -h`). |
| `--no-people` | Skips S6a–S8 (no avatars, no people layer). S2 still runs, so people are still erased from the world. |
| `--stages` | An inclusive range (`S3..S5`) or a list (`S2,S8`). `S3` means S3 and S3b, `S4` means S4a and S4, `S9` means S9a and S9b. |
| `--force` | Re-runs the selected stages even if they're done. |

On the box it also sets up each stage's environment itself: `/workspace/.env` (`HF_TOKEN`), `HF_HOME` and `TORCH_HOME` on the volume, and the conda `cuda-toolkit` paths that gsplat and LHM need to compile CUDA code. Nothing needs to be sourced first.

## Stages

The table is `STAGES` in `run.py`.

| Stage | Script | Env | Depends on | Default error |
|---|---|---|---|---|
| S0 | `s0_ingest.py` | recon | | video_unavailable |
| S2 | `s2_masks.py` | sam3 | S0 | people_failed |
| S3 | `s3_cameras.py` | recon | S0 | reconstruction_failed |
| S3b | `s3b_world.py` | recon | S3 | reconstruction_failed |
| S4a | `s4a_holes.py` | recon | S2, S3b | reconstruction_failed |
| S4 | `s4_background.py` | recon | S2, S3b, S4a | reconstruction_failed |
| S5 | `s5_bounds.py` | recon | S4 | reconstruction_failed |
| S6a | `s6_body.py` | people | S2, S3b | people_failed |
| S6b | `s6_place.py` | people | S6a | people_failed |
| S7 | `s7_avatar.py` | lhm | S6b | people_failed |
| S8 | `s8_people_layer.py` | depth | S2, S3b | people_failed |
| S9a | `s9_package.py` | recon | S5, S6b, S7, S8 | internal |
| S9b | `tools/align_check.py` | recon | S4 | internal |

S0 (`s0_ingest.py`) writes `work/<id>/S0/` with these files:

- `video.mp4`: 1280×720 at 30 fps, H.264 with a 15-frame GOP (for fast seeking), plus AAC audio. The aspect ratio is kept, with padding.
- `frames/`: one zero-indexed JPEG per frame.
- `thumbs.jpg` and `thumbs.json`: the 2 fps seek-bar sprite.
- `ingest.json`: `{inputs, sourceStart, fps, frameCount, title}`.

The whole clip is one shot (`shots[0]`, `unreconstructed: []`). The title is the file name. The scene card is empty.

S9b renders the splat from the source cameras and scores it against the frames on non-person pixels (PSNR/SSIM). It writes `work/<id>/qa/`. Use it to compare settings.

## Outputs, skipping and errors

- After a stage succeeds, the runner writes `work/<id>/.done/<stage>.json` = `{inputs, finished, seconds}`. `inputs` hashes the stage's args (including preset and `--set` flags) and the `finished` time of each dependency. A stage whose hash still matches is skipped. So changing `S4.steps` re-runs S4, S5, S9a and S9b, and nothing else. Hand-edited outputs aren't detected: use `--force`.
- `work/<id>/run.json` records the id, git commit, preset, `--set` flags, each stage's args and seconds, and the S9b `qa` scores. Keep it alongside any quality experiment.
- stdout is only JSON lines:
  - `{"stage","pct","eta"}`: progress.
  - `{"stage","pct":100,"skipped":true}`: a skipped stage.
  - `{"stage","error","detail"}`: the last line on failure. The exit code is 1.
- Everything else goes to stderr. With `remote.sh` that's `work/<id>/run.err` on the box.

## Stage script contract

- **Args:** `--work work/<id>`, plus the runner's flags for that stage. S0 gets `--video` and `--window`. `--force` is added when the runner decides the stage must re-run.
- **Outputs:** written under `work/<id>/<S-number>/`. Substages share their stage's folder, e.g. S3b writes into `S3/`.
- **Progress:** print `{"stage","pct","eta"}` JSON lines to stdout.
- **Errors:** exit non-zero. To choose a specific error, print `{"error": "...", "detail": "..."}` first. Otherwise the runner uses the stage's default error, with the last 20 output lines as the detail.

## Gotchas

| Symptom | Cause / fix |
|---|---|
| People missing (`skip oN: solved height …` in `run.err`) | S6b drops people whose fitted height is under 1.2 m: seated people, partly visible people, or steep ground. Their pixels are still erased from the world. |
| Too many people / want fewer avatars | After S2, edit `S2/tracks.json` to keep only the instances you want, then re-run with `--stages S6a..S9 --force`. |
| World is white in the viewer | People and world must both load as ExtSplats; this is already handled in `web/src/main.ts`. Pull `main`. |
| `rsync` permission errors on the box | The network volume rejects `chown`, so use `rsync -rlt` (not `-a`). `remote.sh` already does. |

- **Never commit `worlds/<id>`** (each is 40–220 MB), `.env`, keys or model weights.
- Don't run `pkill -f <pattern>` over ssh: it can match your own ssh command.
