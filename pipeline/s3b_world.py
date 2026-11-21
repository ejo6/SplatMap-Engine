"""S3b world frame (E-03, PRD §7.2 S3b, §8.1).

Fits the floor plane (RANSAC on back-projected keyframe depth from the lower part of the image),
then moves everything into our world frame: floor at y = 0, +Y up, metres, the first camera above
the origin looking down -Z. Cameras are converted to the three.js convention.

  in : work/<id>/S3/raw_cameras.json, S3/raw_depth/*.npy, S3/raw_conf/*.npy (E-02)
       work/<id>/S2/masks/union/<stem>.png (optional: movers are left out of the floor fit)
  out: work/<id>/S3/cameras.json          PRD §8.4, c2w row-major, three.js convention
       work/<id>/S3/world_transform.json  {matrix:[16] row-major (DA3 world -> ours, includes scale), scale,
                                           plane:[a,b,c,d] in DA3 world, floorInliers, cameraHeight:{median,min,max}}
       work/<id>/S3/depth/<stem>.npy      keyframe depth in world metres, float32 (0 = invalid)
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

STAGE = "S3b"
GL_FROM_CV = np.diag([1.0, -1.0, -1.0, 1.0])  # flip camera Y and Z
EYE_HEIGHT = 1.6  # used to set the scale only when DA3 isn't metric


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def fail(detail):
    print(json.dumps({"error": "reconstruction_failed", "detail": detail}), flush=True)
    sys.exit(1)


def backproject(depth, intr, width, height, c2w, keep, stride=4):
    """Pixels of `depth` (any resolution) where keep[v,u] is set -> (N,3) world points via OpenCV c2w."""
    h, w = depth.shape
    v, u = np.mgrid[0:h:stride, 0:w:stride]
    z = depth[v, u]
    m = keep[v, u] & (z > 0)
    u, v, z = (u[m] + 0.5) * width / w, (v[m] + 0.5) * height / h, z[m]
    pts = np.stack([(u - intr["cx"]) / intr["fx"] * z, (v - intr["cy"]) / intr["fy"] * z, z, np.ones_like(z)], 1)
    return (pts @ c2w.T)[:, :3]


def fit_plane(pts, up_guess, thresh, iters=500, max_tilt_deg=35, seed=0):
    """RANSAC plane whose normal is within max_tilt of up_guess, refined by SVD on inliers.
    Returns (normal pointing along up_guess, d, inlier mask) with normal . x + d = 0 on the plane."""
    rng = np.random.default_rng(seed)
    cos_tilt = np.cos(np.radians(max_tilt_deg))
    best = None
    for _ in range(iters):
        a, b, c = pts[rng.choice(len(pts), 3, replace=False)]
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        if abs(n @ up_guess) < cos_tilt:
            continue
        inl = np.abs((pts - a) @ n) < thresh
        if best is None or inl.sum() > best.sum():
            best = inl
    if best is None:
        return None
    p = pts[best]
    centroid = p.mean(0)
    n = np.linalg.svd(p - centroid, full_matrices=False)[2][-1]
    if n @ up_guess < 0:
        n = -n
    d = -n @ centroid
    return n, d, np.abs(pts @ n + d) < thresh


def world_transform(n, d, c2w0, scale):
    """4x4 (DA3 world -> ours): rotate n to +Y, first camera's forward to -Z, its floor point to the origin, scale."""
    y = n
    fwd = c2w0[:3, 2] - (c2w0[:3, 2] @ y) * y  # OpenCV +Z (forward) projected onto the floor
    z = -fwd / np.linalg.norm(fwd)  # three.js looks down -Z, so world +Z points backwards
    x = np.cross(y, z)
    R = np.stack([x, y, z])  # rows: new axes in DA3 coordinates
    origin = c2w0[:3, 3] - (n @ c2w0[:3, 3] + d) * n  # first camera dropped onto the floor
    T = np.eye(4)
    T[:3, :3] = scale * R
    T[:3, 3] = -scale * R @ origin
    return T


