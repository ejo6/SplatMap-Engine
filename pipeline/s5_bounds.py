"""S5 bounds (E-06, PRD §7.2 S5, §8.4, §10.4). CPU only.

Carves a voxel grid from the keyframe depth maps, then derives what the viewer needs to keep the
walker where the reconstruction is real:
  - coverage: per voxel, how many keyframe rays saw it (passed through or ended there) and from how
    many directions; voxels holding solid splats get a floor value. 0 = never seen, 255 = well observed.
  - walkable: floor cells that were seen, are free from just above the floor up to eye height, and lie
    within fog.radius of the camera path. Stored as a 2D signed distance field (negative = walkable).
  - colliders: one box per obstacle column (occupied voxels between knee and head height) inside the walk grid.
  - fog colour: mean colour of the upper third of the keyframes.

  in : work/<id>/S3/cameras.json, S3/depth/<stem>.npy (E-03), S0/frames/*.jpg, S4/world.ply,
       S2/masks/union/<stem>.png (optional: movers are not carved)
  out: work/<id>/S5/walk.json, walk_sdf.bin, coverage.bin, colliders.glb, walk_debug.png
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from plyfile import PlyData
from scipy import ndimage

STAGE = "S5"
CV_FROM_GL = np.diag([1.0, -1.0, -1.0, 1.0])


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def fail(detail):
    print(json.dumps({"error": "reconstruction_failed", "detail": detail}), flush=True)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--cell", type=float, default=0.15, help="coverage voxel size (m)")
    ap.add_argument("--sdf-cell", type=float, default=0.1, help="walk SDF cell size (m)")
    ap.add_argument("--radius", type=float, default=4.0, help="fog.radius: max walk distance from the camera path (m)")
    ap.add_argument("--max-depth", type=float, default=15.0, help="carve rays at most this far (m)")
    ap.add_argument("--stride", type=int, default=4, help="depth-map pixel stride for rays")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    w, out = args.work, args.work / "S5"
    if (out / "walk.json").exists() and not args.force:
        progress(100, 0)
        return
    out.mkdir(parents=True, exist_ok=True)
    progress(0)

    cams = json.loads((w / "S3/cameras.json").read_text())
    stems = [p.stem for p in sorted((w / "S0/frames").glob("*.jpg"))]
    kf = cams["keyframes"]
    c2w = np.array([f["c2w"] for f in cams["frames"]]).reshape(-1, 4, 4)
    centers = c2w[:, :3, 3]
    eye = float(np.median(centers[:, 1]))
    W, H, intr = cams["width"], cams["height"], cams["intrinsics"]

    # Grid: the solid-splat extent (1-99th percentile), padded, capped at ~8M voxels.
    v = PlyData.read(str(w / "S4/world.ply"))["vertex"].data
    splats = np.stack([v["x"], v["y"], v["z"]], 1)[1 / (1 + np.exp(-v["opacity"])) > 0.5]
    lo = np.minimum(np.percentile(splats, 1, 0), centers.min(0) - args.radius) - 0.5
    hi = np.maximum(np.percentile(splats, 99, 0), centers.max(0) + args.radius) + 0.5
    lo[1], hi[1] = min(lo[1], -0.3), max(hi[1], eye + 1.0)
    cell = max(args.cell, float(np.cbrt(np.prod(hi - lo) / 8e6)))
    dims = np.ceil((hi - lo) / cell).astype(int)
    n = int(np.prod(dims))
    print(f"S5: grid {dims.tolist()} @ {cell:.2f} m, eye {eye:.2f} m", file=sys.stderr)

    def index(p):
        """(N,3) world points -> flat voxel index (x fastest), -1 outside."""
        ijk = np.floor((p - lo) / cell).astype(int)
        ok = ((ijk >= 0) & (ijk < dims)).all(1)
        flat = ijk[:, 0] + dims[0] * (ijk[:, 1] + dims[1] * ijk[:, 2])
        return np.where(ok, flat, -1)

    hits, passes = np.zeros(n, np.float32), np.zeros(n, np.float32)
    dirsum = np.zeros((n, 3), np.float32)
    fog_cols = []
    mask_dir = w / "S2/masks/union"
    for j, f in enumerate(kf):
        d = np.load(w / "S3/depth" / f"{stems[f]}.npy").astype(np.float32)
        dh, dw = d.shape
        if (mask_dir / f"{stems[f]}.png").exists():
            mover = np.asarray(Image.open(mask_dir / f"{stems[f]}.png").convert("L").resize((dw, dh), Image.NEAREST)) >= 128
            d[mover] = 0
        vv, uu = np.mgrid[0:dh:args.stride, 0:dw:args.stride]
        z = d[vv, uu]
        m = z > 0
        uu, vv, z = uu[m], vv[m], z[m]
        ray = np.stack([(uu + 0.5) * W / dw - intr["cx"], (vv + 0.5) * H / dh - intr["cy"], np.zeros_like(z)], 1)
        ray[:, 0] /= intr["fx"]
        ray[:, 1] /= intr["fy"]
        ray[:, 2] = 1.0
        cv = c2w[f] @ CV_FROM_GL
        o, rw = cv[:3, 3], ray @ cv[:3, :3].T  # world ray per unit camera depth
        unit = rw / np.linalg.norm(rw, axis=1, keepdims=True)

        surf = index(o + rw * z[:, None])
        ok = (surf >= 0) & (z < args.max_depth)
        np.add.at(hits, surf[ok], 1)
        np.add.at(dirsum, surf[ok], unit[ok])
        # Free space: samples every half cell from the camera up to one cell short of the surface.
        reach = (np.minimum(z, args.max_depth) - cell) * np.linalg.norm(rw, axis=1)  # metres along the ray
        steps = np.arange(0.5 * cell, reach.max(), 0.5 * cell, dtype=np.float32)
        for s0 in range(0, len(steps), 64):
            t = steps[s0:s0 + 64]
            live = t[None, :] < reach[:, None]
            r_idx, s_idx = np.nonzero(live)
            idx = index(o + unit[r_idx] * t[s_idx, None])
            keep = idx >= 0
            passes += np.bincount(idx[keep], minlength=n).astype(np.float32)
            np.add.at(dirsum, idx[keep][::8], unit[r_idx[keep][::8]] * 8)
        rgb = np.asarray(Image.open(w / "S0/frames" / f"{stems[f]}.jpg").convert("RGB"), np.float32)
        fog_cols.append(rgb[: rgb.shape[0] // 3].reshape(-1, 3).mean(0) / 255)
        progress(80 * (j + 1) / len(kf))

    seen = hits + passes
    spread = 1 - np.linalg.norm(dirsum, axis=1) / np.maximum(seen, 1)  # 0 = one direction, ->1 = all around
    cov = np.clip(seen / 8, 0, 1) * (0.5 + 0.5 * np.clip(spread / 0.3, 0, 1))
    splat_idx = index(splats)
    dense = np.bincount(splat_idx[splat_idx >= 0], minlength=n) >= 3
    cov = np.where(dense, np.maximum(cov, 0.4), cov)
    coverage = (cov * 255).astype(np.uint8)
    coverage.tofile(out / "coverage.bin")
    progress(85)

    # Walkable on the SDF grid (x columns, z rows) over the grid's xz extent.
    occ = ((hits >= 2) & (hits > 0.3 * passes)).reshape(dims[2], dims[1], dims[0])  # [z, y, x]
    seen3 = (seen > 0).reshape(dims[2], dims[1], dims[0])
    ys = lo[1] + (np.arange(dims[1]) + 0.5) * cell
    body = (ys > 0.3) & (ys < eye)  # knee to eye: anything here blocks walking
    floor = (ys > -0.3) & (ys < 0.3)
    blocked = occ[:, body, :].any(1)  # [z, x] in voxel cells
    floor_seen = seen3[:, floor, :].any(1)
    sw, sh = int(np.ceil((hi[0] - lo[0]) / args.sdf_cell)), int(np.ceil((hi[2] - lo[2]) / args.sdf_cell))
    gx = lo[0] + (np.arange(sw) + 0.5) * args.sdf_cell
    gz = lo[2] + (np.arange(sh) + 0.5) * args.sdf_cell
    vx = np.clip(((gx - lo[0]) / cell).astype(int), 0, dims[0] - 1)
    vz = np.clip(((gz - lo[2]) / cell).astype(int), 0, dims[2] - 1)
    blocked_g, seen_g = blocked[np.ix_(vz, vx)], floor_seen[np.ix_(vz, vx)]
    path = np.zeros((sh, sw), bool)
    pi = np.clip(((centers[:, 2] - lo[2]) / args.sdf_cell).astype(int), 0, sh - 1)
    pj = np.clip(((centers[:, 0] - lo[0]) / args.sdf_cell).astype(int), 0, sw - 1)
    path[pi, pj] = True
    path_dist = ndimage.distance_transform_edt(~path) * args.sdf_cell
    # Floor right around the camera is rarely in frame, but the camera stood there: count it as seen.
    walk = (seen_g | (path_dist <= 1.5)) & ~blocked_g & (path_dist <= args.radius)
    lab, _ = ndimage.label(walk)  # keep only regions connected to the camera path
    walk &= np.isin(lab, np.unique(lab[pi, pj][lab[pi, pj] > 0]))
    if walk.sum() == 0:
        fail("no walkable floor cells near the camera path")
    sdf = (ndimage.distance_transform_edt(~walk) - ndimage.distance_transform_edt(walk)) * args.sdf_cell
    sdf.astype(np.float32).tofile(out / "walk_sdf.bin")
    progress(90)

    # Colliders: one box per blocked voxel column next to the walkable region (up to its top occupied voxel).
    import trimesh
    near_walk = ndimage.binary_dilation(walk, iterations=int(np.ceil(1.0 / args.sdf_cell)))
    near_v = np.zeros_like(blocked)
    near_v[vz[:, None], vx[None, :]] |= near_walk
    boxes = []
    for zi, xi in zip(*np.nonzero(blocked & near_v)):
        top = ys[body][occ[zi, body, xi]].max() + cell / 2
        b = trimesh.creation.box(extents=[cell, top, cell])
        b.apply_translation([lo[0] + (xi + 0.5) * cell, top / 2, lo[2] + (zi + 0.5) * cell])
        boxes.append(b)
    if boxes:  # trimesh can't export an empty scene; no file means no colliders
        (out / "colliders.glb").write_bytes(trimesh.Scene(trimesh.util.concatenate(boxes)).export(file_type="glb"))

    fog = [round(float(c), 3) for c in np.mean(fog_cols, 0)]
    (out / "walk.json").write_text(json.dumps({
        "eyeHeight": round(eye, 3), "startFrame": 0,
        "fog": {"color": fog, "radius": args.radius},
        "sdf": {"url": "walk_sdf.bin", "origin": [float(lo[0]), float(lo[2])], "cellSize": args.sdf_cell,
                "width": sw, "height": sh},
        "coverage": {"url": "coverage.bin", "origin": lo.tolist(), "cellSize": cell, "dims": dims.tolist()},
    }, indent=1))

    # Debug: top-down SDF (green walkable, red blocked, grey seen floor) + camera path in white.
    img = np.zeros((sh, sw, 3), np.uint8)
    img[seen_g] = 60
    img[walk] = (40, 160, 60)
    img[blocked_g] = (170, 40, 40)
    img[pi, pj] = 255
    Image.fromarray(img[::-1]).resize((sw * 4, sh * 4), Image.NEAREST).save(out / "walk_debug.png")
    print(f"S5: walkable {walk.sum() * args.sdf_cell ** 2:.1f} m², {len(boxes)} collider boxes, "
          f"coverage>=160 {(coverage >= 160).mean():.1%}, fog {fog}", file=sys.stderr)
    progress(100, 0)


if __name__ == "__main__":
    main()
