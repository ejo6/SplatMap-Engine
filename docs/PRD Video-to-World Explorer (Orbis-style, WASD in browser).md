# PRD: Video-to-World Explorer (Orbis-style, WASD in browser)

Nov 20, 2026 · @Sharib Masum

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

| Metric | Target | Applies to |
| --- | --- | --- |
| Cached clip: URL paste to first interactive frame | 5 s or less | Demo |
| Viewer frame rate on the demo laptop | 30 fps or more while walking | Demo |
| Splat download size per clip | Small enough to load in about 10 s on the demo network | Demo |
| Audio/video drift after pause and scrub | Imperceptible (aim under 100 ms) | Demo |
| Demo clips passing the QA walkthrough | 3 of 3 minimum, 5 aimed for | Demo |
| Demo works with wifi off | Yes | Demo |
| Job success rate for suitable clips | To be measured | Full product |
| Median time from submit to ready | To be measured | Full product |
| Triage accuracy (suitable clips that finish well) | To be measured | Full product |
| Scrub: time from a seek to the actor standing in the right place | Within one rendered frame after the video seeks; no network request | Demo |

## 3. Users and use cases

The first audience is people watching a hackathon demo; the product audience is anyone who wants to step into a clip they already care about.

**Personas**

- **Demo audience (judges, peers):** wants to see something surprising in under a minute, on a laptop, with no setup.
- **Curious viewer:** a fan of a movie scene, a sports moment or an old family video who wants to look around the moment from other angles.
- **Learner:** watches a workout, dance or craft tutorial and wants to walk around the instructor to check form.
- **Creator (later):** uploads their own footage and shares an explorable version.

**Use cases and how well single-camera reconstruction suits them**

| Use case | Example | Fit |
| --- | --- | --- |
| Walk-through of a space | A slow forward-moving shot through a room or street | Good: real parallax, mostly static scene |
| Tutorial with one person | A trainer in a room, camera fairly steady | Fair: room works; avatar quality is the risk |
| Sports moment | A replay of a play | Poor: fast motion, cuts, many moving people, moving ball |
| Movie scene | A dialogue scene with cuts | Poor to fair: one world per shot, heavy cutting |
| Static tripod shot | A fixed camera on a stage | Poor: almost no parallax to reconstruct from |
| Personal video | A phone clip walking through a place | Good if slow and not blurry |
| Lecture hall | A professor walks, gestures and uses the board during a 1-minute clip | Fair for the moving-actor logic; poor if the camera is fixed (little parallax), so the hall may need to be generated with Marble or filmed with some camera movement |

## 4. Scope and phasing

Build in tiers, each of which is a complete demo on its own, so a failure at one tier leaves the previous one standing.

| Tier | What it delivers | Hackathon priority |
| --- | --- | --- |
| T0 | Browser viewer that loads a sample splat file with pointer-lock WASD | Must (do first; proves the viewer) |
| T1 | One real clip: Pi3X poses, person masks, LaMa, gsplat room, plus the original video on a floating screen inside the room | Must |
| T2 | 3 to 5 pre-processed clips, cache lookup by video ID, bounded walkable area and fog | Must |
| T3 | Live job for a short clip: submit URL, triage, queue, progress, notify | Should (stretch) |
| T4 | Marble-generated room for 2 to 3 hero clips, then trained against real frames | Could (about $5 to $15) |
| T5 | Animated avatars (LHM) driven by tracked motion, synced to the video clock | Could (highest risk) |
| T6 | Multi-shot videos, voice conversations, VR, user uploads and accounts | Won't (roadmap) |

**Fallback order if time runs out.** Drop T5, then T4, then T3. T0 to T2 is the minimum viable demo.

**Out of scope entirely for this build:** true 4D reconstruction, objects other than people animating, crowds, relighting, content that changes on surfaces (slides on a projector, whiteboard writing), editing tools, mobile layout polish, and anything requiring a headset.

## 5. User experience and flows

The main flow is four screens: paste a link, see whether the clip is supported, wait (or not), then explore.

**Main flow**

