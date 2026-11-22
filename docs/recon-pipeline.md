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
- **Long shots (E-09):** a shot with more than `--chunk` keyframes (default 360) is solved in overlapping chunks, with 25% overlap.
  - Each chunk is moved into the previous chunks' world by a similarity fitted on the shared keyframes. Rotation is the chordal mean of the shared camera rotations, scale is the median depth ratio, and translation comes from the mean camera centre. Fitting scale on depth avoids the degenerate case of a camera that barely moves in the overlap.
  - The earlier chunk keeps the first half of the overlap. The stage logs each chunk's scale and the largest camera-centre gap on the shared keyframes.
  - `raw_cameras.json.chunks` records the number of solves. Pi3X, the alternative solver in the brief, isn't wired in.
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
  - The main walker isn't baked in. Where she blocked the background for the whole clip there's a dark unseen smear; that's the hole E-07 (LaMa) fills.

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
