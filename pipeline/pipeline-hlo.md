# Pipeline High Level Overview

The pipeline is a set of offline stage scripts that turn about 60 seconds of a YouTube video into a **world package**: a walkable 3D scene (a Gaussian splat), the camera path, walk boundaries and animated 3D avatars of the people. The browser viewer only plays the package back. All the heavy work happens on a GPU box ahead of time.

## How it runs

`pipeline/run.py` is a runner that uses only Python's standard library. It works like a small `make`:

- **Skips finished stages:** each stage is skipped if its inputs haven't changed (it keeps a hash in `work/<id>/.done/`). Re-running one stage re-runs everything downstream of it.
- **Progress:** stages print JSON lines like `{"stage","pct","eta"}`. That's what the job worker and the progress screen read.
- **Errors:** a failure comes back as a readable reason from a fixed list, such as `download_blocked` or `reconstruction_failed`.
- **Separate environments:** each stage runs in its own conda environment (`pipeline/envs/*.yml`), because SAM 3, GVHMR, LHM and DA3 can't share one.

## The stages (as built)

| Stage | What it does | Model / tool |
|---|---|---|
| **S0 Ingest** | Downloads only the time window, converts it to 1280×720 at 30 fps with frequent keyframes for fast seeking, extracts frames, builds the seek-bar thumbnail sprite | yt-dlp, ffmpeg |
| **S1a Shots** | Detects cuts and picks the longest single shot (60 s max) | PySceneDetect |
| **S1b Director** | Gemini watches the clip and writes a scene card, plus animal and vehicle hints for segmentation. Works without a key. | Gemini (`gemini-3.5-flash-lite`) |
| **S2 Masks** | Tracks every person, animal and vehicle with a stable ID across the clip, and makes a union mask of all of them | SAM 3 |
| **S3 Cameras + depth** | Camera poses and metric depth on keyframes (5 fps) in **one global solve**, then interpolated to every frame | Depth Anything 3 |
| **S3b World frame** | Fits the floor plane (RANSAC), then sets floor = y=0, +Y up, metres, three.js axes | custom |
| **S4a Holes** | Finds background that no frame ever saw behind a person and inpaints it | LaMa |
| **S4 Background splat** | Trains a 3D Gaussian splat for 30k steps. **People are masked out of both the colour and the depth losses**, so no ghosts get baked in. Also penalises needle-shaped splats so the scene doesn't streak when you walk off the path. | gsplat (MCMC) |
| **S5 Bounds** | Voxel carving gives a "how well was this seen" grid (drives the fog), a walkable-area distance map and collider boxes | custom |
| **S6a Body tracking** | 3D body pose per person per frame, fed with SAM's own tracks, so each mask matches one body | GVHMR (SMPL-X body model) |
| **S6b Placement** | Puts bodies into the world: scale solved so feet land on the floor, feet pinned. Precomputes joint transforms so the browser needs no body-model code. | smplx |
| **S7a Identity frame** | Gemini picks the best front-facing crop of each person. Everything outside that person's own mask is blanked so a bystander's face can't be chosen. | Gemini |
| **S7 Avatar** | Builds a 3D Gaussian avatar from that one image, already in the same rest pose as the motion data, with skin weights | LHM-1B |
| **S8 People layer** | A video of real pixels plus depth for the people, so up close you see the actual person rather than the avatar | Video Depth Anything |
| **S9a Package** | Builds streamable level-of-detail splats (`.rad`/`.spz`) and writes `manifest.json` in the agreed format (PRD §8) | Spark build-lod |
| S4b (by hand) | Optional generative fill of unseen space. Generated splats are kept only *outside* the filmed area. | World Labs Atlas |

Details: [recon-pipeline.md](recon-pipeline.md), [people-pipeline.md](people-pipeline.md), [pipeline-runner.md](pipeline-runner.md).
# Pipeline overview

The pipeline is a set of offline stage scripts that turn about 60 seconds of a YouTube video into a **world package**: a walkable 3D scene (a Gaussian splat), the camera path, walk boundaries and animated 3D avatars of the people. The browser viewer only plays the package back. All the heavy work happens on a GPU box ahead of time.

## How it runs

`pipeline/run.py` is a runner that uses only Python's standard library. It works like a small `make`:

- **Skips finished stages:** each stage is skipped if its inputs haven't changed (it keeps a hash in `work/<id>/.done/`). Re-running one stage re-runs everything downstream of it.
- **Progress:** stages print JSON lines like `{"stage","pct","eta"}`. That's what the job worker and the progress screen read.
- **Errors:** a failure comes back as a readable reason from a fixed list, such as `download_blocked` or `reconstruction_failed`.
- **Separate environments:** each stage runs in its own conda environment (`pipeline/envs/*.yml`), because SAM 3, GVHMR, LHM and DA3 can't share one.

## The stages (as built)

| Stage | What it does | Model / tool |
|---|---|---|
| **S0 Ingest** | Downloads only the time window, converts it to 1280×720 at 30 fps with frequent keyframes for fast seeking, extracts frames, builds the seek-bar thumbnail sprite | yt-dlp, ffmpeg |
| **S1a Shots** | Detects cuts and picks the longest single shot (60 s max) | PySceneDetect |
| **S1b Director** | Gemini watches the clip and writes a scene card, plus animal and vehicle hints for segmentation. Works without a key. | Gemini (`gemini-3.5-flash-lite`) |
| **S2 Masks** | Tracks every person, animal and vehicle with a stable ID across the clip, and makes a union mask of all of them | SAM 3 |
| **S3 Cameras + depth** | Camera poses and metric depth on keyframes (5 fps) in **one global solve**, then interpolated to every frame | Depth Anything 3 |
| **S3b World frame** | Fits the floor plane (RANSAC), then sets floor = y=0, +Y up, metres, three.js axes | custom |
| **S4a Holes** | Finds background that no frame ever saw behind a person and inpaints it | LaMa |
| **S4 Background splat** | Trains a 3D Gaussian splat for 30k steps. **People are masked out of both the colour and the depth losses**, so no ghosts get baked in. Also penalises needle-shaped splats so the scene doesn't streak when you walk off the path. | gsplat (MCMC) |
| **S5 Bounds** | Voxel carving gives a "how well was this seen" grid (drives the fog), a walkable-area distance map and collider boxes | custom |
| **S6a Body tracking** | 3D body pose per person per frame, fed with SAM's own tracks, so each mask matches one body | GVHMR (SMPL-X body model) |
| **S6b Placement** | Puts bodies into the world: scale solved so feet land on the floor, feet pinned. Precomputes joint transforms so the browser needs no body-model code. | smplx |
| **S7a Identity frame** | Gemini picks the best front-facing crop of each person. Everything outside that person's own mask is blanked so a bystander's face can't be chosen. | Gemini |
| **S7 Avatar** | Builds a 3D Gaussian avatar from that one image, already in the same rest pose as the motion data, with skin weights | LHM-1B |
| **S8 People layer** | A video of real pixels plus depth for the people, so up close you see the actual person rather than the avatar | Video Depth Anything |
| **S9a Package** | Builds streamable level-of-detail splats (`.rad`/`.spz`) and writes `manifest.json` in the agreed format (PRD §8) | Spark build-lod |
| S4b (by hand) | Optional generative fill of unseen space. Generated splats are kept only *outside* the filmed area. | World Labs Atlas |

Details: [recon-pipeline.md](recon-pipeline.md), [people-pipeline.md](people-pipeline.md), [pipeline-runner.md](pipeline-runner.md).
