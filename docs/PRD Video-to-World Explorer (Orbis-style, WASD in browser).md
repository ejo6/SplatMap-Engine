# PRD: Video-to-World Explorer (Orbis-style, WASD in browser)

## 1. Overview

A website where someone pastes a video link, watches the clip, and walks into its 3D scene with mouse and WASD while the original video keeps playing and its people keep moving.

**Working title:** Video-to-World Explorer (placeholder).

**Problem.** A video is a flat window onto a moment. The Orbis Engine (Hack the North 2026) showed that an ordinary video can be turned into a 3D scene you stand inside, but it targets a Meta Quest headset, which almost nobody at a demo table owns.

**Product.** The same idea in a desktop browser: no headset, no install. The viewer behaves like a first-person game or a street-level map. You pointer-lock the mouse, move with W/A/S/D, and look around while the source video plays as the master clock for everything that moves.

**How it works, in one paragraph.** The system estimates the camera path from the video, removes the people, builds a static 3D room (a Gaussian splat) from the cleaned frames, optionally rebuilds each person as an animated avatar, and bundles the result. The browser loads the bundle and drives the avatars from the video's playback time. This is a static room plus animated actors, not a true 4D reconstruction.

**How it differs from Orbis.**

- Desktop browser with pointer lock and WASD instead of WebXR and Meta Quest.
- Cheaper first version: reconstruction only, with the walkable area limited to where the camera actually went, so no paid generation is required.
- Runs on our own rented GPU (Vultr credits) instead of Modal and AWS.
- Built around a cache: demo clips are processed ahead of time, so the live path is a lookup and a viewer, not a pipeline.

## 2. Goals, non-goals and success metrics

For the 36-hour hackathon the goal is a reliable, rehearsed demo of 3 to 5 pre-processed clips; the live any-URL pipeline is a stretch goal.

**Goals (hackathon)**

1. Walk around a 3D scene built from a real video, in a desktop browser, with WASD and mouse look.
2. Play the source video alongside, with pause and scrub working, using the video as the single clock.
3. Make the live path fast: pasting a URL of a pre-processed clip opens the scene in seconds, from cache.
4. Show the full pipeline architecture credibly, so judges see how it scales beyond the demo clips.

**Non-goals (hackathon)**

- Working on any arbitrary YouTube video.
- True 4D (dynamic splat) reconstruction of everything that moves.
- VR headsets, voice conversations, picking up objects.
- Autonomous scaling, billing or user accounts.

**Success metrics.** These are proposed targets, to be tuned once the first clip is running.

| Metric                                            | Target                                                 | Applies to   |
| ------------------------------------------------- | ------------------------------------------------------ | ------------ |
| Cached clip: URL paste to first interactive frame | 5 s or less                                            | Demo         |
| Viewer frame rate on the demo laptop              | 30 fps or more while walking                           | Demo         |
| Splat download size per clip                      | Small enough to load in about 10 s on the demo network | Demo         |
| Audio/video drift after pause and scrub           | Imperceptible (aim under 100 ms)                       | Demo         |
| Demo clips passing the QA walkthrough             | 3 of 3 minimum, 5 aimed for                            | Demo         |
| Demo works with wifi off                          | Yes                                                    | Demo         |
| Job success rate for suitable clips               | To be measured                                         | Full product |
| Median time from submit to ready                  | To be measured                                         | Full product |
| Triage accuracy (suitable clips that finish well) | To be measured                                         | Full product |

## 3. Users and use cases

The first audience is people watching a hackathon demo; the product audience is anyone who wants to step into a clip they already care about.

**Personas**

- **Demo audience (judges, peers):** wants to see something surprising in under a minute, on a laptop, with no setup.
- **Curious viewer:** a fan of a movie scene, a sports moment or an old family video who wants to look around the moment from other angles.
- **Learner:** watches a workout, dance or craft tutorial and wants to walk around the instructor to check form.
- **Creator (later):** uploads their own footage and shares an explorable version.

**Use cases and how well single-camera reconstruction suits them**

| Use case                 | Example                                             | Fit                                                      |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| Walk-through of a space  | A slow forward-moving shot through a room or street | Good: real parallax, mostly static scene                 |
| Tutorial with one person | A trainer in a room, camera fairly steady           | Fair: room works; avatar quality is the risk             |
| Sports moment            | A replay of a play                                  | Poor: fast motion, cuts, many moving people, moving ball |
| Movie scene              | A dialogue scene with cuts                          | Poor to fair: one world per shot, heavy cutting          |
| Static tripod shot       | A fixed camera on a stage                           | Poor: almost no parallax to reconstruct from             |
| Personal video           | A phone clip walking through a place                | Good if slow and not blurry                              |