1. **Landing.** One field: "Paste a video link". A gallery of ready-made demo scenes sits below it, each with a thumbnail and a short label.
2. **Resolve.** The app normalizes the URL to a video ID and clip range, then looks it up in the cache.
3. **Result states** (see table below). A cached clip skips straight to step 5.
4. **Processing.** A progress page showing the real stage (queued, poses, people, room, quality check). As soon as an early stage finishes, show a low-fidelity preview such as the point cloud, then upgrade it.
5. **Viewer.** Click to enter. Mouse looks, W/A/S/D walks at eye height, the video plays in a corner or on an in-scene screen.

**Viewer controls**

| Input | Action |
| --- | --- |
| Click the scene | Lock the pointer and enter the world |
| Mouse | Look around |
| W / A / S / D | Walk forward, left, back, right |
| Shift | Walk faster |
| Esc | Release the pointer and show the menu |
| Space or K | Play and pause the video |
| Timeline bar | Scrub the video and everything synced to it |
| R | Return to the spawn point |
| V | Toggle the video between the in-scene screen and a corner overlay |

**Scrubbing and seeking.** Dragging the timeline never reloads the scene. The room stays exactly where it is, and every actor jumps to where it is at the new timestamp, read from its motion track in memory. An actor that is not in frame at that time is hidden. During normal playback, actor motion is interpolated between samples so nothing pops. Section 9 explains how this is stored.

**States and messages**

| State | What the user sees | Next action |
| --- | --- | --- |
| Ready (cached) | Opens straight into the viewer | Explore |
| Queued or processing | Progress by stage, with a preview when available | Wait or leave and be notified |
| Not suitable | A specific reason, such as "almost no camera movement" or "too many cuts" | Choose another clip or segment |
| Not in the demo set | "This video is not processed yet" | Queue it (if live jobs are on) or pick a gallery scene |
| Failed quality gate | "We couldn't build this one well" | Try another clip |
| Load error or slow network | A retry button and a lower-quality option | Retry |
| No WebGL or weak GPU | A short message and a video-only fallback | Use the video |

## 6. Functional requirements

Priority key: **M** = must for the hackathon, **S** = should, **C** = could, **L** = later (full product).

**Ingest and URL handling**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Accept common URL forms (`youtu.be`, `watch?v=`, with timestamps) and reduce them to a video ID plus optional start and end time | M |
| FR-1.2 | Look up the video ID and range in the cache before doing any work | M |
| FR-1.3 | For uncached clips, download a low-resolution copy and the full-quality segment for processing | S |
| FR-1.4 | Reject or flag clips longer than the maximum (target 10 to 30 s per world) | S |
| FR-1.5 | Allow a direct file upload as an alternative to a URL | L |

**Triage (before any GPU time)**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Detect shot cuts and split the video into shots | S |
| FR-2.2 | Score each shot for camera parallax, blur, length and number of people | S |
| FR-2.3 | Select the best shot or let the user choose a segment | S |
| FR-2.4 | Return a specific, human-readable reason when a clip is unsuitable | S |
| FR-2.5 | Show a compatibility score at paste time | L |

**Processing pipeline**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Extract frames and audio (ffmpeg, OpenCV) | M |
| FR-3.2 | Estimate camera pose for every frame (Pi3X) and keep the point map if available | M |
| FR-3.3 | Segment and track each person, with masks grown slightly to cover shadows and edges | M |
| FR-3.4 | Fill the masked regions with LaMa to produce clean frames | M |
| FR-3.5 | Train a Gaussian splat from the clean frames and poses with gsplat, ignoring person pixels in the loss | M |
| FR-3.6 | Optionally generate a Marble room first and train it against the real frames instead of starting from the point map | C |
| FR-3.7 | Fit scale and floor height so the room and avatars are in consistent units | S |
| FR-3.8 | Rebuild each tracked person as an LHM avatar and estimate per-frame body motion | C |
| FR-3.9 | Each stage is resumable and saves its output; paid API calls are recorded in a ledger with idempotency keys | S |
| FR-3.10 | Run a quality gate before publishing (see section 11) | S |
| FR-3.11 | Export a motion track per person: floor position, facing direction, body pose and a visible flag for each time sample, smoothed offline | C |
| FR-3.12 | Estimate each person's floor position by intersecting the ray through their feet with the fitted floor plane, using the camera pose | C |

