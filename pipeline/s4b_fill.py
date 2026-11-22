"""S4b Atlas fill (E-12, PRD §3, §11). Experimental: paid API, not in the default path, run by hand.

Sends the shot's keyframes to World Labs Atlas `posedImages2Splats` WITH our own cameras (S3), depth and
mover masks, so the returned splats are already in our world frame and metres: no alignment needed.
With refine=true Atlas places extra cameras and generatively repairs their renders, which fills space the
video never saw. Only the Atlas splats far from any real splat are appended to ours; real splats come
first, generated ones are the tail (indices >= fill.json realCount) so the viewer can tint them.

  in : work/<id>/S0/frames, S3/cameras.json, S3/depth, S2/masks/union, S4/{world.ply, train.json}; env WLT_API_KEY
       (Atlas project key, https://atlas.worldlabs.ai/developers: tasks.create, operations.read, assets.create)
  out: work/<id>/S4/atlas/   operation.json + atlas.spz (cached: re-runs never re-submit)
       work/<id>/S4/world_filled.ply   S4 splats + Atlas splats outside the observed area
       work/<id>/S4/fill.json          {operationId, realCount, fillCount, overlapMedian}
"""
import argparse
import base64
import gzip
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

STAGE = "S4b"
API = os.environ.get("WLT_API_BASE_URL", "https://api.atlas.worldlabs.ai/api/v2")
W, H = 1280, 720  # Atlas camera grid; our video is 1280x720 too


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def fail(detail):
    print(json.dumps({"error": "reconstruction_failed", "detail": detail}), flush=True)
    sys.exit(1)


