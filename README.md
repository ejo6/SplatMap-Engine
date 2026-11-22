# Step Into the Video

On a YouTube watch page, a **Step inside** button sits next to Like. Clicking it opens a new tab where the video becomes a 3D place you can walk around in, and around the people in it, while the original video and audio keep playing. Everything the camera saw is real reconstructed geometry. We don't invent what wasn't filmed.

## How it works

1. **Extension.** A Chrome MV3 extension adds the button and opens `/w/<youtubeId>?t=<seconds>`. The landing page at `/` does the same from a pasted link or the demo gallery.
2. **Pipeline.** An offline GPU pipeline turns one shot of a video (60 s or less) into a **world package**:
   - S0 ingest (yt-dlp, ffmpeg)
   - S1 shot detection, plus Gemini as the "director"
   - S2 SAM 3 masks
   - S3 Depth Anything 3 cameras and depth, aligned to a floor-up metric frame
   - S4 gsplat Gaussian-splat background
   - S5 walk bounds
   - S6–S8 people: body tracking, LHM avatars and a real-pixel people layer
   - S9 packaging
3. **Viewer.** A Vite + three.js + [Spark](https://sparkjs.dev) app renders the splat world. The original video is the master clock. You can walk (WASD) or ride along with the recorded camera, and scrubbing the timeline glides you back to where the camera stood.

The full spec is in [docs/prd.md](docs/prd.md).

## Quick start (viewer)

Packaged demo worlds are committed in `worlds/`, so a fresh clone runs with no GPU and no keys:

```bash
cd web && npm install && npm run dev
```

Open http://localhost:5173 for the landing page and gallery, or http://localhost:5173/w/9lY7iZl1KbI to go straight to a world. `web/public/worlds` is a symlink to the repo-root `worlds/`. See [docs/demo-worlds.md](docs/demo-worlds.md).

### Controls

| Input | Action |
|---|---|
| Click canvas | Capture mouse |
| WASD / mouse | Walk / look |
| Shift | Run |
| Space | Play / pause |
| ← / → | −5 s / +5 s |
| C | Rejoin the camera at the current time |
| R | Restart from the beginning |
| Esc | Release mouse |

## Chrome extension

1. Run the web app as above.
2. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `extension/`.
3. Play a YouTube video and click **Step inside**.

The viewer origin is set in `extension/config.js`. See [docs/extension-setup.md](docs/extension-setup.md).

## Building a world (GPU pipeline)

Copy `.env.example` to `.env` and fill in only the keys you need (`GEMINI_API_KEY`, `HF_TOKEN`, …). The GPU box setup is in [docs/gpu-setup.md](docs/gpu-setup.md). Each model family gets its own conda env from `pipeline/envs/*.yml`.

```bash
python pipeline/run.py --youtube-id <id> --stages S0..S9 [--window a,b] [--force]
```

Intermediate output goes to `work/<id>/` (git-ignored), and the packaged world goes to `worlds/<id>/v1/`. Stage details, skip logic and the stage script contract are in [docs/pipeline-runner.md](docs/pipeline-runner.md).

## Repo layout

| Path | Contents |
|---|---|
| `extension/` | MV3 extension (Step inside button) |
| `web/` | Landing page and viewer (Vite + TypeScript + three.js + Spark); people rendering in `web/src/people/` |
| `pipeline/` | Stage scripts `s0_ingest.py` … `s9_package.py`, runner `run.py`, conda envs `envs/` |
| `server/` | FastAPI job API and GPU worker (P1) |
| `config/` | `gemini.yaml` (pinned model, prompts) |
| `worlds/` | Committed demo world packages |
| `docs/` | PRD, world format, pipeline stages, GPU setup, demo notes |

## Docs

- [docs/prd.md](docs/prd.md): product, scope, architecture and contracts
- [docs/world-format.md](docs/world-format.md): world package format
- [docs/recon-pipeline.md](docs/recon-pipeline.md), [docs/people-pipeline.md](docs/people-pipeline.md), [docs/gemini-director.md](docs/gemini-director.md): pipeline internals
- [docs/JIRA.md](docs/JIRA.md): tickets and team setup (Jira project `KAN`)

## Licences

This is a non-commercial hackathon demo. Some weights are research-only: Pi3X, DA3 Large/Giant and SMPL/SMPL-X. SAM 3 is under Meta's own licence. The details are in [PRD §17](docs/prd.md).
