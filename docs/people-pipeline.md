# People pipeline (Adam)

Stages S2, S6, S7 and S8 from PRD §7.2. Each reads and writes `work/<youtubeId>/<stage>/`.

## S2 masks: `pipeline/s2_masks.py` (A-01)

- **Env:** the `sam3` env (`pipeline/envs/sam3.yml`, built by `setup_gpu.sh`). SAM 3 is loaded through Hugging Face `transformers` (`Sam3VideoModel`), which is pinned in that yml; the repo's own predictor isn't used. `HF_TOKEN` must belong to an account with `facebook/sam3` access.
- **Run:** `python pipeline/s2_masks.py --work work/<id> [--dilate 15] [--min-frames 10] [--force]`. It skips if `S2/tracks.json` exists. It prints JSON progress lines like `{"stage":"S2","pct":..,"eta":..}`.
- **Inputs:**
  - `S0/frames/*.jpg`: every frame of the processed window, sorted by name.
  - `S1/director.json` (optional): reads `subjects: [{noun, kind}]`, where `kind` is `person`, `animal` or `vehicle`. All nouns go to SAM 3 in one session. Without the file it uses the prompt `"person"`.
- **Outputs:** mask PNGs use the same filename stem as the source frame in `S0/frames`. Frame numbers inside `tracks.json` are 0-based indices into the sorted frame list.
  - `S2/masks/union/<frame>.png`: one file for **every** frame. 255 means a mover (any instance, dilated by `--dilate` px). E-04 excludes this from both the RGB and depth losses.
  - `S2/masks/o<objId>/<frame>.png`: one mask per instance, written **only for frames where it's visible**, undilated. A missing file means not visible.
  - `S2/tracks.json`: `{width, height, frameCount, dilatePx, prompts, instances: [{id:"o3", prompt, label:"person"|"other", visible:[[start,end],...], boxes:[[f,x0,y0,x1,y1],...], meanScore}]}`. Boxes are in video pixels.
- **Behaviour:**
  - Object IDs come from SAM 3 tracking and stay stable across the clip.
  - Instances seen in fewer than `--min-frames` frames are dropped from `tracks.json` but stay in the union mask.
  - Person IDs `p0…` (PRD §8.4) are assigned later in S6, when tracks are matched one-to-one with body tracks.
- **Memory (S2):** frames are kept on the CPU (`video_storage_device="cpu"`). A 60 s clip at 30 fps needs tens of GB of system RAM for the preprocessed frames; GPU memory is the model plus a small feature cache.

## S8 people layer: `pipeline/s8_people_layer.py` (A-08)

- **Env:** the `depth` env from `pipeline/envs/setup_gpu.sh`. It uses the Video-Depth-Anything clone at `/data/src/Video-Depth-Anything` (override with `--vda-repo` or `$VDA_REPO`). `download_weights.sh` fetches the metric Small checkpoint and links it into that clone's `checkpoints/`.
- **Run:** `python pipeline/s8_people_layer.py --work work/<id> [--ref-depth DIR] [--fps 30] [--force]`. It skips if `S8/holo.json` exists.
- **Inputs:**
  - `S0/frames/*.jpg`.
  - `S2/masks/o*/<frame>.png`: undilated instance masks. Their union is the mover mask.
  - Optional `S3/depth/<frame>.npy`: keyframe depth in **world metres** (after E-03), float32 HxW, 0 = invalid. Only some frames need it.
- **Depth:**
  - Uses the **metric** Video Depth Anything model, so depth is already roughly in metres. That avoids the relative model's unknown scale and shift.
  - When `S3/depth` exists, one global scale (median ratio on background pixels) aligns it to the world. Without it, the scale is 1.0. The scale is written to `holo.json.depthScale`.
- **Outputs (PRD §8.4):**
  - `S8/holo.mp4`: W×2H (1280×1440 for 720p), H.264 yuv420p, CRF 16, GOP 15, no B-frames, faststart. Top half is the full RGB frame. Bottom half is greyscale: movers are 16–255 by inverse depth, everything else is 0.
  - `S8/holo.json`: `{frames: [[near, far], ...], depthScale, fps}`. Near and far are the min and max mover depth per frame, in metres. A frame with no movers gets `[0, 0]`.
