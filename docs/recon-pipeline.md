# Reconstruction pipeline (Eric)

Stages S3–S5 and S9a from PRD §7.2. Each reads and writes `work/<youtubeId>/<stage>/` and runs in the `recon` env.

## S3 cameras + depth: `pipeline/s3_cameras.py` (E-02)

- **Run:** `python pipeline/s3_cameras.py --work work/<id> [--kf-fps 5] [--process-res 504] [--zoom-tol 0.08] [--force]`, or `run.py --stages S3`. It skips if `S3/raw_cameras.json` exists.
- **Input:** `S0/frames/*.jpg`, every frame of the window at 30 fps.
- **Method:**
  - DA3 (`DA3NESTED-GIANT-LARGE-1.1`, metric) runs on keyframes every 6th frame plus the last frame, as **one global solve** (no stitching, Orbis PR #82).
  - Poses are interpolated to every frame: slerp for rotation, lerp for position.
  - The clip is rejected (`reconstruction_failed`) if the keyframe focal length varies more than `--zoom-tol` (that means a zoom).
  - Intrinsics are the median across keyframes, scaled to video pixels.
- **Resolution:** 504 px long edge (504×280 depth), not the 1280–1600 px in the original brief.
  - 1288 px runs out of memory on the 48 GB A40 at 65 keyframes.
  - At 504 px: 65 keyframes take 15 GB; 390 take 41.6 GB and 100 s.
  - So a 60 s clip (300 keyframes) fits in one solve, at about 34 GB and 70 s.
  - If S4 needs sharper depth, the follow-up is a chunked high-res depth pass conditioned on these global poses (DA3 accepts input extrinsics and intrinsics).
- **Outputs** (all in DA3's world: arbitrary origin and axes, metric scale; S3b floor-aligns them):
  - `S3/raw_cameras.json`: `{fps, width, height, isMetric, convention:"opencv", intrinsics:{fx,fy,cx,cy}, keyframes:[f...], frames:[{f, c2w:[16]}]}`. `c2w` is row-major 4×4, **OpenCV** axes (x right, y down, z forward), one entry per frame.
  - `S3/raw_depth/<stem>.npy`: keyframe depth in metres, float16, 280×504. Filenames match `S0/frames`.
  - `S3/raw_conf/<stem>.npy`: DA3 confidence, float16, same shape.
  - S3b (E-03) turns these into the final `S3/cameras.json` and `S3/depth` (below).
- **Measured on the Tokyo-Walk sample** (13 s, 390 frames, 66 keyframes):
  - 25 s of DA3 time, plus about 60 s to load the model.
  - The camera path is smooth (6.6 m, largest step 3 cm per frame).
  - Median relative depth reprojection error between consecutive keyframes: 1.2%.
  - The camera sits about 2 m above the ground, so the metric scale is plausible.

## S3b world frame: `pipeline/s3b_world.py` (E-03)

- **Run:** `python pipeline/s3b_world.py --work work/<id> [--lower 0.4] [--thresh 0.05] [--force]`, or `run.py --stages S3b`. It skips if `S3/cameras.json` exists.
- **Inputs:** `S3/raw_cameras.json`, `S3/raw_depth`, and `S3/raw_conf` from S3. Optionally `S2/masks/union` (movers are left out of the floor fit).
- **Floor fit:**
  - Back-project keyframe depth from the bottom 40% of each image, keeping only the top 70% by confidence. Use at most 200k points.
  - Run RANSAC for a plane whose normal is within 35° of the average camera up (5 cm inliers), then refine it with SVD on the inliers.
  - The stage fails (`reconstruction_failed`) if under 5% of the points are inliers, or if the cameras end up below the plane.
- **World frame (PRD §8.1):**
  - The floor normal becomes +Y and the floor is y = 0.
  - Frame 0's camera sits directly above the origin, looking down −Z.
  - Units are metres. DA3 metric depth is used as is (scale 1). If DA3 isn't metric, the scale is set so the median camera height is 1.6 m.
  - Cameras are converted from OpenCV to three.js by flipping the camera's Y and Z axes.
- **Height check:** a median camera height outside 1.2–2.0 m prints a warning but doesn't fail, because low-angle, gimbal and drone shots are legitimate.
- **Outputs:**
  - `S3/cameras.json`: PRD §8.4, with c2w row-major in the three.js convention. S6 and S8 read it.
  - `S3/world_transform.json`: `{matrix:[16] row-major DA3 world → ours (includes scale), scale, plane:[a,b,c,d] in DA3 world, floorInliers, cameraHeight:{median,min,max}}`. S4 applies `matrix` to anything in DA3's world.
  - `S3/depth/<stem>.npy`: keyframe depth in world metres, float32 (`raw_depth × scale`). S8 reads it.
- **Tokyo-Walk sample:**
  - 60% floor inliers, and the ground is flat at every distance (median height 0.00–0.05 m out to 30 m).
  - The camera is 0.76 m above the ground. That's a genuine low-angle shot (the horizon is at the subject's waist), so it triggers the warning.
  - The camera backs away 6.3 m in front of the walker, matching the footage.

## S4a holes behind people: `pipeline/s4a_holes.py` (E-07)

- **Env:** `lama` (big-lama via `simple-lama-inpainting`). Runs on CPU if no GPU is visible (`CUDA_VISIBLE_DEVICES=`).
- **Run:** `python pipeline/s4a_holes.py --work work/<id> [--min-hole 0.002] [--stride 2] [--force]`, or `run.py --stages S4a`. It skips if `S4/holes/holes.json` exists.
- **Hole test:** a masked pixel is a hole if no other keyframe saw the background behind it.
  - The background depth behind the mover is guessed by interpolating each depth row across the mask.
  - Each masked pixel (every 2nd) is projected into every other keyframe. It counts as seen if it lands in the frame, outside that frame's mask, and within 10% of that frame's depth.
- **Fill:** keyframes with holes over 0.2% of the frame get the whole person (mask grown 7 px) removed by LaMa.
- **Outputs:** `S4/holes/<stem>.png` (255 = hole, full res), `S4/holes/<stem>.jpg` (LaMa frame), `S4/holes/holes.json` `{frames: {stem: holeFraction}}`.
- **S4 use:** inside a hole, the target is the LaMa frame and the error is scaled by `--hole-weight` (0.2). The rest of the mask stays excluded. Without `S4/holes/`, S4 behaves as before.

## S4 background splat: `pipeline/s4_background.py` (E-04)

- **Env:** `recon`. gsplat JIT-compiles on first use, so export the CUDA vars from `gpu-setup.md` first (Ninja comes from the env's `bin`).
- **Run:** `python pipeline/s4_background.py --work work/<id> [--steps 30000] [--cap 1500000] [--init 300000] [--sh-degree 1] [--depth-weight 0.1] [--force]`, or `run.py --stages S4`. It skips if `S4/world.ply` exists.
- **Inputs:**
  - `S0/frames`.
  - `S3/cameras.json` and `S3/depth` (E-03).
  - `S2/masks/union` (A-01). A keyframe without its union mask is **skipped**, so no people get baked in. With no mask folder at all, it warns and trains on everything.
- **Method:**
  - Trains directly in our world frame, so world-space normalization is off.
  - Uses keyframes only (5 fps), at full 1280×720.
  - **Movers are excluded from both losses (FR-12):** inside the union mask, the rendered RGB is replaced by the target, so those pixels give no error and no gradient. DA3 depth is zeroed there.
  - Losses: 0.8·L1 + 0.2·(1−SSIM) on RGB, plus 0.1 × relative L1 between the rendered expected depth and DA3 depth at DA3 resolution, plus the MCMC opacity and scale regularizers (0.01 each).
  - MCMC densification capped at 1.5M splats (the PRD §10.8 LoD budget). It starts from 300k points back-projected from DA3 depth (beyond 80 m dropped), and SH degree 1.
  - **Random background** each step. With a black background, gaps the splat could see through cost nothing in dark areas, so mist was faked with dark floaters. On the forest clip this removed the large dark blob at the path bend, with alignment PSNR unchanged (27.6 → 27.4). Faint dark patches where sky shows through the canopy remain.
  - Export: splats outside the init points' 0.5–99.5 percentile box (+10% margin) are cropped, then written as a standard 3DGS `S4/world.ply`.
- **Outputs:** `S4/world.ply` and `S4/train.json` `{steps, seconds, splats, psnr, box}`. `psnr` is on non-mover pixels over the last 500 steps.
- **Measured on the Tokyo-Walk sample** (61 keyframes, A40):
  - 30k steps in 19.7 min (about 25 steps/s), 1.44M splats, 133 MB ply, PSNR 21.9 (a night scene with wet reflections).
  - Step time doesn't depend on clip length, so a 60 s clip should stay well under 30 min.
  - Renders at the source poses line up with the frames.
  - The main walker isn't baked in. Where she blocked the background for the whole clip there's a dark unseen smear; that's the hole S4a (E-07, LaMa) fills.

## S5 bounds: `pipeline/s5_bounds.py` (E-06)

- **Env:** `recon`, CPU only. About 25 s on IMG_6714 (224 keyframes).
- **Run:** `python pipeline/s5_bounds.py --work work/<id> [--radius 4] [--cell 0.15] [--sdf-cell 0.1] [--max-depth 15] [--force]`, or `run.py --stages S5`. It skips if `S5/walk.json` exists.
- **Inputs:** `S3/cameras.json`, `S3/depth`, `S0/frames`, `S4/world.ply`, and `S2/masks/union` (movers are not carved).
- **Voxel carving:**
  - Grid over the solid-splat extent (1–99th percentile) plus the camera path ± radius, at 15 cm. The cell grows if the grid would exceed 8M voxels.
  - From each keyframe, rays (every 4th depth pixel, up to 15 m) add a *hit* at the surface voxel and a *pass* to every voxel in front of it.
  - Rays also sum their directions per voxel to give the angular spread.
- **coverage.bin:** `min(1, views/8) × (0.5 + 0.5·min(1, spread/0.3))` × 255. Voxels with 3 or more solid splats get at least 102.
- **Walkable:** floor cells (|y| < 0.3 m) that were seen, with no occupied voxel from 0.3 m to eye height, within `--radius` of the camera path, and connected to the path.
  - Occupied means 2 or more hits and hits > 0.3 × passes.
  - `walk_sdf.bin` is the signed distance in metres (negative = walkable).
- **colliders.glb:** one box per obstacle column within 1 m of the walkable area, from the floor to its top occupied voxel. IMG_6714 has 1,232 boxes (296 KB).
- **Fog colour:** mean of the top third of the keyframes. `eyeHeight` is the median camera height.
- **Also writes:** `S5/walk_debug.png`, a top-down view: green walkable, red blocked, grey seen floor, white camera path.
- **Copy into a world:** copy the four files to `worlds/<id>/v1/s0/` and set `shots[0].bounds = {walk, colliders}` in the manifest. This step is S9a's job once that exists.
## S9a package: `pipeline/s9_package.py` (E-08)

- **Env:** `recon`, CPU only. Spark `build-lod` comes from `$BUILD_LOD`, default `/workspace/src/spark/rust/target/release/build-lod`.
- **Run:** `python pipeline/s9_package.py --work work/<id> [--worlds-root worlds] [--creator NAME] [--license CC-BY] [--force]`, or `run.py --stages S9a`. It skips if the manifest exists.
- **Writes `<worlds-root>/<id>/v1/`** in the PRD §8.2 layout:
  - `world.rad` and `world.spz`, from two `build-lod --quality` runs on `S4/world.ply`: one with `--rad`, one with `--spz`. Given both flags, build-lod writes only the last one, and stale outputs are deleted first.
  - The video, thumbs and cameras.
  - S5 bounds, if S5 ran: sets `bounds` and `qa.fogRadius`.
  - The S8 people layer, if S8 ran: sets `peopleLayer`.
  - Each `S6/people/p*/` folder (person.json, motion.bin, plus any avatar files S7 puts there): fills `shots[0].people`.
- **Manifest:**
  - Title and scene card come from `S1/director.json`, falling back to the ingest title.
  - `credit.url` is set only for 11-character YouTube IDs.
  - `qa.verdict` is `unchecked` until S9b.
  - Only the selected shot is packaged (`s0`); E-10 adds more shots.
- **Size:** it warns above 100 MB (NFR-05). IMG_6713 (33 s, 1.4M splats, one person) is 92 MB with an 82 s build: rad 42 MB, spz 31 MB, video 16 MB. The viewer loads only one of rad or spz, and `world.spz` is git-ignored under `worlds/`.
- **Upload:** not done here. Copy the folder into the repo's `worlds/` for the local demo; the K-08 worker uploads it to the CDN.

## Alignment check and QA renders: `pipeline/tools/align_check.py` (E-05, G2 gate)

- **Run:** `python pipeline/tools/align_check.py --work work/<id> [--n 10]` in the `recon` env (export the CUDA vars first). It takes about 15 s.
- **Alignment:**
  - Renders `S4/world.ply` at n evenly spaced frames using `S3/cameras.json`. These include interpolated, non-keyframe poses.
  - Compares each render with the source frame. PSNR and SSIM are computed on **non-mover pixels only** (S2 union mask).
  - Writes `qa/align.json` `{frames:[{f, psnr, ssim}], psnr, ssim}` and `qa/align_sheet.jpg`. Each row of the sheet is source | render | 50/50 blend; in the blend, misalignment shows as doubled edges.
- **QA views for K-04 (Gemini gate) and human review:** 8 renders.
  - `path_25`, `path_50` and `path_75`: on the camera path.
  - At the midpoint: `left_1m`, `right_1m`, `forward_1m` (moves in the camera's own frame), and `yaw_left_20` / `yaw_right_20` (turns about world +Y).
  - Written as `qa/view_<name>.jpg` plus `qa/views.json` `[{name, file, c2w:[16]}]`, with three.js c2w.
- **G2 reading:** look at the blend column. Static edges (signs, kerbs, building lines) should overlay crisply. Expect people to be missing from the render, and black where the background was never seen.
- **Tokyo-Walk sample:**
  - All 10 blends overlay crisply, so the S3 → S3b → S4 coordinate frames agree.
  - Non-mover PSNR is 17–18 dB and SSIM 0.69–0.83 on 9 of 10 frames.
  - Frame 389 scores 9.9 dB because it has no S2 mask (KAN-76), so S4 never trained on that view.