## 4. Scope and phasing

Build in tiers, each of which is a complete demo on its own, so a failure at one tier leaves the previous one standing.

| Tier | What it delivers                                                                                                         | Hackathon priority                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| T0   | Browser viewer that loads a sample splat file with pointer-lock WASD                                                     | Must (hour 0 to 6, proves the viewer) |
| T1   | One real clip: Pi3X poses, person masks, LaMa, gsplat room, plus the original video on a floating screen inside the room | Must                                  |
| T2   | 3 to 5 pre-processed clips, cache lookup by video ID, bounded walkable area and fog                                      | Must                                  |
| T3   | Live job for a short clip: submit URL, triage, queue, progress, notify                                                   | Should (stretch)                      |
| T4   | Marble-generated room for 2 to 3 hero clips, then trained against real frames                                            | Could (about $5 to $15)               |
| T5   | Animated avatars (LHM) driven by tracked motion, synced to the video clock                                               | Could (highest risk)                  |
| T6   | Multi-shot videos, voice conversations, VR, user uploads and accounts                                                    | Won't (roadmap)                       |

**Fallback order if time runs out.** Drop T5, then T4, then T3. T0 to T2 is the minimum viable demo.

**Out of scope entirely for this build:** true 4D reconstruction, objects other than people animating, crowds, relighting, editing tools, mobile layout polish, and anything requiring a headset.

## 5. User experience and flows

The main flow is four screens: paste a link, see whether the clip is supported, wait (or not), then explore.

**Main flow**

1. **Landing.** One field: "Paste a video link". A gallery of ready-made demo scenes sits below it, each with a thumbnail and a short label.
2. **Resolve.** The app normalizes the URL to a video ID and clip range, then looks it up in the cache.
3. **Result states** (see table below). A cached clip skips straight to step 5.
4. **Processing.** A progress page showing the real stage (queued, poses, people, room, quality check). As soon as an early stage finishes, show a low-fidelity preview such as the point cloud, then upgrade it.
5. **Viewer.** Click to enter. Mouse looks, W/A/S/D walks at eye height, the video plays in a corner or on an in-scene screen.

**Viewer controls**

| Input           | Action                                                            |
| --------------- | ----------------------------------------------------------------- |
| Click the scene | Lock the pointer and enter the world                              |
| Mouse           | Look around                                                       |
| W / A / S / D   | Walk forward, left, back, right                                   |
| Shift           | Walk faster                                                       |
| Esc             | Release the pointer and show the menu                             |
| Space or K      | Play and pause the video                                          |
| Timeline bar    | Scrub the video and everything synced to it                       |
| R               | Return to the spawn point                                         |
| V               | Toggle the video between the in-scene screen and a corner overlay |

**States and messages**

| State                      | What the user sees                                                        | Next action                                            |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Ready (cached)             | Opens straight into the viewer                                            | Explore                                                |
| Queued or processing       | Progress by stage, with a preview when available                          | Wait or leave and be notified                          |
| Not suitable               | A specific reason, such as "almost no camera movement" or "too many cuts" | Choose another clip or segment                         |
| Not in the demo set        | "This video is not processed yet"                                         | Queue it (if live jobs are on) or pick a gallery scene |
| Failed quality gate        | "We couldn't build this one well"                                         | Try another clip                                       |
| Load error or slow network | A retry button and a lower-quality option                                 | Retry                                                  |
| No WebGL or weak GPU       | A short message and a video-only fallback                                 | Use the video                                          |

## 6. Functional requirements

Priority key: **M** = must for the hackathon, **S** = should, **C** = could, **L** = later (full product).

**Ingest and URL handling**

| ID     | Requirement                                                                                                                      | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-1.1 | Accept common URL forms (`youtu.be`, `watch?v=`, with timestamps) and reduce them to a video ID plus optional start and end time | M        |
| FR-1.2 | Look up the video ID and range in the cache before doing any work                                                                | M        |
| FR-1.3 | For uncached clips, download a low-resolution copy and the full-quality segment for processing                                   | S        |
| FR-1.4 | Reject or flag clips longer than the maximum (target 10 to 30 s per world)                                                       | S        |
| FR-1.5 | Allow a direct file upload as an alternative to a URL                                                                            | L        |

**Triage (before any GPU time)**

| ID     | Requirement                                                            | Priority |
| ------ | ---------------------------------------------------------------------- | -------- |
| FR-2.1 | Detect shot cuts and split the video into shots                        | S        |
| FR-2.2 | Score each shot for camera parallax, blur, length and number of people | S        |
| FR-2.3 | Select the best shot or let the user choose a segment                  | S        |
| FR-2.4 | Return a specific, human-readable reason when a clip is unsuitable     | S        |
| FR-2.5 | Show a compatibility score at paste time                               | L        |

