# People pipeline (Adam)

Stages S2, S6, S7 and S8 from PRD §7.2. Each reads and writes `work/<youtubeId>/<stage>/`.

## S2 masks: `pipeline/s2_masks.py` (A-01)

- **Env:** the `sam3` env (`pipeline/envs/sam3.yml`, built by `setup_gpu.sh`). SAM 3 is loaded through Hugging Face `transformers` (`Sam3VideoModel`), which is pinned in that yml; the repo's own predictor isn't used. `HF_TOKEN` must belong to an account with `facebook/sam3` access.
- **Run:** `python pipeline/s2_masks.py --work work/<id> [--dilate 15] [--min-frames 10] [--force]`. It skips if `S2/tracks.json` exists. It prints JSON progress lines like `{"stage":"S2","pct":..,"eta":..}`.
- **Inputs:**
  - `S0/frames/*.jpg`: every frame of the processed window, sorted by name.
  - `S1/director.json` (optional): reads `subjects: [{noun, kind}]`, where `kind` is `person`, `animal` or `vehicle`. SAM 3 always receives `"person"` plus any distinct animal and vehicle nouns in one session.
- **Outputs:** mask PNGs use the same filename stem as the source frame in `S0/frames`. Frame numbers inside `tracks.json` are 0-based indices into the sorted frame list.
  - `S2/masks/union/<frame>.png`: one file for **every** frame. 255 means a mover (any instance, dilated by `--dilate` px). E-04 excludes this from both the RGB and depth losses.
  - `S2/masks/o<objId>/<frame>.png`: one mask per instance, written **only for frames where it's visible**, undilated. A missing file means not visible.
  - `S2/tracks.json`: `{width, height, frameCount, dilatePx, prompts, instances: [{id:"o3", prompt, label:"person"|"other", visible:[[start,end],...], boxes:[[f,x0,y0,x1,y1],...], meanScore}]}`. Boxes are in video pixels.
- **Behaviour:**
  - Object IDs come from SAM 3 tracking and stay stable across the clip.
  - Instances seen in fewer than `--min-frames` frames are dropped from `tracks.json` but stay in the union mask.
  - **Object cap** `--max-objects` (default 20, written to `tracks.json.maxObjects`): SAM 3's `max_num_objects` is otherwise 10000, and a crowded clip ran the A40 out of memory (KAN-76) in its N×N overlap check. Past the cap, SAM 3 keeps the highest-scoring new detections. Movers beyond the cap get **no mask**, so in a crowd some passers-by can be baked into the splat. Raise the cap if memory allows. The stage also sets `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.
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