def log(*a):
    print("S4b:", *a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- Atlas API

def api(method, path, **kw):
    import requests
    r = requests.request(method, API + path, headers={"WLT-Api-Key": os.environ["WLT_API_KEY"]}, timeout=300, **kw)
    if not r.ok:
        fail(f"Atlas {method} {path}: {r.status_code} {r.text[:400]}")
    return r.json()


def upload(data: bytes, name: str):
    """Asset from inline bytes (< 10 MiB) -> {assetId}."""
    a = api("POST", "/assets", json={"asset": {"displayName": name, "base64": base64.b64encode(data).decode()}})
    return {"assetId": a["id"]}


def frame_payload(w, cams, stems, f):
    """One PosedRGBDAsset: image, mover mask (1 = keep), linear-depth EXR in metres, camera in three.js axes."""
    os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
    import cv2
    stem = stems[f]
    img = (w / "S0/frames" / f"{stem}.jpg").read_bytes()
    d = np.load(w / "S3/depth" / f"{stem}.npy").astype(np.float32)
    d = cv2.resize(d, (W, H), interpolation=cv2.INTER_NEAREST)
    exr = cv2.imencode(".exr", d)[1].tobytes()
    frame = {"imageAsset": upload(img, f"{stem}.jpg"), "depth": {"depthAsset": upload(exr, f"{stem}.exr")}}
    mask_png = w / "S2/masks/union" / f"{stem}.png"
    if mask_png.exists():
        keep = (cv2.imread(str(mask_png), cv2.IMREAD_GRAYSCALE) < 128).astype(np.uint8) * 255
        frame["maskAsset"] = upload(cv2.imencode(".png", keep)[1].tobytes(), f"{stem}_mask.png")
    c2w = np.array(cams["frames"][f]["c2w"]).reshape(4, 4)
    i = cams["intrinsics"]
    frame["camera"] = {
        "extrinsics": {"position": c2w[:3, 3].tolist(), "quaternion": Rotation.from_matrix(c2w[:3, :3]).as_quat().tolist(),
                       "coordinateSystem": "rub"},
        "intrinsics": {"fx": i["fx"], "fy": i["fy"], "cx": i["cx"], "cy": i["cy"], "width": W, "height": H},
    }
    return frame


def run_atlas(w, out, n_frames, refine):
    """Submit posedImages2Splats once (cached in out/operation.json), wait, download the SPZ."""
    import requests
    op_json = out / "operation.json"
    if op_json.exists():
        op = json.loads(op_json.read_text())
    else:
        cams = json.loads((w / "S3/cameras.json").read_text())
        stems = [p.stem for p in sorted((w / "S0/frames").glob("*.jpg"))]
        kf = cams["keyframes"]
        kf = [kf[int(i)] for i in np.linspace(0, len(kf) - 1, min(n_frames, len(kf)))]
        frames = []
        for j, f in enumerate(kf):
            frames.append(frame_payload(w, cams, stems, f))
            progress(30 * (j + 1) / len(kf))
        body = {"posedFrames": frames, "refine": refine}
        r = requests.post(API + "/tasks:posedImages2Splats", json=body, timeout=300,
                          headers={"WLT-Api-Key": os.environ["WLT_API_KEY"], "Idempotency-Key": f"s4b-{w.name}-{len(kf)}-{refine}"})
        if not r.ok:
            fail(f"Atlas submit: {r.status_code} {r.text[:400]}")
        op = r.json()
        op_json.write_text(json.dumps(op, indent=1))  # cache the id at once so a crash never re-submits
        log("submitted", op["id"], f"{len(kf)} frames, refine={refine}")
    t0 = time.time()
    while not op.get("done"):
        time.sleep(15)
        op = api("GET", f"/operations/{op['id']}")
        state = (op.get("metadata") or {}).get("state")
        print(json.dumps({"stage": STAGE, "pct": 35, "eta": None, "state": state, "elapsed": int(time.time() - t0)}), flush=True)
    op_json.write_text(json.dumps(op, indent=1))
    if op.get("error"):
        fail(f"Atlas operation {op['id']} failed: {op['error']}")
    spz = out / "atlas.spz"
    if not spz.exists():
        resp = op["response"]
        asset = resp.get("draftSplat") or max(resp["refinedSplats"].items(), key=lambda kv: int(kv[0]))[1]
        url = asset.get("url") or api("POST", f"/assets/{asset['assetId']}:createReadUrl", json={})["readUrl"]
        spz.write_bytes(requests.get(url, timeout=600).content)
    return op, spz


# ---------------------------------------------------------------- SPZ (Niantic format, v2/v3)

def read_spz(path):
    """-> dict of float arrays: xyz (N,3), opacity logit (N,), f_dc (N,3), log scales (N,3), quat wxyz (N,4)."""
    b = gzip.decompress(Path(path).read_bytes())
    magic, version, n = (int(x) for x in np.frombuffer(b[:12], "<u4"))
    frac = b[13]
    if magic != 0x5053474E or version not in (2, 3):
        fail(f"unsupported SPZ (magic {magic:#x}, version {version})")
    o = 16
    pos = np.frombuffer(b, np.uint8, n * 9, o).reshape(n, 3, 3).astype(np.int32)
    o += n * 9
    xyz = pos[..., 0] | (pos[..., 1] << 8) | (pos[..., 2] << 16)
    xyz = np.where(xyz & 0x800000, xyz - (1 << 24), xyz) / float(1 << frac)
    alpha = np.frombuffer(b, np.uint8, n, o) / 255.0
    o += n
    col = np.frombuffer(b, np.uint8, n * 3, o).reshape(n, 3) / 255.0
    o += n * 3
    scale = np.frombuffer(b, np.uint8, n * 3, o).reshape(n, 3) / 16.0 - 10.0
    o += n * 3
    if version == 2:
        r = np.frombuffer(b, np.uint8, n * 3, o).reshape(n, 3) / 127.5 - 1.0
        quat = np.column_stack([np.sqrt(np.clip(1 - (r ** 2).sum(1), 0, 1)), r])
    else:  # smallest-three: top 2 bits = largest index, then 3 x (9-bit magnitude + sign), component 3 first
        packed = np.frombuffer(b, "<u4", n, o).astype(np.int64)
        largest = packed >> 30
        xyzw = np.zeros((n, 4))
        for i in range(3, -1, -1):
            sel = largest != i
            mag = (packed & 511) / 511.0 * np.sqrt(0.5)
            xyzw[sel, i] = np.where((packed >> 9) & 1, -mag, mag)[sel]
            packed = np.where(sel, packed >> 10, packed)
        xyzw[np.arange(n), largest] = np.sqrt(np.clip(1 - (xyzw ** 2).sum(1), 0, 1))
        quat = xyzw[:, [3, 0, 1, 2]]
    alpha = np.clip(alpha, 1e-4, 1 - 1e-4)
    return {"xyz": xyz, "opacity": np.log(alpha / (1 - alpha)), "f_dc": (col - 0.5) / 0.15, "scale": scale, "quat": quat}


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--frames", type=int, default=128, help="keyframes sent to Atlas (2-512 with refine, 2-32 without)")
    ap.add_argument("--draft", action="store_true", help="refine=false: cheaper reconstruction only, no generative fill")
    ap.add_argument("--keep-dist", type=float, default=0.2, help="drop Atlas splats this close to a real splat (m)")
    ap.add_argument("--margin", type=float, default=1.0, help="keep Atlas splats within the S4 scene box grown by this (m)")
    ap.add_argument("--force", action="store_true", help="redo the merge (never re-submits a cached operation)")
    args = ap.parse_args()
    from plyfile import PlyData, PlyElement
    w = args.work
    out = w / ("S4/atlas_draft" if args.draft else "S4/atlas")
    out_ply, out_json = w / "S4/world_filled.ply", w / "S4/fill.json"
    if out_ply.exists() and not args.force:
        progress(100, 0)
        return
    if not (out / "operation.json").exists() and "WLT_API_KEY" not in os.environ:
        fail("WLT_API_KEY is not set")
    out.mkdir(parents=True, exist_ok=True)
    progress(0)

    op, spz = run_atlas(w, out, min(args.frames, 32) if args.draft else args.frames, not args.draft)
    g = read_spz(spz)
    real = PlyData.read(str(w / "S4/world.ply"))["vertex"].data
    xyz_r = np.stack([real["x"], real["y"], real["z"]], 1).astype(np.float64)
    solid = 1 / (1 + np.exp(-real["opacity"])) > 0.5
    dist = cKDTree(xyz_r[solid]).query(g["xyz"], distance_upper_bound=5.0)[0]
    overlap = float(np.median(dist[np.isfinite(dist)])) if np.isfinite(dist).any() else float("inf")
    log(f"real {len(real)}, atlas {len(g['xyz'])}; median distance of Atlas splats to real ones {overlap:.3f} m")
    # Keep what's new (far from real splats) but near the scene: Atlas also scatters floaters tens of metres out.
    lo, hi = (np.array(b) for b in json.loads((w / "S4/train.json").read_text())["box"])
    inside = ((g["xyz"] >= lo - args.margin) & (g["xyz"] <= hi + args.margin)).all(1)
    far = (dist > args.keep_dist) & inside
    log(f"keeping {far.sum()} Atlas splats more than {args.keep_dist} m from a real splat, inside the scene box")
    progress(90)

    fill = np.zeros(int(far.sum()), dtype=real.dtype)  # higher SH stays 0: view-independent colour
    fill["x"], fill["y"], fill["z"] = g["xyz"][far].T
    fill["opacity"] = g["opacity"][far]
    for k in range(3):
        fill[f"f_dc_{k}"] = g["f_dc"][far, k]
        fill[f"scale_{k}"] = g["scale"][far, k]
    for k in range(4):
        fill[f"rot_{k}"] = g["quat"][far, k]
    PlyData([PlyElement.describe(np.concatenate([real, fill]), "vertex")]).write(str(out_ply))
    out_json.write_text(json.dumps({"operationId": op["id"], "realCount": len(real), "fillCount": int(far.sum()),
                                    "overlapMedian": round(overlap, 4)}, indent=1))
    progress(100, 0)


if __name__ == "__main__":
    main()