**Processing pipeline**

| ID      | Requirement                                                                                                         | Priority |
| ------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-3.1  | Extract frames and audio (ffmpeg, OpenCV)                                                                           | M        |
| FR-3.2  | Estimate camera pose for every frame (Pi3X) and keep the point map if available                                     | M        |
| FR-3.3  | Segment and track each person, with masks grown slightly to cover shadows and edges                                 | M        |
| FR-3.4  | Fill the masked regions with LaMa to produce clean frames                                                           | M        |
| FR-3.5  | Train a Gaussian splat from the clean frames and poses with gsplat, ignoring person pixels in the loss              | M        |
| FR-3.6  | Optionally generate a Marble room first and train it against the real frames instead of starting from the point map | C        |
| FR-3.7  | Fit scale and floor height so the room and avatars are in consistent units                                          | S        |
| FR-3.8  | Rebuild each tracked person as an LHM avatar and estimate per-frame body motion                                     | C        |
| FR-3.9  | Each stage is resumable and saves its output; paid API calls are recorded in a ledger with idempotency keys         | S        |
| FR-3.10 | Run a quality gate before publishing (see section 11)                                                               | S        |

**Viewer**

| ID     | Requirement                                                                                                   | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------- | -------- |
| FR-4.1 | Render the splat in the browser with Three.js and Spark                                                       | M        |
| FR-4.2 | Pointer-lock mouse look and WASD walking at eye height                                                        | M        |
| FR-4.3 | Constrain the camera to the walkable bounds and a floor height from the manifest                              | M        |
| FR-4.4 | Fade to fog or blur beyond the reconstructed region                                                           | M        |
| FR-4.5 | Spawn at the original camera's starting pose                                                                  | M        |
| FR-4.6 | Show a loading progress bar and degrade gracefully on weak GPUs                                               | S        |
| FR-4.7 | Click-to-teleport between pre-set viewpoints along the original camera path as an alternative to free walking | C        |

**Video and sync**

| ID     | Requirement                                                               | Priority |
| ------ | ------------------------------------------------------------------------- | -------- |
| FR-5.1 | Play the local mp4 (not a YouTube embed) as the master clock              | M        |
| FR-5.2 | Show the video on an in-scene screen and in a corner overlay              | M        |
| FR-5.3 | Pause, play and scrub update everything that depends on time              | M        |
| FR-5.4 | Use `requestVideoFrameCallback` where available for frame-accurate timing | S        |

**Avatars**

| ID     | Requirement                                                                                           | Priority |
| ------ | ----------------------------------------------------------------------------------------------------- | -------- |
| FR-6.1 | Load one skinned avatar per tracked person and pose it from the motion data at the current video time | C        |
| FR-6.2 | Place each avatar so its feet land on the floor at its tracked position                               | C        |
| FR-6.3 | Hide an avatar when its track is absent in the current frame                                          | C        |

**Cache, storage and operations**

| ID     | Requirement                                                                                                            | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-7.1 | Store each processed clip as a versioned bundle keyed by video ID and range                                            | M        |
| FR-7.2 | Serve bundles from local disk for the demo with a CDN copy as backup                                                   | M        |
| FR-7.3 | Prefetch the splat and video while the user is on the landing page                                                     | S        |
| FR-7.4 | Cache intermediate stage outputs by clip hash so a re-run is cheap                                                     | S        |
| FR-7.5 | Job queue with status (queued, processing, ready, failed), one GPU job at a time, and queue position shown to the user | S        |
| FR-7.6 | Notify the user when a job finishes (realtime update, optional email)                                                  | C        |

## 7. System architecture

A cached clip goes straight to the viewer; only a cache miss starts a job on the GPU worker, which runs eight stages and publishes a bundle so the next request is a hit.

&#91;embedded content: architecture · cache check, then 8 worker stages\]

The worker pulls jobs from the queue, so it needs no inbound network access. Each stage saves its output, and a ledger records every paid call so a crashed job resumes instead of repeating or double-billing. Optional stages are not drawn: Marble runs before step 6 if used, and LHM avatars with motion estimation run after step 4 if used.

**What each stage hands to the next**

