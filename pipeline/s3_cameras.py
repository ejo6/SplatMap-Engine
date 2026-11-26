"""S3 cameras + depth (E-02, PRD §7.2 S3).

DA3 on keyframes (5 fps) as one global solve, then poses interpolated to every frame
(slerp rotation, lerp position). Rejects clips that zoom.
Long shots (E-09): past --chunk keyframes, DA3 runs on overlapping chunks (25% overlap). Each chunk is
mapped into the first chunk's world by a similarity fitted on the shared keyframes (rotation from the
camera orientations, scale from the depth ratio, translation from the camera centres). Never independent batches.

  in : work/<id>/S0/frames/*.jpg (every frame of the window, 30 fps; one continuous shot, no cuts)
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
    """(K,4,4) camera-to-world at keyframes -> (n,4,4) for every frame: slerp rotation, lerp position.
    Frames outside [kf[0], kf[-1]] repeat the edge pose."""
    rot = Slerp(kf, Rotation.from_matrix(c2w_kf[:, :3, :3]))(np.clip(np.arange(n), kf[0], kf[-1])).as_matrix()
    out = np.tile(np.eye(4), (n, 1, 1))
    out[:, :3, :3] = rot
    for i in range(3):
        out[:, i, 3] = np.interp(np.arange(n), kf, c2w_kf[:, i, 3])
    return out


def chunk_ranges(k, size, overlap):
    """Keyframe index ranges [a, b) of at most `size`, consecutive ranges sharing `overlap` keyframes."""
    if k <= size:
        return [(0, k)]
    out, a = [], 0
    while True:
        b = min(a + size, k)
        out.append((a, b))
        if b == k:
            return out
        a = b - overlap


def fit_similarity(c2w_ref, c2w_new, depth_ref, depth_new):
    """Similarity (s, R, t) taking chunk `new`'s world into `ref`'s from the same keyframes seen by both:
    R = chordal mean of R_ref R_new^T, s = median depth ratio, t = mean(c_ref) - s R mean(c_new)."""
    u, _, vt = np.linalg.svd(np.einsum("nij,nkj->ik", c2w_ref[:, :3, :3], c2w_new[:, :3, :3]))
    R = u @ np.diag([1, 1, np.linalg.det(u @ vt)]) @ vt
    ok = (depth_ref > 0) & (depth_new > 0)
    s = float(np.median(depth_ref[ok] / depth_new[ok]))
    t = c2w_ref[:, :3, 3].mean(0) - s * R @ c2w_new[:, :3, 3].mean(0)
    return s, R, t


def apply_similarity(s, R, t, c2w):
    out = c2w.copy()
    out[:, :3, :3] = R @ c2w[:, :3, :3]
    out[:, :3, 3] = s * c2w[:, :3, 3] @ R.T + t
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
    ap.add_argument("--chunk", type=int, default=360, help="max keyframes per DA3 solve (E-09); longer shots are chunked")
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
    ranges = chunk_ranges(len(kf), args.chunk, max(1, args.chunk // 4))
    c2w_kf, depth, conf, Ks = np.zeros((len(kf), 4, 4)), [None] * len(kf), [None] * len(kf), []
    for i, (a, b) in enumerate(ranges):
        pred = model.inference([str(frame_paths[f]) for f in kf[a:b]], process_res=args.process_res)
        w2c = np.tile(np.eye(4), (b - a, 1, 1))
        w2c[:, :3, :] = pred.extrinsics
        c2w = np.linalg.inv(w2c)
        d = pred.depth.astype(np.float32)
        if i:  # into the previous chunks' world, fitted on the shared keyframes [a, prev_b)
            shared = ranges[i - 1][1] - a
            s, R, t = fit_similarity(c2w_kf[a:a + shared], c2w[:shared], np.stack(depth[a:a + shared]), d[:shared])
            c2w, d = apply_similarity(s, R, t, c2w), d * s
            print(f"chunk {i}: keyframes {a}-{b}, scale {s:.3f}, centre gap "
                  f"{np.linalg.norm(c2w[:shared, :3, 3] - c2w_kf[a:a + shared, :3, 3], axis=1).max():.3f} m", file=sys.stderr)
            keep = shared // 2  # earlier chunk owns the first half of the overlap
            a, c2w, d = a + keep, c2w[keep:], d[keep:]
            pred_conf = None if pred.conf is None else pred.conf[keep:]
        else:
            pred_conf = pred.conf
        c2w_kf[a:b] = c2w
        depth[a:b] = list(d)
        conf[a:b] = [None] * (b - a) if pred_conf is None else list(pred_conf)
        Ks.append(pred.intrinsics)
        progress(10 + 70 * (i + 1) / len(ranges))
    print(f"DA3: {len(ranges)} solve(s), {time.time() - t0:.0f}s, peak VRAM {torch.cuda.max_memory_allocated() / 1e9:.1f} GB",
          file=sys.stderr)

    # Intrinsics are in DA3's processed pixels; scale to video pixels.
    ph, pw = depth[0].shape
    sx, sy = width / pw, height / ph
    K = np.concatenate(Ks).astype(np.float64)
    spread, ok = check_zoom(K[:, 0, 0] * sx, args.zoom_tol)
    if not ok:
        fail(f"focal length varies {spread:.1%} across the shot (zoom); limit {args.zoom_tol:.0%}")
    intr = {"fx": float(np.median(K[:, 0, 0]) * sx), "fy": float(np.median(K[:, 1, 1]) * sy),
            "cx": float(np.median(K[:, 0, 2]) * sx), "cy": float(np.median(K[:, 1, 2]) * sy)}

    c2w = interpolate_c2w(kf, c2w_kf, n)

    for sub in ("raw_depth", "raw_conf"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    for j, f in enumerate(kf):
        stem = frame_paths[f].stem
        np.save(out / "raw_depth" / f"{stem}.npy", depth[j].astype(np.float16))
        if conf[j] is not None:
            np.save(out / "raw_conf" / f"{stem}.npy", conf[j].astype(np.float16))
    (out / "raw_cameras.json").write_text(json.dumps({
        "fps": args.fps, "width": width, "height": height, "isMetric": bool(pred.is_metric), "chunks": len(ranges),
        "convention": "opencv", "intrinsics": intr, "keyframes": kf,
        "frames": [{"f": f, "c2w": [round(float(x), 6) for x in c2w[f].ravel()]} for f in range(n)],
    }))
    progress(100, 0)


if __name__ == "__main__":
    main()
