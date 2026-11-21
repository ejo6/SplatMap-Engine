"""S3 cameras + depth (E-02, PRD §7.2 S3).

DA3 on keyframes (5 fps) as one global solve, then poses interpolated to every frame
(slerp rotation, lerp position). Rejects clips that zoom.

  in : work/<id>/S0/frames/*.jpg (every frame of the window, 30 fps)
  out: work/<id>/S3/raw_cameras.json  {fps, width, height, isMetric, convention:"opencv",
                                       intrinsics:{fx,fy,cx,cy} (video px), keyframes:[f...],
                                       frames:[{f, c2w:[16] row-major}]}   DA3 world, not yet floor-aligned (S3b does that)
       work/<id>/S3/raw_depth/<stem>.npy  keyframe depth, float16 HxW at DA3 resolution (0 = invalid)
       work/<id>/S3/raw_conf/<stem>.npy   keyframe DA3 confidence, float16 HxW
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation, Slerp

STAGE = "S3"
MODEL = "depth-anything/DA3NESTED-GIANT-LARGE-1.1"


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def fail(detail):
    print(json.dumps({"error": "reconstruction_failed", "detail": detail}), flush=True)
    sys.exit(1)


def keyframe_indices(n, step):
    """Every `step` frames, always including the last frame so every frame is bracketed."""
    kf = list(range(0, n, step))
    if kf[-1] != n - 1:
        kf.append(n - 1)
    return kf


def interpolate_c2w(kf, c2w_kf, n):
    """(K,4,4) camera-to-world at keyframes -> (n,4,4) for every frame: slerp rotation, lerp position."""
    rot = Slerp(kf, Rotation.from_matrix(c2w_kf[:, :3, :3]))(np.arange(n)).as_matrix()
    out = np.tile(np.eye(4), (n, 1, 1))
    out[:, :3, :3] = rot
    for i in range(3):
        out[:, i, 3] = np.interp(np.arange(n), kf, c2w_kf[:, i, 3])
    return out


def check_zoom(focals, tol):
    """Relative spread of the per-keyframe focal length; above tol means the clip zooms."""
    spread = (np.percentile(focals, 95) - np.percentile(focals, 5)) / np.median(focals)
    return spread, spread <= tol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--kf-fps", type=float, default=5, help="keyframe rate for DA3")
    # 1288 px OOMs on a 48 GB A40 even at 65 keyframes; 504 px fits ~390 keyframes (41.6 GB) in one global solve.
    ap.add_argument("--process-res", type=int, default=504, help="DA3 long edge in px (multiple of 14)")
    ap.add_argument("--zoom-tol", type=float, default=0.08, help="max relative focal spread before rejecting")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = args.work / STAGE
    if (out / "raw_cameras.json").exists() and not args.force:
        print(f"{out / 'raw_cameras.json'} exists, skipping", file=sys.stderr)
        return
    frame_paths = sorted((args.work / "S0" / "frames").glob("*.jpg"))
    if not frame_paths:
        sys.exit(f"no frames in {args.work / 'S0' / 'frames'}")
    from PIL import Image
    width, height = Image.open(frame_paths[0]).size
    n = len(frame_paths)
    kf = keyframe_indices(n, max(1, round(args.fps / args.kf_fps)))
    print(f"{n} frames, {len(kf)} keyframes at {args.process_res}px", file=sys.stderr)
    progress(0)

    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    import torch
    from depth_anything_3.api import DepthAnything3
    t0 = time.time()
    model = DepthAnything3.from_pretrained(MODEL).to("cuda")
    progress(10)
    pred = model.inference([str(frame_paths[i]) for i in kf], process_res=args.process_res)
    print(f"DA3: {time.time() - t0:.0f}s, peak VRAM {torch.cuda.max_memory_allocated() / 1e9:.1f} GB", file=sys.stderr)
    progress(80)

    # Intrinsics are in DA3's processed pixels; scale to video pixels.
    ph, pw = pred.depth.shape[1:]
    sx, sy = width / pw, height / ph
    K = pred.intrinsics.astype(np.float64)
    spread, ok = check_zoom(K[:, 0, 0] * sx, args.zoom_tol)
    if not ok:
        fail(f"focal length varies {spread:.1%} across the shot (zoom); limit {args.zoom_tol:.0%}")
    intr = {"fx": float(np.median(K[:, 0, 0]) * sx), "fy": float(np.median(K[:, 1, 1]) * sy),
            "cx": float(np.median(K[:, 0, 2]) * sx), "cy": float(np.median(K[:, 1, 2]) * sy)}

    w2c = np.tile(np.eye(4), (len(kf), 1, 1))
    w2c[:, :3, :] = pred.extrinsics
    c2w = interpolate_c2w(kf, np.linalg.inv(w2c), n)

    for sub in ("raw_depth", "raw_conf"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    for j, f in enumerate(kf):
        stem = frame_paths[f].stem
        np.save(out / "raw_depth" / f"{stem}.npy", pred.depth[j].astype(np.float16))
        if pred.conf is not None:
            np.save(out / "raw_conf" / f"{stem}.npy", pred.conf[j].astype(np.float16))
    (out / "raw_cameras.json").write_text(json.dumps({
        "fps": args.fps, "width": width, "height": height, "isMetric": bool(pred.is_metric),
        "convention": "opencv", "intrinsics": intr, "keyframes": kf,
        "frames": [{"f": f, "c2w": [round(float(x), 6) for x in c2w[f].ravel()]} for f in range(n)],
    }))
    progress(100, 0)


if __name__ == "__main__":
    main()