- **Env:** `ingest` (the runner's choice; `ingest.yml` now lists pillow, but envs built before that lack it and S7a fails on `import PIL`). It needs `GEMINI_API_KEY`; without it, it uses the fallback. S7 doesn't need S7a: it falls back to the same largest-mask rule.
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

## S6a body tracking: `pipeline/s6_body.py` (A-03)

- **Tracker:** GVHMR (decision on A-02 / KAN-37). Runs in the `people` env from the GVHMR clone (`--gvhmr-repo` or `$GVHMR_REPO`, default `/data/src/GVHMR`), with its checkpoints and SMPL-X linked by `download_weights.sh`.
- **Run:** `python pipeline/s6_body.py --work work/<id> [--cameras PATH] [--force]`. It skips when every person already has an `.npz`.
- **Method:** for each `label == "person"` instance in `S2/tracks.json`:
  - Span: the first to last visible frame. SAM boxes are linearly interpolated across occlusion gaps.
  - Inputs: GVHMR gets **that instance's SAM boxes** (in place of its own YOLO tracker), plus ViTPose 2D keypoints and HMR2 features.
  - Matching: SAM instances and bodies are matched one-to-one by construction, and non-person instances never become bodies. There is no limb refinement against keypoints (PRD §3).
- **Camera:**
  - With `S3/cameras.json` (E-03): the intrinsics come from it, and per-frame rotation comes from `c2w`, converted from three.js to OpenCV axes.
  - Without it: GVHMR's `estimate_K` plus `SimpleVO` odometry. This is a shortcut until E-03 lands, and A-04 needs real cameras anyway.
- **Output:** `S6/body/<objId>.npz`, one per person:
  - Frame data: `frames` (absolute frame indices of the span), `visible` (ranges from `tracks.json`), `K` (3×3).
  - SMPL-X parameters: `betas` (10, the median over the span, so one shape per person), `incam_{global_orient (F,3), body_pose (F,63), transl (F,3)}` (camera space, OpenCV axes; `transl` has a 5-frame moving average), `global_{global_orient, body_pose, transl}` (GVHMR's gravity-aligned world).
  - `cam_source`: `"cameras.json"` or `"simplevo"`.
  - A-04 places people with `incam_*` + `cameras.json` + the floor. The `global_*` parameters are kept for reference.

## S6b world placement: `pipeline/s6_place.py` (A-04)

- **Env:** `people`. It uses the `smplx` package with the SMPL-X files GVHMR uses (`--smplx-dir` or `$SMPLX_DIR`, default `/data/src/GVHMR/inputs/checkpoints/body_models`). The model settings match GVHMR's "supermotion": neutral, 10 betas, non-flat mean hands.
- **Run:** `python pipeline/s6_place.py --work work/<id> [--force]`. It needs `S6/body/*.npz` (A-03) and `S3/cameras.json` (E-03).
- **Method, per person:**
  1. **Skinning:** SMPL-X rest-to-posed joint transforms `A` for every frame, from GVHMR's in-camera pose.
  2. **Into the world:** `world = c2w · diag(1,−1,−1,1) · S(scale) · T(transl) · A`. The diagonal converts OpenCV camera axes to three.js.
  3. **Scale:** one per person, solved so the lowest foot lands on y = 0. It's the median over frames, so jumps don't break it. Scaling happens about the camera centre, which keeps the body's image projection (it still overlays its mask) while fixing GVHMR's size and distance against the world's metres. `heightM` in `person.json` is the sanity check.
  4. **Foot pinning:** frames where a foot is within 10 cm of the floor get a smoothed vertical shift onto it. Horizontal foot sliding is **not** locked yet.
- **Outputs (PRD §8.4):**
  - `S6/people/p<k>/motion.bin`: float32 little-endian, shape `(frameCount, 55, 3, 4)`, row-major, indexed by **shot frame**. Frames outside the person's span repeat the edge pose; they're hidden via `visible`. `motion[f][j]` maps a point in the person's **rest space** (their shaped SMPL-X T-pose, metres, **unscaled**) to world, so linear-blend skinning is `Σ w_j · motion[f][j] · [p_rest, 1]`.
  - `S6/people/p<k>/person.json`: `{id, label, avatar: null, joints: 55, skeleton: "smplx55", parents, restJoints, motion: {url, frameCount, layout}, visible, sourceInstance, scale, heightM}`. `p<k>` numbers the kept people in sorted `S6/body` order. People whose solved height is under 1.2 m are dropped (SAM fragments and false tracks; on IMG_6713 they solved to 0.56–0.62 m). `avatar` is filled in later by S7/S9a.
- **For A-06/A-07:** the avatar must live in the same rest space (this person's betas, unscaled SMPL-X T-pose) with SMPL-X joint order, so skin weights index these 55 joints directly.

## S7 avatars: `pipeline/s7_avatar.py` (A-06)

- **Env:** `lhm` (LHM-1B, repo at `--lhm-repo` or `$LHM_REPO`, default `/data/src/LHM`). About 2 minutes per person on the A40.
- **Run:** `python pipeline/s7_avatar.py --work work/<id> [--force]`. It needs `S6/people/p*/person.json` and `S6/body/<objId>.npz`.
- **Identity image:** `S7/identity/<objId>/best.png` from S7a, or else the frame where the person's mask is largest and not cut off, cropped the same way.
- **Method:** LHM's own zero-pose export (`infer_mesh`) is run with the person's **GVHMR betas** (zero-padded to LHM's 100). LHM, GVHMR and S6b all use the same `SMPLX_NEUTRAL.npz` (byte-identical), so the Gaussians come out exactly in `motion.bin`'s rest space. LHM keeps one Gaussian per upsampled SMPL-X vertex, in order, so its per-vertex `skinning_weight` (55 joints) is the skin; we keep the top 4 per Gaussian and renormalise.
- **Outputs (PRD §8.4, `avatar.kind = "splat-lbs"`):**
  - `S7/people/p<k>/avatar.ply`: 3DGS PLY in rest space. Splat `i` is row `i` of `skin.bin`, so nothing downstream may reorder it.
  - `S7/people/p<k>/skin.bin`: Float32 little-endian, `N × 8`: 4 joint indices (as floats), then their 4 weights.
  - `S7/people/p<k>/identity.png` (when S7a didn't run) and LHM's `refer_*.png` preview, for review.
- **Hands:** LHM's rest uses flat hands, while `motion.bin` includes SMPL-X's mean hand pose, so posed hands come out relaxed rather than flat.

## Viewer: avatars and people switching `web/src/people/` (A-09)

- **Wiring (`main.ts`):** `const people = await loadPeople(base, shot, video, fps, cameras)`, then `scene.add(people.group)`. Call `people.setFrame(frame)` from the clock bus and `people.update(rig.camera, rig.mode)` every render frame. A shot with neither `peopleLayer` nor `people` gives an empty group.
- **`avatars.ts`:** `loadAvatars(base, shot.people)` fetches each `person.json` and its `motion.bin`.
  - `Avatar.setFrame(f)` poses the person from `motion[f]` by **exact frame lookup**. There's no interpolation, so a seek or loop never blends toward frame 0; the pose holds until the clock moves (PRD §10.3).
  - The avatar is hidden outside `visible`.
  - A blob contact shadow sits on y = 0 under the feet and fades as they rise 0–0.5 m.
  - **Placeholder rendering:** until A-07 picks `avatar.kind`, each person draws as a SMPL-X skeleton (joint-to-parent lines) driven by the same matrices. The real avatar plugs into `Avatar` and reads `motion` the same way.
- **`index.ts` + `blend.ts` view-dependent blend (A-11, PRD §10.5):** in ride-along, return and scrub, both are hidden, because the video overlay already shows the real people. In walk mode, the avatar weight is `w = max(smoothstep(10°, 20°, angle), smoothstep(0.4, 0.5 m, distance))`. `angle` is between the viewer's view direction and the original camera's, and `distance` is from the original camera position. The people layer is drawn at opacity `1 − w` and the avatars at `w`; each is hidden when its weight is 0. The short distance band avoids a pop at the 0.5 m limit. Movers without an avatar (animals, cars) fade out with the people layer, a known limit. The people-layer video is slaved to the master with SH-02's `slaveVideo`, at the master's playback speed (SH-17).
- **Tests:** `cd web && npm test` runs `node --test tests/*.test.ts`. Node strips the TypeScript types, so no test framework is needed.
