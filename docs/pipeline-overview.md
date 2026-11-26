# Pipeline overview

The pipeline is a set of offline stage scripts that turn a clip of up to 60 seconds (one continuous shot) into a **world package**: a walkable 3D scene (a Gaussian splat), the camera path, walk boundaries and animated 3D avatars of the people. The browser viewer only plays the package back. All the heavy work happens on a GPU box ahead of time.

## How it runs

`pipeline/run.py` is a runner that uses only Python's standard library (usually started from a laptop with `pipeline/remote.sh`; see [pipeline-runner.md](pipeline-runner.md)). It works like a small `make`:

- **Skips finished stages:** each stage is skipped if its inputs (including its settings from `--preset`/`--set`) haven't changed (it keeps a hash in `work/<id>/.done/`). Re-running one stage re-runs everything downstream of it.
- **Progress:** stages print JSON lines like `{"stage","pct","eta"}`. That's what the job worker and the progress screen read.
- **Errors:** a failure comes back as a readable reason from a fixed list, such as `download_blocked` or `reconstruction_failed`.
- **Separate environments:** stages run in five conda environments (`pipeline/envs/*.yml`): `recon` and `sam3` for the world, and `people`, `lhm` and `depth` for the people stages. SAM 3, GVHMR, LHM and DA3 can't share one.

## The stages (as built)

| Stage | What it does | Model / tool |
|---|---|---|
| **S0 Ingest** | Converts a local clip to 1280×720 at 30 fps with frequent keyframes for fast seeking (tone-mapping iPhone HDR), extracts frames, builds the seek-bar thumbnail sprite. YouTube clips are downloaded on a laptop first (`fetch_youtube.sh`). | ffmpeg |
| **S2 Masks** | Tracks every person (plus any extra movers named in `--set S2.prompts=person,dog`) with a stable ID across the clip, and makes a union mask of all of them | SAM 3 |
| **S3 Cameras + depth** | Camera poses and metric depth on keyframes (5 fps) in **one global solve**, then interpolated to every frame | Depth Anything 3 |
| **S3b World frame** | Fits the floor plane (RANSAC), then sets floor = y=0, +Y up, metres, three.js axes | custom |
| **S4a Holes** | Finds background that no frame ever saw behind a person and inpaints it | LaMa |
| **S4 Background splat** | Trains a 3D Gaussian splat for 30k steps. **People are masked out of both the colour and the depth losses**, so no ghosts get baked in. Also penalises needle-shaped splats so the scene doesn't streak when you walk off the path. | gsplat (MCMC) |
| **S5 Bounds** | Voxel carving gives a "how well was this seen" grid (drives the fog), a walkable-area distance map and collider boxes | custom |
| **S6a Body tracking** | 3D body pose per person per frame, fed with SAM's own tracks, so each mask matches one body | GVHMR (SMPL-X body model) |
| **S6b Placement** | Puts bodies into the world: scale solved so feet land on the floor, feet pinned. Precomputes joint transforms so the browser needs no body-model code. | smplx |
| **S7 Avatar** | Picks the largest unclipped crop of each person (everything outside their own mask blanked) and builds a 3D Gaussian avatar from it, already in the same rest pose as the motion data, with skin weights | LHM-1B |
| **S8 People layer** | A video of real pixels plus depth for the people, so up close you see the actual person rather than the avatar | Video Depth Anything |
| **S9a Package** | Builds streamable level-of-detail splats (`.rad`/`.spz`) and writes `manifest.json` in the agreed format (PRD §8) | Spark build-lod |
| **S9b QA** | Renders the splat from the source cameras and scores it against the frames (PSNR/SSIM on non-person pixels), into `qa/` and `run.json` | gsplat |

Details: [recon-pipeline.md](recon-pipeline.md), [people-pipeline.md](people-pipeline.md), [pipeline-runner.md](pipeline-runner.md).