| Stage                 | Takes                                | Gives                                         |
| --------------------- | ------------------------------------ | --------------------------------------------- |
| 1 Triage              | Low-res video                        | Accept or reject with a reason; the best shot |
| 2 Frames              | Chosen shot                          | Frames and audio                              |
| 3 Camera poses (Pi3X) | Frames                               | Pose per frame; point map                     |
| 4 People              | Frames                               | Person masks and tracks                       |
| 5 Clean plate (LaMa)  | Frames and masks                     | Frames with people removed                    |
| 6 Room splat (gsplat) | Clean frames, poses, masks to ignore | The room splat                                |
| 7 Quality gate        | Splat, held-out frames               | Pass or fail, plus metrics                    |
| 8 Publish             | Splat, poses, video, manifest        | A versioned bundle in the cache               |

## 8. Technology stack

Most of the core pipeline is what Orbis shipped; what changes is the infrastructure, the viewer controls and the caching around it. "Orbis" below means named in their Devpost writeup; "Ours" means our own choice, which can be swapped.

| Stage                       | Technology                                                 | Source                  | Notes                                                                           |
| --------------------------- | ---------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| Download                    | yt-dlp                                                     | Ours                    | See section 13 on terms of service                                              |
| Frames, audio               | ffmpeg, OpenCV                                             | Orbis                   | CPU                                                                             |
| Shot detection              | PySceneDetect                                              | Ours                    | CPU                                                                             |
| Motion and blur scoring     | OpenCV optical flow, variance of the Laplacian             | Ours                    | CPU, used in triage                                                             |
| Camera poses                | Pi3X                                                       | Orbis                   | GPU; as far as we know it also outputs a point map                              |
| Person masking and tracking | A segmentation model plus tracker                          | Orbis (model not named) | Candidates: SAM-family video segmentation, or a YOLO segmenter with a tracker   |
| Inpainting                  | LaMa                                                       | Orbis                   | Fills masked regions; per-frame, so can flicker                                 |
| Scene prompt, QA, scale     | GPT vision (or Gemini)                                     | Orbis (GPT)             | Only needed for Marble prompts, judging renders, and finding known-size objects |
| Room generation             | Marble (World Labs)                                        | Orbis                   | Optional, paid API                                                              |
| Splat training              | gsplat                                                     | Orbis                   | GPU; the longest stage                                                          |
| Avatars                     | LHM                                                        | Orbis                   | GPU; needs a pose estimator for motion, which Orbis does not name               |
| Quality metrics             | PSNR, SSIM, LPIPS (torchmetrics or lpips)                  | Ours                    | Hold-out frames                                                                 |
| Compute                     | Vultr GPU instance                                         | Ours                    | Replaces Modal and AWS                                                          |
| Queue and database          | Supabase / Postgres                                        | Ours                    | Jobs table, realtime updates                                                    |
| Storage and delivery        | S3-compatible object storage, CDN, local disk for the demo | Ours                    |                                                                                 |
| Web app                     | Next.js, TypeScript                                        | Ours                    |                                                                                 |
| 3D viewer                   | Three.js, Spark                                            | Orbis                   | Orbis also used WebXR; we replace it with pointer lock                          |
| Sync                        | HTML video element as clock, `requestVideoFrameCallback`   | Orbis idea              |                                                                                 |

**Used by Orbis and dropped**

- WebXR and Meta Quest (no headset in our version).
- Modal and AWS (replaced by Vultr).
- Realtime voice conversations and Codex/Devin tooling (not product features).

**Approaches Orbis tried and abandoned, which we should not repeat**

- Depth Anything 3, VGGT and Brush for rebuilding the room: good only from the original camera position.
- V-DPM and PIFuHD for people: melted limbs.
- Stable Virtual Camera, GeoNVS, GEN3C and Lyra for generating missing views: invented or garbled scenes.
- Correcting avatar poses against the footage: it made them worse, because one camera cannot tell how far away a hand is.

**If Marble is not used.** The splat starts from the Pi3X point map and is trained only on what the camera saw. Unseen areas stay empty, so the walkable area is limited to a corridor around the original camera path, with fog beyond it.

## 9. Data model and artifact bundle

Each processed clip is one versioned bundle, described by a manifest the viewer reads first; the cache key is the video ID, the clip range and the pipeline version.

**Cache key:** `<videoId>:<startSec>-<endSec>:v<pipelineVersion>`. Bumping the pipeline version never overwrites a good older bundle.

**Files in a bundle**

| File                                              | Purpose                                                      |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `manifest.json`                                   | Everything the viewer needs to place and constrain the scene |
| `clip.mp4`                                        | Local video with audio; the master clock                     |
| `scene.spz` (or similar compressed splat)         | The room                                                     |
| `camera_path.json`                                | Per-frame camera poses from Pi3X                             |
| `avatars/<trackId>.*` and `motion/<trackId>.json` | Avatar assets and per-frame body motion (optional)           |
| `thumb.jpg`                                       | Gallery and loading screen                                   |
| `qa.json`                                         | Hold-out metrics and the manual QA result                    |