**Viewer**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Render the splat in the browser with Three.js and Spark | M |
| FR-4.2 | Pointer-lock mouse look and WASD walking at eye height | M |
| FR-4.3 | Constrain the camera to the walkable bounds and a floor height from the manifest | M |
| FR-4.4 | Fade to fog or blur beyond the reconstructed region | M |
| FR-4.5 | Spawn at the original camera's starting pose | M |
| FR-4.6 | Show a loading progress bar and degrade gracefully on weak GPUs | S |
| FR-4.7 | Click-to-teleport between pre-set viewpoints along the original camera path as an alternative to free walking | C |

**Video and sync**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Play the local mp4 (not a YouTube embed) as the master clock | M |
| FR-5.2 | Show the video on an in-scene screen and in a corner overlay | M |
| FR-5.3 | Pause, play and scrub update everything that depends on time | M |
| FR-5.4 | Use `requestVideoFrameCallback` where available for frame-accurate timing | S |
| FR-5.5 | On a seek, resample all time-indexed state (actors, in-scene screen) within one rendered frame, with no network request | M |
| FR-5.6 | Encode the local clip with a keyframe every 0.5 to 1 s so scrubbing lands quickly | M |
| FR-5.7 | Keep the room splat loaded and unchanged across seeks; only time-indexed state changes | M |

**Avatars**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | Load one skinned avatar per tracked person and pose it from the motion data at the current video time | C |
| FR-6.2 | Place each avatar so its feet land on the floor at its tracked position | C |
| FR-6.3 | Hide an avatar when its track is absent in the current frame | C |
| FR-6.4 | Load each person's whole motion track into memory at clip start (under about 1 MB per person-minute) | C |
| FR-6.5 | Look up the track by row index: snap to the sample on a seek, and interpolate (linear for position, spherical for joint rotations) during normal playback | C |
| FR-6.6 | Hide or fade an avatar on samples where its visible flag is off; never leave it frozen at its last pose | C |
| FR-6.7 | Keep one independent track per person ID so several people can move separately | C |

**Cache, storage and operations**

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | Store each processed clip as a versioned bundle keyed by video ID and range | M |
| FR-7.2 | Serve bundles from local disk for the demo with a CDN copy as backup | M |
| FR-7.3 | Prefetch the splat and video while the user is on the landing page | S |
| FR-7.4 | Cache intermediate stage outputs by clip hash so a re-run is cheap | S |
| FR-7.5 | Job queue with status (queued, processing, ready, failed), one GPU job at a time, and queue position shown to the user | S |
| FR-7.6 | Notify the user when a job finishes (realtime update, optional email) | C |

## 7. System architecture

A cached clip goes straight to the viewer; only a cache miss starts a job on the GPU worker, which runs eight stages and publishes a bundle so the next request is a hit.

&#91;embedded content: architecture · cache check, then 8 worker stages\]

The worker pulls jobs from the queue, so it needs no inbound network access. Each stage saves its output, and a ledger records every paid call so a crashed job resumes instead of repeating or double-billing. Optional stages are not drawn: Marble runs before step 6 if used, and LHM avatars with motion estimation run after step 4 if used.

**What each stage hands to the next**

| Stage | Takes | Gives |
| --- | --- | --- |
| 1 Triage | Low-res video | Accept or reject with a reason; the best shot |
| 2 Frames | Chosen shot | Frames and audio |
| 3 Camera poses (Pi3X) | Frames | Pose per frame; point map |
| 4 People | Frames | Person masks and tracks |
| 5 Clean plate (LaMa) | Frames and masks | Frames with people removed |
| 6 Room splat (gsplat) | Clean frames, poses, masks to ignore | The room splat |
| 7 Quality gate | Splat, held-out frames | Pass or fail, plus metrics |
| 8 Publish | Splat, poses, video, manifest | A versioned bundle in the cache |

## 8. Technology stack

Most of the core pipeline is what Orbis shipped; what changes is the infrastructure, the viewer controls and the caching around it. "Orbis" below means named in their Devpost writeup; "Ours" means our own choice, which can be swapped.