- **Decode in the viewer (A-10):**
  - Discard `v < 8`.
  - `inv = 1/far + (v - 16)/239 * (1/near - 1/far)`, then `depth = 1/inv`.
  - H.264 ringing leaves a few non-mover pixels at 8–55, all within 3 px of a silhouette. The stretched-triangle discard (depth ratio above 1.08) removes them.
- **Speed:** 8 frames at 960×540 took about 70 s on a Mac CPU. GPU time hasn't been measured.

## S7a identity frames: `pipeline/s7_identity.py` (A-05)

- **Env:** any env with `pipeline/requirements-gemini.txt` plus numpy and pillow. It needs `GEMINI_API_KEY`; without it, it uses the fallback.
- **Run:** `python pipeline/s7_identity.py --work work/<id> [--force]`. It skips if `S7/identity.json` exists.
- **Inputs:** `S0/frames`, `S2/tracks.json` (only instances with `label == "person"`), and `S2/masks/o<id>/`.
- **Method:**
  - Split each person's visible frames into 8 time bins and take the frame with the largest mask from each bin. Frames where the mask touches the image edge (cut off) are skipped unless a bin has nothing else.
  - Each candidate is cropped to that person's padded mask box, and **every pixel outside their own mask is set to white**. That's how a bystander's face is never picked (Orbis PR #53).
  - Gemini (`config/gemini.yaml` model) ranks the crops for front-facing, face visible, full body, unoccluded and sharp.
  - If Gemini fails or gives an invalid ranking, the fallback (PRD §7.3) ranks by mask area.
- **Outputs:**
  - `S7/identity/<id>/cand_<frame>.png`: all candidate crops, kept for review.
  - `S7/identity/<id>/best.png`: the top-ranked crop.
  - `S7/identity.json`: `{persons: [{id, frame, ranked: [{frame, crop}], source: "gemini"|"fallback", reason}]}`. `ranked` is best first, and `crop` paths are relative to `S7/`. A-06 uses `best.png`, or the top few for LHM++.

## Viewer: people layer `web/src/people/holo.ts` (A-10)

- **API:** `const people = await loadPeopleLayer(base, shot)`. It returns `null` if the shot has no `peopleLayer`. Then `scene.add(people.mesh)`.
  - `people.video` is the `holo.mp4` element. Slave it to the master clock (SH-02); nothing else drives it.
  - The layer listens to that video's own `requestVideoFrameCallback`. It sets its pose (`cameras[frame].c2w`) and `near`/`far` for the frame **actually decoded**, so pose and pixels can't drift apart.
  - `people.opacity` is for the A-11 blend. `people.frame` is the shot frame currently shown.
- **Rendering:**
  - A 256×144 vertex grid. The vertex shader decodes inverse depth from the bottom half of `holo.mp4` and back-projects each vertex through the intrinsics, in camera space using the three.js convention.
  - Discards: vertices with value below 8, and any triangle touching a vertex whose 8 neighbours differ in depth by more than 1.08×. The flag is 0/1, so no slivers survive.
  - The texture is read raw (NoColorSpace), because depth must not be gamma-converted.
- **S8 depth smoothing:** monocular depth is noisy inside a person and bleeds background depth into the outline. That made the 1.08 test drop limbs even on-axis. `s8_people_layer.py` now box-blurs depth over **each instance's own mask** (kernel about W/40). This cut false discards from 688 to 71 grid cells on the bedroom clip, without merging two people's depths.
- **Debug page:** `npm run dev` in `web/`, then open `/src/people/debug.html?world=<id>&yaw=<deg>&dx=<m>`.
  - It needs `worlds/<id>/v1` copied into `web/public/worlds/` (not committed).
  - `yaw=0&dx=0` is the original pose and should match the video exactly.