**Manifest (sketch; field names are proposals)**

```json
{
  "cacheKey": "abc123XYZ:12-34:v1",
  "source": { "videoId": "abc123XYZ", "startSec": 12, "endSec": 34 },
  "pipelineVersion": 1,
  "video": { "file": "clip.mp4", "fps": 30, "durationSec": 22 },
  "scene": {
    "splat": "scene.spz",
    "unitsPerMeter": 1.0,
    "floorY": 0.0,
    "eyeHeight": 1.6,
    "spawn": { "position": [0, 1.6, 0], "yawDeg": 0 },
    "walkable": {
      "type": "corridor",
      "pathFile": "camera_path.json",
      "radiusM": 1.5,
      "maxYawDeg": 60
    },
    "fog": { "nearM": 2.0, "farM": 5.0 }
  },
  "avatars": [
    { "trackId": 1, "asset": "avatars/1.glb", "motion": "motion/1.json" }
  ],
  "qa": {
    "passed": true,
    "holdoutPsnr": null,
    "holdoutSsim": null,
    "holdoutLpips": null
  }
}
```

**Jobs table (Postgres or Supabase)**

| Column                     | Meaning                                               |
| -------------------------- | ----------------------------------------------------- |
| `id`                       | Job ID                                                |
| `cache_key`                | Unique per clip, range and pipeline version           |
| `status`                   | `queued`, `processing`, `ready`, `failed`, `rejected` |
| `stage`                    | Current stage name, for progress display              |
| `reason`                   | Human-readable reason for `rejected` or `failed`      |
| `bundle_url`               | Where the finished bundle lives                       |
| `created_at`, `updated_at` | Timestamps                                            |

**Paid-call ledger.** One row per paid API call with an idempotency key (cache key plus stage plus attempt), the credits spent, and the result pointer. A crashed job reads the ledger and resumes instead of paying twice.

## 10. Non-functional requirements

The live demo path must feel instant because everything slow has already been done; the heavy path only has to be reliable and honest about how long it takes.

| Area                  | Requirement                            | Target                                                                                                            |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Latency (cached clip) | URL paste to first interactive frame   | 5 s or less                                                                                                       |
| Latency (new clip)    | Submit to ready                        | Minutes to hours; show stage progress and a queue position; measure, do not promise                               |
| Splat size            | Small enough to load fast              | Prune low-opacity Gaussians, reduce colour detail, use a compressed format; measure load time on the demo network |
| Frame rate            | Walking in the viewer                  | 30 fps or more on the demo laptop; cap render resolution if needed                                                |
| Sync                  | Video clock to avatar and screen state | No visible drift; scrub and pause work                                                                            |
| Offline               | Demo with wifi off                     | Everything served from the laptop; CDN copy only as backup                                                        |
| Reliability           | Pipeline recovery                      | Each stage resumable; ledger prevents double billing; failed jobs keep their intermediate files                   |
| Security              | GPU worker                             | Pulls jobs outbound only; no inbound ports; API keys on the server, never in the browser                          |
| Portability           | Browsers                               | Current Chrome on desktop is the target; others best effort                                                       |
| Observability         | Debugging a run                        | Per-stage logs and timings saved with each job                                                                    |
| Versioning            | Bundles                                | Immutable; new pipeline version creates a new bundle                                                              |

**Latency budget for the live path (cached clip)**

1. Normalize URL and look up the manifest: tens of milliseconds.
2. Fetch the manifest, then prefetch the splat and video in parallel: seconds, dominated by file size and network.
3. Parse and upload the splat to the GPU and compile shaders: a warm-up before the demo removes most of this.
4. Enter the scene: pointer lock on click.

These are estimates; the first end-to-end run should record the real numbers for each step.

## 11. Quality gates and acceptance criteria

A clip is published only if it passes triage, the automated hold-out check and a human walkthrough; any failure marks it "couldn't build this one" instead of showing a broken scene.

**Gate 1: triage (before GPU time).** All thresholds below are placeholders to tune on the first 5 test clips.

| Signal          | How it is measured                                                 | Accept if                                                                           |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Shot length     | Shot detection                                                     | One shot of roughly 8 to 30 s is available                                          |
| Camera parallax | Optical flow or feature tracking: translation versus pure rotation | Real translation, not a tripod pan or a static shot                                 |
| Blur            | Variance of the Laplacian on sampled frames                        | Above a threshold tuned on test clips                                               |
| People          | Detector count                                                     | Few enough for the avatar tier (start at 3 or fewer); room-only tier tolerates more |
| Cuts            | Shot detection                                                     | The chosen shot has no internal cuts                                                |