| Stage | Technology | Source | Notes |
| --- | --- | --- | --- |
| Download | yt-dlp | Ours | See section 13 on terms of service |
| Frames, audio | ffmpeg, OpenCV | Orbis | CPU |
| Shot detection | PySceneDetect | Ours | CPU |
| Motion and blur scoring | OpenCV optical flow, variance of the Laplacian | Ours | CPU, used in triage |
| Camera poses | Pi3X | Orbis | GPU; as far as we know it also outputs a point map |
| Person masking and tracking | A segmentation model plus tracker | Orbis (model not named) | Candidates: SAM-family video segmentation, or a YOLO segmenter with a tracker |
| Inpainting | LaMa | Orbis | Fills masked regions; per-frame, so can flicker |
| Scene prompt, QA, scale | GPT vision (or Gemini) | Orbis (GPT) | Only needed for Marble prompts, judging renders, and finding known-size objects |
| Room generation | Marble (World Labs) | Orbis | Optional, paid API |
| Splat training | gsplat | Orbis | GPU; the longest stage |
| Avatars | LHM | Orbis | GPU; needs a pose estimator for motion, which Orbis does not name |
| Quality metrics | PSNR, SSIM, LPIPS (torchmetrics or lpips) | Ours | Hold-out frames |
| Compute | Vultr GPU instance | Ours | Replaces Modal and AWS |
| Queue and database | Supabase / Postgres | Ours | Jobs table, realtime updates |
| Storage and delivery | S3-compatible object storage, CDN, local disk for the demo | Ours |  |
| Web app | Next.js, TypeScript | Ours |  |
| 3D viewer | Three.js, Spark | Orbis | Orbis also used WebXR; we replace it with pointer lock |
| Sync | HTML video element as clock, `requestVideoFrameCallback` | Orbis idea |  |

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