def transform_c2w(T, c2w_cv, scale):
    """Apply the world transform to OpenCV c2w matrices and convert to three.js (rotation stays orthonormal)."""
    out = T @ c2w_cv
    out[:, :3, :3] /= scale
    return out @ GL_FROM_CV


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--lower", type=float, default=0.4, help="fraction of the image (from the bottom) used for the floor")
    ap.add_argument("--thresh", type=float, default=0.05, help="RANSAC inlier distance in metres")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    s3 = args.work / "S3"
    if (s3 / "cameras.json").exists() and not args.force:
        print(f"{s3 / 'cameras.json'} exists, skipping", file=sys.stderr)
        return
    raw = json.loads((s3 / "raw_cameras.json").read_text())
    W, H, intr, kf = raw["width"], raw["height"], raw["intrinsics"], raw["keyframes"]
    c2w = np.array([f["c2w"] for f in raw["frames"]], dtype=np.float64).reshape(-1, 4, 4)
    stems = [p.stem for p in sorted((args.work / "S0" / "frames").glob("*.jpg"))]
    progress(0)

    from PIL import Image
    pts = []
    for f in kf:
        depth = np.load(s3 / "raw_depth" / f"{stems[f]}.npy").astype(np.float32)
        h, w = depth.shape
        keep = np.zeros((h, w), bool)
        keep[int(h * (1 - args.lower)):] = True
        conf_p = s3 / "raw_conf" / f"{stems[f]}.npy"
        if conf_p.exists():
            conf = np.load(conf_p).astype(np.float32)
            keep &= conf >= np.percentile(conf, 30)
        mask_p = args.work / "S2" / "masks" / "union" / f"{stems[f]}.png"
        if mask_p.exists():
            keep &= np.asarray(Image.open(mask_p).convert("L").resize((w, h), Image.NEAREST)) < 128
        pts.append(backproject(depth, intr, W, H, c2w[f], keep))
    pts = np.concatenate(pts)
    pts = pts[np.random.default_rng(0).choice(len(pts), min(len(pts), 200_000), replace=False)]
    progress(40)

    up_guess = -c2w[kf, :3, 1].mean(0)  # OpenCV camera -Y is up, averaged over the shot
    up_guess /= np.linalg.norm(up_guess)
    fit = fit_plane(pts, up_guess, args.thresh)
    if fit is None or fit[2].mean() < 0.05:
        fail("no floor plane found in the lower part of the frames")
    n, d, inl = fit
    heights = c2w[:, :3, 3] @ n + d
    if np.median(heights) <= 0:
        fail("cameras are below the fitted floor plane")
    scale = 1.0 if raw["isMetric"] else EYE_HEIGHT / float(np.median(heights))
    T = world_transform(n, d, c2w[0], scale)
    cams = transform_c2w(T, c2w, scale)
    h_world = cams[:, 1, 3]
    if not 1.2 <= np.median(h_world) <= 2.0:
        print(f"warning: median camera height {np.median(h_world):.2f} m is outside 1.2-2.0 m", file=sys.stderr)
    progress(70)

    (s3 / "depth").mkdir(exist_ok=True)
    for f in kf:
        depth = np.load(s3 / "raw_depth" / f"{stems[f]}.npy").astype(np.float32)
        np.save(s3 / "depth" / f"{stems[f]}.npy", depth * scale)
    (s3 / "world_transform.json").write_text(json.dumps({
        "matrix": T.ravel().tolist(), "scale": scale, "plane": [*n.tolist(), float(d)],
        "floorInliers": round(float(inl.mean()), 3),
        "cameraHeight": {k: round(float(fn(h_world)), 3) for k, fn in (("median", np.median), ("min", np.min), ("max", np.max))},
    }, indent=1))
    (s3 / "cameras.json").write_text(json.dumps({
        "fps": raw["fps"], "width": W, "height": H, "intrinsics": intr, "keyframes": kf,
        "frames": [{"f": i, "c2w": [round(float(x), 6) for x in cams[i].ravel()]} for i in range(len(cams))],
    }))
    print(f"floor inliers {inl.mean():.0%}, camera height median {np.median(h_world):.2f} m, scale {scale:.3f}", file=sys.stderr)
    progress(100, 0)


if __name__ == "__main__":
    main()
