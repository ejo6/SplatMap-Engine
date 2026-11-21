# World format

Copied from PRD §8 (the authoritative contract — if this drifts from the PRD, the PRD wins; update both in the same PR).

## Conventions (apply everywhere)

- **World frame:** right-handed, **+Y up**, metres, floor plane at **y = 0**.
- **Cameras:** camera-to-world 4×4 matrix in the **three.js/OpenGL convention** (camera looks down −Z, +Y up, +X right), stored as 16 numbers in **row-major** order. The pipeline converts from OpenCV (x right, y down, z forward) by flipping the camera's Y and Z axes.
- **Intrinsics:** `fx, fy, cx, cy` in pixels of the 1280×720 `video.mp4`. They are constant per shot; reject clips that zoom.
- **Time:** `video.mp4` starts at the processed window (t = 0). `frame = clamp(round((t − shot.start) × fps), 0, shot.frameCount − 1)`. Use `mediaTime` from `requestVideoFrameCallback`.
- **Binary files:** little-endian, no header. Shapes are given in the JSON that references them.
- All paths in the manifest are relative to the manifest URL.

## Layout

```
worlds/<youtubeId>/v<pipelineVersion>/
  manifest.json
  video.mp4               # 1280x720 30fps H.264, keyframe every 0.5–1 s (-g 15–30), no B-pyramid, +faststart, AAC audio
  thumbs.jpg  thumbs.json # seek-bar sprite, 2 fps
  s0/                     # one folder per reconstructed shot
    world.rad  world.spz  # Spark LoD (streamed) + SPZ fallback
    cameras.json
    walk.json  walk_sdf.bin  coverage.bin  colliders.glb
    holo.mp4  holo.json   # people layer
    people/p0/avatar.<ext>  skin.bin  motion.bin  person.json
```

## `manifest.json`

```json
{
  "schema": 1,
  "pipelineVersion": "1",
  "youtubeId": "abc123",
  "title": "Sunrise ridge walk",
  "credit": { "creator": "Channel Name", "license": "CC BY 4.0", "url": "https://youtube.com/watch?v=abc123" },
  "sceneCard": "Two hikers crest a ridge at sunrise...",
  "video": { "url": "video.mp4", "fps": 30, "width": 1280, "height": 720, "duration": 58.4,
             "sourceStart": 12.0, "thumbs": { "sprite": "thumbs.jpg", "index": "thumbs.json" } },
  "shots": [{
    "id": "s0", "start": 0.0, "end": 58.4, "frameCount": 1752,
    "world": { "rad": "s0/world.rad", "spz": "s0/world.spz", "splatCount": 1800000 },
    "cameras": "s0/cameras.json",
    "bounds": { "walk": "s0/walk.json", "colliders": "s0/colliders.glb" },
    "peopleLayer": { "video": "s0/holo.mp4", "meta": "s0/holo.json" },
    "people": [{ "id": "p0", "label": "vlogger", "person": "s0/people/p0/person.json" }]
  }],
  "unreconstructed": [{ "start": 58.4, "end": 60.0 }],
  "qa": { "verdict": "pass", "notes": "", "fogRadius": 4.5 },
  "createdAt": "2026-11-21T12:00:00Z"
}
```

## File specs

- **`cameras.json`:** `{ fps, width, height, intrinsics: {fx, fy, cx, cy}, keyframes: [frameIdx...], frames: [{ f, c2w: [16] }] }`, with one entry per video frame in the shot.
- **`walk.json`:**
  ```
  { eyeHeight: 1.6, startFrame: 0,
    fog: { color: [r,g,b], radius },
    sdf:      { url, origin: [x,z], cellSize, width, height },
    coverage: { url, origin: [x,y,z], cellSize, dims: [nx,ny,nz] } }
  ```
- **`walk_sdf.bin`:** Float32 array of `height × width` (rows along z, columns along x), signed distance in metres. **Negative = walkable**, positive = outside.
- **`coverage.bin`:** Uint8 array of `nx·ny·nz`, with x varying fastest. 0 means never seen, 255 means well observed (several views and a good angular spread).
- **`holo.mp4`:** 1280×1440 at 30 fps.
  - **Top half:** RGB.
  - **Bottom half:** greyscale normalized inverse depth, with person pixels mapped to 16–255.
  - **Value below 8** means not a mover (discard).
- **`holo.json`:** `{ frames: [[near, far], ...] }`, the metres per frame used for the normalization.
- **`person.json`:**
  ```
  { id, label,
    avatar: { kind: "splat-lbs" | "mesh-glb" | "ply-seq", url, skin },
    joints: J, motion: { url, frameCount, layout: "J x 3x4 row-major float32 per frame" },
    visible: [[startFrame, endFrame], ...] }
  ```
  - `motion.bin` holds the world-space joint transforms per frame, precomputed in the pipeline so the browser needs no SMPL-X code.
  - `kind` is finalized by ticket **A-07** (the avatar rendering spike). Update this section when that decision is made.

---

## Test fixture: `worlds/test/v1/` (KAN-21 / S-09, gate G1)

Hand-made fixture that validates against the layout above, so viewer work (loader, clock, camera modes, scrubbing, fog/boundary) can start before the real pipeline exists. No avatar yet — `shots[0].people` is `[]`, but the people-layer video (`holo.mp4`) is still populated since it doesn't depend on avatars.

Generate it with:

```bash
cd web && node scripts/make-test-world.mjs
```

This writes `worlds/test/v1/` at the repo root (git-ignored, like all pipeline output — rerun the script instead of committing the fixture). Requires `ffmpeg` on `PATH` and `web`'s npm deps installed (`npm i`).

What it builds, and where it's a simplification vs. the real pipeline:

- **`s0/world.spz`** — a small splat (a tan floor grid + a red sphere "subject"), encoded with Spark's own `writeSpz()` (`@sparkjsdev/spark`, already a `web/` dependency), so the bytes are a real, viewer-loadable SPZ file rather than a hand-rolled approximation. No `world.rad` (the viewer falls back to `.spz` when `.rad` is absent).
- **`s0/cameras.json`** — a straight line, 10 s at 30 fps (300 frames), translating in X at eye height with identity rotation (looking down −Z).
- **`s0/walk.json` + `walk_sdf.bin` + `coverage.bin`** — a circular walkable area (radius 4 m) on the floor, and a matching coverage sphere (same radius, centered at eye height) in the 3D coverage grid.
- **`s0/colliders.glb`** — a single flat quad spanning the walk circle, as a minimal placeholder collider (not real geometry).
- **`s0/holo.mp4` + `holo.json`** — a coloured rectangle moving sideways at a constant 2 m depth; `holo.json` uses a constant `[near, far] = [1, 5]` per frame.
- **`video.mp4` + `thumbs.jpg`/`thumbs.json`** — a real, properly encoded 1280×720/30fps H.264+AAC clip (ffmpeg test pattern + tone, not real footage) and a 2 fps thumbnail sprite (5×4 tile grid), matching duration with the shot.
- **`qa.verdict`** is `"unchecked"` — no Gemini gate has run on a synthetic world.