| File | Purpose |
| --- | --- |
| `manifest.json` | Everything the viewer needs to place and constrain the scene |
| `clip.mp4` | Local video with audio; the master clock |
| `scene.spz` (or similar compressed splat) | The room |
| `camera_path.json` | Per-frame camera poses from Pi3X |
| `avatars/<trackId>.*` and `motion/<trackId>.bin` | Avatar assets and one fixed-size-row motion track per person, looked up by video time (optional) |
| `thumb.jpg` | Gallery and loading screen |
| `qa.json` | Hold-out metrics and the manual QA result |

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
    "walkable": { "type": "corridor", "pathFile": "camera_path.json", "radiusM": 1.5, "maxYawDeg": 60 },
    "fog": { "nearM": 2.0, "farM": 5.0 }
  },
  "avatars": [ { "trackId": 1, "asset": "avatars/1.glb", "motion": "motion/1.bin" } ],
  "motionFormat": {
    "rateHz": 30,
    "sampleCount": 1800,
    "valuesPerSample": 76,
    "dtype": "float16",
    "layout": ["root_x", "root_z", "yaw", "visible", "24 joints x 3 rotation values"]
  },
  "qa": { "passed": true, "holdoutPsnr": null, "holdoutSsim": null, "holdoutLpips": null }
}
```

**Jobs table (Postgres or Supabase)**

| Column | Meaning |
| --- | --- |
| `id` | Job ID |
| `cache_key` | Unique per clip, range and pipeline version |
| `status` | `queued`, `processing`, `ready`, `failed`, `rejected` |
| `stage` | Current stage name, for progress display |
| `reason` | Human-readable reason for `rejected` or `failed` |
| `bundle_url` | Where the finished bundle lives |
| `created_at`, `updated_at` | Timestamps |

**Paid-call ledger.** One row per paid API call with an idempotency key (cache key plus stage plus attempt), the credits spent, and the result pointer. A crashed job reads the ledger and resumes instead of paying twice.

### Scrubbing and moving actors: a 1-minute lecture clip

Scrubbing never loads a different scene: the room is one static splat for the whole clip, and each moving person is a small time-indexed track that the viewer looks up by the video's current time.

**Scenario.** A 60-second clip of a professor in a lecture hall who walks between the podium, the board and the audience. The user drags the timeline from 12 s to 47 s. The room does not change. The professor jumps to where he is at 47 s, because his position and pose for every time sample are stored in a motion track.

**What is stored, and what is not**

- **The room:** one splat, loaded once, identical at every timestamp.
- **The avatar:** one rigged 3D asset per person, loaded once. Its shape does not change between timestamps; only its pose does.
- **The motion track:** one row per time sample, holding floor position, facing direction, a visible flag and joint rotations.
- **Not stored:** a separate scene, splat or avatar for each timestamp.

**Size of a motion track.** These are my estimates for one person before any compression; the real figure depends on the pose model's joint count.

| Format | Values per sample | Bytes per sample (float16) | 60 s at 30 Hz (1,800 samples) | 60 s at 15 Hz (900 samples) |
| --- | --- | --- | --- | --- |
| Body only: floor x and z, yaw, visible flag, 24 joints x 3 | 76 | 152 | About 270 KB | About 140 KB |
| Full body with hands and face (about 55 joints x 3) | About 170 | About 340 | About 610 KB | About 310 KB |

The rows are fixed-size and stored back to back in one binary file, so the row for any time is at a computed position and no search is needed. The layout is described by `motionFormat` in the manifest. The whole file is loaded into memory when the clip starts, so a seek never waits on the network.

**Looking up a time.** With motion rate f (samples per second), the row for video time t on a seek is:

```latex
i = \mathrm{round}(t \cdot f)
```

During normal playback, take the row below and the row above the current time and blend them, where the blend amount is the fractional part:

```latex
\mathbf{p}(t) = (1-\alpha)\,\mathbf{p}_{i} + \alpha\,\mathbf{p}_{i+1}, \qquad i = \lfloor t f \rfloor, \quad \alpha = t f - i
```

Position blends linearly; joint rotations blend with spherical interpolation.

| Video time | Row at 30 Hz | Row at 15 Hz |
| --- | --- | --- |
| 0 s | 0 | 0 |
| 12 s | 360 | 180 |
| 31 s | 930 | 465 |
| 47 s | 1410 | 705 |
| Last sample (60 s clip) | 1799 | 899 |

**What happens when the user seeks**

1. The timeline sets the video's current time to t. The room is untouched.
2. When the video reports the seek, and on every rendered frame while the user drags, the viewer computes the row index and reads that row from the track in memory.
3. It sets the avatar's floor position, facing and joint rotations from that row. On a seek it snaps to the row (this is the teleport); during normal playback it interpolates between neighbouring rows.
4. If the row's visible flag is off, the avatar is hidden or faded, never left frozen in its last pose.
5. The in-scene video screen and anything else that depends on time uses the same lookup.

**Why it is fast**

- The splat is not reloaded, because it does not depend on time.
- The avatar asset is already loaded and rigged, so only a pose is applied.
- The lookup is a computed offset, not a search.
- The track is under about 1 MB per person-minute, so it sits in memory.
- The clip is encoded with a keyframe every 0.5 to 1 s, so the video also lands on the new time quickly; a 1-minute clip can be buffered locally in full.

**How the track is built offline (in the pipeline)**

1. Track each person across frames (stage 4) and note when they leave or enter the frame.
2. Estimate body pose for each frame with a pose estimator (Orbis does not name theirs).
3. Find floor position: cast a ray through the person's feet in the image, using the camera pose from Pi3X, and intersect it with the fitted floor plane. With a fixed camera the pose is the same every frame, which keeps this stable.
4. Smooth the series offline to remove jitter, fill very short gaps, and set the visible flag to off for real absences.
5. Convert to float16 and write one fixed-stride binary file per person.

**Limits for a lecture scene**

- A static splat cannot show things that change: slides on a projector, whiteboard writing, a door opening, or a prop the professor moves. They stay as they looked in the frames the room was built from. A later option is to track the screen as a flat surface and play the matching part of the video on it.
- Lecture recordings usually come from a fixed camera, which gives little parallax to reconstruct from (see Gate 1 in section 11). Expect to need Marble to generate the hall, or a clip with some camera movement.
- Pose from a single camera is least reliable for the depth of hands and arms, so gestures may look slightly off.
- With several people on stage, each needs its own track ID; an ID swap shows up as an avatar jumping to another person.
- For clips much longer than a minute, split each track into chunks (for example 10 s) with a small index and load them lazily. This is not needed at 1 minute.

## 10. Non-functional requirements

The live demo path must feel instant because everything slow has already been done; the heavy path only has to be reliable and honest about how long it takes.

| Area | Requirement | Target |
| --- | --- | --- |
| Latency (cached clip) | URL paste to first interactive frame | 5 s or less |
| Latency (new clip) | Submit to ready | Minutes to hours; show stage progress and a queue position; measure, do not promise |
| Splat size | Small enough to load fast | Prune low-opacity Gaussians, reduce colour detail, use a compressed format; measure load time on the demo network |
| Frame rate | Walking in the viewer | 30 fps or more on the demo laptop; cap render resolution if needed |
| Sync | Video clock to avatar and screen state | No visible drift; scrub and pause work |
| Offline | Demo with wifi off | Everything served from the laptop; CDN copy only as backup |
| Reliability | Pipeline recovery | Each stage resumable; ledger prevents double billing; failed jobs keep their intermediate files |
| Security | GPU worker | Pulls jobs outbound only; no inbound ports; API keys on the server, never in the browser |
| Portability | Browsers | Current Chrome on desktop is the target; others best effort |
| Observability | Debugging a run | Per-stage logs and timings saved with each job |
| Versioning | Bundles | Immutable; new pipeline version creates a new bundle |
| Seek latency | Scrubbing to a new timestamp | Actors in the correct place within one rendered frame after the video seeks; no network request |
| Motion data size | Per person | Under about 1 MB per minute in the format in section 9; held fully in memory |
| Video seekability | Keyframe interval of the local clip | A keyframe every 0.5 to 1 s so a seek lands quickly |

**Latency budget for the live path (cached clip)**

1. Normalize URL and look up the manifest: tens of milliseconds.
2. Fetch the manifest, then prefetch the splat and video in parallel: seconds, dominated by file size and network.
3. Parse and upload the splat to the GPU and compile shaders: a warm-up before the demo removes most of this.
4. Enter the scene: pointer lock on click.

These are estimates; the first end-to-end run should record the real numbers for each step.

## 11. Quality gates and acceptance criteria

A clip is published only if it passes triage, the automated hold-out check and a human walkthrough; any failure marks it "couldn't build this one" instead of showing a broken scene.

**Gate 1: triage (before GPU time).** All thresholds below are placeholders to tune on the first 5 test clips.

| Signal | How it is measured | Accept if |
| --- | --- | --- |
| Shot length | Shot detection | One shot of roughly 8 to 30 s is available |
| Camera parallax | Optical flow or feature tracking: translation versus pure rotation | Real translation, not a tripod pan or a static shot |
| Blur | Variance of the Laplacian on sampled frames | Above a threshold tuned on test clips |
| People | Detector count | Few enough for the avatar tier (start at 3 or fewer); room-only tier tolerates more |
| Cuts | Shot detection | The chosen shot has no internal cuts |

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

**Scrubbing and moving actors**

- [ ] Scrub to 10 random timestamps: the actor is in the right place each time and the room does not reload
- [ ] Drag the timeline back and forth quickly: no flicker and no lag spikes
- [ ] The actor's feet are on the floor at every sampled time
- [ ] When the actor is out of frame, they are hidden, not frozen
- [ ] Pausing mid-gesture holds the pose without drift

**Acceptance for the hackathon build.** At least 3 clips pass all three gates, the viewer holds 30 fps on the demo laptop, and the full demo script runs twice in a row without intervention.

## 12. Risks and mitigations

The biggest risks are reconstruction quality on real videos and environment setup time, so the plan front-loads both.

| Risk | Likelihood | Impact | Mitigation | Fallback |
| --- | --- | --- | --- | --- |
| GPU environment setup takes hours (CUDA, gsplat compile, model weights) | High | High | Start first; snapshot the disk once it works; keep a Docker image | Use a smaller pipeline (Pi3X point cloud viewer) |
| Reconstruction looks bad on a chosen clip | High | High | Pick clips with slow forward motion and real parallax; run triage; QA walkthrough | Swap in another clip; use a pre-made sample splat |
| Unseen areas empty or smeared | Certain without Marble | Medium | Limit the walkable corridor; fog beyond it | Add Marble for 2 to 3 hero clips |
| Person masks or tracks fail (crowds, occlusion) | Medium | Medium | Choose clips with few people; grow masks | Room-only tier; video on a screen |
| Avatars look wrong (melted limbs, wrong back view, depth errors) | High | Medium | Make avatars optional; do not correct poses against footage | Drop avatars entirely |
| Animated Gaussian avatars are hard to render in a browser | Medium | Medium | Time-box a spike early | Use mesh avatars or skip |
| Spark or splat file too heavy for the demo laptop | Medium | High | Prune and compress; cap resolution; test on the real laptop | Lower-detail bundle |
| Venue wifi unreliable | High | High | Serve from laptop; test with wifi off | Screen recording of a perfect run |
| Paid API or GPU credits run out | Low | Medium | Ledger of paid calls; check credits before the event | Reconstruction-only |
| YouTube download blocked or against terms | Medium | Medium | Pre-download only clips we may use; prefer clips we own or that are Creative Commons | File upload |
| Audio and video drift in the viewer | Medium | Medium | Use the local mp4 as the clock; `requestVideoFrameCallback` | Resync on scrub |
| Scope creep into avatars, VR or multi-shot | High | High | Tiered scope with fixed cut lines (section 4) | Cut T5, T4, T3 in that order |
| A lecture video from a fixed camera gives too little parallax to reconstruct the room | High | High | Triage flags static shots; generate the hall with Marble and train on the visible parts; prefer clips with some camera movement | Show the video on a screen inside a generated or sample hall |
| Slides, projector content or whiteboard writing change over time but the splat is static | High | Medium | State it as a known limit; mask or blur the screen; later track the screen as a flat surface that plays the video | Leave the screen as it looked in the reference frames |
| An actor jumps to the wrong person or jitters after a track ID swap or a noisy pose | Medium | Medium | Smooth tracks offline; one track per ID; review at 10 scrub points per clip | Hide avatars and show the video only |
| Seeking stutters because the video has sparse keyframes or the track is fetched on demand | Medium | Medium | A keyframe every 0.5 to 1 s; load the whole track and video before the scene opens | Limit scrubbing to the buffered range |

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

| Item | Basis | Estimate |
| --- | --- | --- |
| Marble, 5 hero clips | 5 x about $1.20 to $2.50 | About $6 to $13 |
| Marble, 10 clips with one retry each | 20 x about $1.20 to $2.50 | About $24 to $50 |
| Vultr GPU | Hourly rate of the chosen instance x hours run | Covered by compute credits; confirm the GPU type, VRAM and credit total |
| GPT or Gemini vision calls | A few frames per clip for prompts, QA and scale | Small; cap per job |
| Object storage and CDN | A few tens of MB per clip | Negligible at demo scale |

**Controls for the full product**

- Per-user daily quota of jobs and a cap on clip length.
- Cache everything permanently so a popular video is processed once.
- Triage before the GPU so unsuitable clips cost almost nothing.
- Stop or snapshot the GPU instance when idle, since it bills while on.
- The paid-call ledger blocks duplicate Marble charges when a job resumes.

## 15. Phase plan

The build runs in five overlapping phases, and each one leaves a working demo behind it so a late problem never leaves us with nothing.

| Phase | Focus | Done when |
| --- | --- | --- |
| 1. Foundations | GPU environment working, viewer scaffold, repo and storage set up | A sample scene is walkable in the browser and the pose model runs on the GPU |
| 2. First clip end to end | One real clip through the pipeline into the viewer, with the video playing | One real clip is walkable with the video in sync |
| 3. Demo set | Process and QA 3 to 5 clips, add cache lookup and a gallery, tune performance | At least 3 clips pass the quality gates and hold the target frame rate |
| 4. Stretch | Marble for hero clips, avatars with motion tracks, live job queue and triage, chosen by how phase 3 went | Each stretch item either works or is cut |
| 5. Freeze and rehearse | Feature freeze, offline test, backup recording, demo rehearsal | The demo runs twice in a row, including with wifi off |

Three workstreams run in parallel through these phases: the GPU pipeline, the viewer, and the web platform plus demo.

**Decision points**

1. After phase 1: if the GPU environment is not working, switch the pipeline to a smaller flow (a point cloud viewer) and ask for help early.
2. After phase 2: if the first clip is not walkable, choose an easier clip before doing anything else.
3. After phase 3: if fewer than 3 clips pass, stop all stretch work and fix quality.
4. At the freeze: no new features, only bug fixes.

## 16. Demo plan

The demo is a two to three minute walk through pre-processed clips, run entirely from the laptop, with a recorded backup and one honest slide on how the pipeline scales.

**Script (about 3 minutes)**

1. **Hook (20 s):** show the original video, then paste its link. The scene opens within seconds (served from cache, and we say so).
2. **Enter (40 s):** click, walk with WASD, turn around, and show the video playing in the scene while time moves.
3. **Time control (20 s):** pause and scrub; the room stays put and the professor, or any actor, jumps to wherever they are at that timestamp with no reload.
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