**Gate 2: hold-out check (after training).** Hold out a fraction of frames (start with about 1 in 10) from training. Render the splat from those camera poses and compare against the real frames.

```latex
\mathrm{PSNR} = 10 \log_{10}\!\left( \frac{\mathrm{MAX}^2}{\mathrm{MSE}} \right)
```

Higher PSNR and SSIM, and lower LPIPS, are better. Pass thresholds are set after seeing the first few clips; until then the manual walkthrough decides. Where a person was masked out, exclude those pixels from the comparison. Optionally add a vision-model check that flags obvious breakage in renders.

**Gate 3: manual walkthrough (required for every demo clip)**

- [ ] Spawn point looks right and the first view is clean
- [ ] Walk the full allowed area: no large holes, floaters or smears inside the bounds
- [ ] The fog or blur boundary hides the edge of the reconstruction
- [ ] Floor height and eye height feel right; no walking through walls
- [ ] Video starts, pauses and scrubs without audio/video drift
- [ ] Avatars (if present) stand on the floor and move with the video
- [ ] Load time on the demo laptop and network is acceptable
- [ ] Works with wifi off

**Acceptance for the hackathon build.** At least 3 clips pass all three gates, the viewer holds 30 fps on the demo laptop, and the full demo script runs twice in a row without intervention.

## 12. Risks and mitigations

The biggest risks are reconstruction quality on real videos and environment setup time, so the plan front-loads both.

| Risk                                                                    | Likelihood             | Impact | Mitigation                                                                           | Fallback                                          |
| ----------------------------------------------------------------------- | ---------------------- | ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| GPU environment setup takes hours (CUDA, gsplat compile, model weights) | High                   | High   | Start first; snapshot the disk once it works; keep a Docker image                    | Use a smaller pipeline (Pi3X point cloud viewer)  |
| Reconstruction looks bad on a chosen clip                               | High                   | High   | Pick clips with slow forward motion and real parallax; run triage; QA walkthrough    | Swap in another clip; use a pre-made sample splat |
| Unseen areas empty or smeared                                           | Certain without Marble | Medium | Limit the walkable corridor; fog beyond it                                           | Add Marble for 2 to 3 hero clips                  |
| Person masks or tracks fail (crowds, occlusion)                         | Medium                 | Medium | Choose clips with few people; grow masks                                             | Room-only tier; video on a screen                 |
| Avatars look wrong (melted limbs, wrong back view, depth errors)        | High                   | Medium | Make avatars optional; do not correct poses against footage                          | Drop avatars entirely                             |
| Animated Gaussian avatars are hard to render in a browser               | Medium                 | Medium | Time-box a spike early                                                               | Use mesh avatars or skip                          |
| Spark or splat file too heavy for the demo laptop                       | Medium                 | High   | Prune and compress; cap resolution; test on the real laptop                          | Lower-detail bundle                               |
| Venue wifi unreliable                                                   | High                   | High   | Serve from laptop; test with wifi off                                                | Screen recording of a perfect run                 |
| Paid API or GPU credits run out                                         | Low                    | Medium | Ledger of paid calls; check credits before the event                                 | Reconstruction-only                               |
| YouTube download blocked or against terms                               | Medium                 | Medium | Pre-download only clips we may use; prefer clips we own or that are Creative Commons | File upload                                       |
| Audio and video drift in the viewer                                     | Medium                 | Medium | Use the local mp4 as the clock; `requestVideoFrameCallback`                          | Resync on scrub                                   |
| Scope creep into avatars, VR or multi-shot                              | High                   | High   | Tiered scope with fixed cut lines (section 4)                                        | Cut T5, T4, T3 in that order                      |

## 13. Legal, terms-of-service and ethics

For a demo, process only clips we have the right to use; for a real product, downloading arbitrary YouTube videos and hosting 3D versions of them is a legal problem to solve before launch. This section is not legal advice.

- **YouTube terms.** Downloading videos with tools such as yt-dlp can conflict with YouTube's terms of service. Treat download as a development convenience, not a product feature.
- **Copyright.** A 3D scene derived from someone else's footage is likely a derivative of it. Hosting and sharing those scenes publicly raises the same questions as hosting the video.
- **Safer content for the demo and early product:** clips we filmed ourselves, Creative Commons or public-domain footage, and user-uploaded files that the uploader has the rights to.
- **People in the footage.** Rebuilding a real person as a controllable 3D avatar raises consent and likeness concerns. Keep avatars optional, do not offer voice cloning or impersonation, and avoid private individuals in public demos.
- **Third-party terms.** Check the terms of Marble, OpenAI or Gemini, and each model's license (Pi3X, LHM, LaMa, gsplat, any segmentation model) before using outputs commercially. Some research models carry non-commercial licenses.
- **Disclosure.** Label demo scenes honestly as pre-processed and cached, and label avatars as reconstructions, not recordings.
- **Data handling.** If users can upload videos, define retention and deletion before accepting any.

