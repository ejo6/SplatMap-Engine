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
