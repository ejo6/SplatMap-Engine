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
  - S3b (E-03) writes the final `S3/cameras.json` (three.js convention, floor at y = 0) and `S3/depth/<stem>.npy` (world metres), which S6 and S8 read.
- **Measured on the Tokyo-Walk sample** (13 s, 390 frames, 66 keyframes):
  - 25 s of DA3 time, plus about 60 s to load the model.
  - The camera path is smooth (6.6 m, largest step 3 cm per frame).
  - Median relative depth reprojection error between consecutive keyframes: 1.2%.
  - The camera sits about 2 m above the ground, so the metric scale is plausible.