## 14. Cost model

Generation is cheap per clip (about $1 to $2.50 for a Marble world); the real cost is GPU time and engineering hours, and the Vultr compute credits cover the GPU side.

**Marble (World Labs API), approximate and to be verified.** According to the [World Labs API pricing page](https://docs.worldlabs.ai/api/pricing), credits are sold at $1.00 per 1,250 credits with a $5.00 minimum purchase, and across input types the marble-1.1-plus model averages about $1.71 per world with a maximum near $2.48. Standard Marble 1.1 is reported at roughly $1.20 to $1.28 per world. API credits are billed separately from the Marble web app, so app credits cannot be used. I read these figures from search results rather than opening the full page, so confirm them before buying.

| Item                                 | Basis                                           | Estimate                                                                |
| ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Marble, 5 hero clips                 | 5 x about $1.20 to $2.50                        | About $6 to $13                                                         |
| Marble, 10 clips with one retry each | 20 x about $1.20 to $2.50                       | About $24 to $50                                                        |
| Vultr GPU                            | Hourly rate of the chosen instance x hours run  | Covered by compute credits; confirm the GPU type, VRAM and credit total |
| GPT or Gemini vision calls           | A few frames per clip for prompts, QA and scale | Small; cap per job                                                      |
| Object storage and CDN               | A few tens of MB per clip                       | Negligible at demo scale                                                |

**Controls for the full product**

- Per-user daily quota of jobs and a cap on clip length.
- Cache everything permanently so a popular video is processed once.
- Triage before the GPU so unsuitable clips cost almost nothing.
- Stop or snapshot the GPU instance when idle, since it bills while on.
- The paid-call ledger blocks duplicate Marble charges when a job resumes.

## 15. 36-hour execution plan

Plan for three workstreams (Pipeline, Viewer, Platform and demo); with fewer people, merge Viewer and Platform and cut T3 first. Hours are counted from kickoff and are proposals.

| Hours    | Pipeline (GPU)                                                        | Viewer                                                      | Platform and demo                                          |
| -------- | --------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| 0 to 2   | Shortlist 5 to 8 candidate clips; start GPU instance                  | Repo, Three.js and Spark scaffold                           | Repo, Supabase project, storage bucket                     |
| 2 to 8   | Environment: CUDA, Pi3X weights, gsplat build; snapshot when it works | **T0:** load a sample splat with pointer-lock WASD          | Next.js shell, URL normalizer, manifest loader             |
| 8 to 16  | **T1:** first clip end to end (frames, poses, masks, LaMa, gsplat)    | Video as clock, in-scene screen, bounds, fog, spawn         | Cache lookup by video ID, gallery page, bundle format      |
| 16 to 24 | **T2:** process 3 to 5 clips; QA each one                             | Frame-rate tuning, splat prune and compress, load-time work | Jobs table and queue, progress page, local and CDN serving |
| 24 to 30 | Stretch: Marble on hero clips, or an avatar spike (decide at hour 24) | Avatar playback if the spike worked; otherwise polish       | Triage heuristics, notifications, architecture slide       |
| 30 to 34 | **Feature freeze at hour 30.** Final re-runs and re-QA                | Bug fixes only                                              | Offline test, backup recording, demo script                |
| 34 to 36 | Idle on call                                                          | Idle on call                                                | Rehearse twice, submit                                     |

**Checkpoints and cut lines**

1. **Hour 8:** the viewer shows a sample splat and the GPU box can run Pi3X. If the GPU box is not working, switch Pipeline to a smaller flow (point cloud viewer) and ask for help early.
2. **Hour 16:** one real clip is walkable in the browser with the video playing. If not, pick an easier clip before anything else.
3. **Hour 24:** at least 3 clips pass QA. If not, stop all stretch work and fix quality.
4. **Hour 30:** feature freeze. Nothing new after this point except bug fixes.

**Pre-event preparation** (only if the hackathon rules allow it; check what counts as pre-existing code)

- [ ] Read the hackathon rules on pre-existing work and research
- [ ] Confirm Vultr GPU type, VRAM and credit balance
- [ ] Draft a Docker image or a setup script for the GPU environment
- [ ] Shortlist candidate clips that are filmed by us, Creative Commons or otherwise cleared
- [ ] Buy World Labs API credits (minimum purchase is small) if Marble will be used
- [ ] Find a sample Gaussian splat file to test the viewer
- [ ] Test the viewer on the actual demo laptop and screen
- [ ] Decide roles and who owns the demo script

## 16. Demo plan

The demo is a two to three minute walk through pre-processed clips, run entirely from the laptop, with a recorded backup and one honest slide on how the pipeline scales.

**Script (about 3 minutes)**

1. **Hook (20 s):** show the original video, then paste its link. The scene opens within seconds (served from cache, and we say so).
2. **Enter (40 s):** click, walk with WASD, turn around, and show the video playing in the scene while time moves.
3. **Time control (20 s):** pause and scrub; the scene and anything synced to the clock follow.
4. **Second clip (30 s):** a different kind of scene, to show it is not a one-off.
5. **How it works (40 s):** one architecture slide: triage, queue, GPU stages, quality gate, cache, viewer.
6. **Honesty beat (20 s):** show a clip the triage rejects, with its reason, and state the limits (static room, only people move).
7. **Close (10 s):** roadmap: more videos, avatars, multi-shot.

**Safety nets**

- Screen recording of a perfect run, ready to play.
- All bundles on the laptop, wifi tested off, CDN copy as backup.
- A pre-warmed browser tab per clip so shaders are already compiled.
- A pre-made sample splat as the last-resort scene.

**Rehearsal checklist**

- [ ] Full run on the demo laptop and projector or screen, twice in a row
- [ ] Full run with wifi off
- [ ] Deliberately bad URL and a not-suitable clip handled gracefully
- [ ] Pause and scrub in every clip
- [ ] Backup recording tested and one click away
- [ ] Roles: who talks, who drives the keyboard, who answers questions about each stage

## 17. Open questions, roadmap, glossary and references

The biggest unknowns are which GPU the credits cover and what the hackathon rules say about pre-existing work.

**Open questions**

- Which Vultr GPU type, how much VRAM, and how many credits? This decides whether the full pipeline fits.
- How many people are on the team, and who owns each workstream?
- What do the hackathon rules allow for pre-event setup and pre-existing code?
- Which clips are we allowed to use, and who can film original ones?
- Do we use Marble at all, and are World Labs credits offered by the hackathon?
- Which person segmentation model and which pose estimator do we use for tracking and avatar motion (Orbis does not name theirs)?
- How do we render animated Gaussian avatars in a browser (the Orbis writeup does not explain it)?
- What is the demo laptop and screen, and is its GPU strong enough?

**Roadmap after the hackathon**

1. Live jobs for arbitrary uploaded or licensed clips, with triage and quotas.
2. Avatars for more than one person, with better motion estimation.
3. Multi-shot videos: one world per shot, with transitions.
4. Progressive previews: a quick point cloud first, then the full splat.
5. Shareable links, accounts and moderation.
6. Optional VR support for headsets, restoring the original Orbis experience.

**Glossary**

| Term           | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| Camera pose    | The camera's position and orientation in 3D for one frame                            |
| Point map      | A 3D point for each pixel, estimated from an image                                   |
| Gaussian splat | A scene made of many soft, coloured 3D blobs that can be drawn from any angle        |
| gsplat         | A CUDA library for training and rendering Gaussian splats                            |
| Inpainting     | Filling in masked pixels with plausible content                                      |
| LaMa           | The inpainting model Orbis used to remove people                                     |
| Marble         | World Labs' generative model that produces a full 3D world, including unseen regions |
| LHM            | A model that turns an image of a person into an animatable 3D avatar                 |
| Pi3X           | The model that estimates camera poses from video frames                              |
| Spark          | A browser renderer for Gaussian splats, used with Three.js                           |
| Pointer lock   | A browser feature that captures the mouse for first-person look                      |
| Master clock   | The one timeline (the video's playback time) that everything else follows            |
| Triage         | Cheap checks that decide whether a clip is worth GPU time                            |

**References**

- Orbis Engine, Hack the North 2026 Devpost submission, including its [demo video](https://youtu.be/fvC2Ax81VGE).
- [World Labs API pricing](https://docs.worldlabs.ai/api/pricing)
- [WorldSplat](https://github.com/timscheuerai/worldsplat) (open-source text-to-splat attempt)
- [OpenMarble](https://github.com/mohamedsobhi777/OpenMarble) (image-to-splat using Apple's SHARP model)
- [HunyuanWorld-Voyager](https://huggingface.co/tencent/HunyuanWorld-Voyager) and [HunyuanWorld 1.0](https://arxiv.org/abs/2507.21809) (open world-generation models)
