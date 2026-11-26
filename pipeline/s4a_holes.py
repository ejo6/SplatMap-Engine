"""S4a holes behind people (E-07, PRD §7.2 S4). Runs before S4 in the `recon` env.

For each keyframe, finds the mover-masked pixels whose background no other keyframe ever saw, and
inpaints the frame with LaMa. S4 then supervises only those hole pixels with the inpainted image at
low weight; everything else in the mask stays excluded as before.

Seen-test: the background depth behind a mover is guessed by interpolating each depth row across the
mask. Each masked pixel is back-projected with that depth and projected into every other keyframe; it
counts as seen if it lands inside the frame, outside that frame's mask, and agrees with its depth (10%).

  in : work/<id>/S0/frames/*.jpg, S3/cameras.json, S3/depth/<stem>.npy, S2/masks/union/<stem>.png
  out: work/<id>/S4/holes/<stem>.png  hole mask (255 = never seen), full video resolution
       work/<id>/S4/holes/<stem>.jpg  LaMa-inpainted frame (only for keyframes with a hole)
       work/<id>/S4/holes/holes.json  {frames: {stem: holeFraction}}
"""
import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

STAGE = "S4a"
CV_FROM_GL = np.diag([1.0, -1.0, -1.0, 1.0])
# big-lama as TorchScript (the file simple-lama-inpainting used); plain torch, so it needs no env of its own.
LAMA_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def fill_rows(d, m):
    """Background depth under mask m: per row, linear interpolation between the unmasked neighbours (0 if none)."""
    out = d.copy()
    cols = np.arange(d.shape[1])
    for r in np.nonzero(m.any(1))[0]:
        ok = ~m[r] & (d[r] > 0)
        out[r, m[r]] = np.interp(cols[m[r]], cols[ok], d[r, ok]) if ok.sum() >= 2 else 0
    return out


def load_lama():
    """Returns inpaint(rgb HxWx3 uint8, mask HxW bool) -> HxWx3 uint8."""
    import torch

    path = Path(os.environ.get("LAMA_MODEL") or Path(torch.hub.get_dir()) / "checkpoints" / "big-lama.pt")
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.hub.download_url_to_file(LAMA_URL, str(path))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = torch.jit.load(str(path), map_location=device).eval()

    def inpaint(rgb, mask):
        h, w = mask.shape
        ph, pw = -h % 8, -w % 8  # LaMa needs sides divisible by 8
        img = np.pad(rgb.transpose(2, 0, 1).astype(np.float32) / 255, ((0, 0), (0, ph), (0, pw)), mode="symmetric")
        m = np.pad(mask[None].astype(np.float32), ((0, 0), (0, ph), (0, pw)), mode="symmetric")
        with torch.inference_mode():
            out = model(torch.from_numpy(img)[None].to(device), torch.from_numpy(m)[None].to(device))
        return np.clip(out[0].permute(1, 2, 0).cpu().numpy()[:h, :w] * 255, 0, 255).astype(np.uint8)
    return inpaint


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--min-hole", type=float, default=0.002, help="skip LaMa below this hole fraction of the frame")
    ap.add_argument("--stride", type=int, default=2, help="depth-map pixel stride for the seen-test")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    w, out = args.work, args.work / "S4/holes"
    if (out / "holes.json").exists() and not args.force:
        progress(100, 0)
        return
    out.mkdir(parents=True, exist_ok=True)
    progress(0)

    cams = json.loads((w / "S3/cameras.json").read_text())
    W, H, I = cams["width"], cams["height"], cams["intrinsics"]
    stems = [p.stem for p in sorted((w / "S0/frames").glob("*.jpg"))]
    kf = [f for f in cams["keyframes"] if (w / "S2/masks/union" / f"{stems[f]}.png").exists()]
    c2w = np.array([cams["frames"][f]["c2w"] for f in kf]).reshape(-1, 4, 4) @ CV_FROM_GL
    w2c = np.linalg.inv(c2w)
    depth = np.stack([np.load(w / "S3/depth" / f"{stems[f]}.npy").astype(np.float32) for f in kf])
    dh, dw = depth.shape[1:]
    masks = np.stack([np.asarray(Image.open(w / "S2/masks/union" / f"{stems[f]}.png").convert("L")
                                 .resize((dw, dh), Image.NEAREST)) >= 128 for f in kf])
    fx, fy, cx, cy = I["fx"] * dw / W, I["fy"] * dh / H, I["cx"] * dw / W, I["cy"] * dh / H

    lama, report = None, {}
    for j, f in enumerate(kf):
        hole = np.zeros((dh, dw), bool)
        m = masks[j]
        sub = np.zeros_like(m)
        sub[::args.stride, ::args.stride] = True
        v, u = np.nonzero(m & sub)
        if len(v):
            z = fill_rows(depth[j], masks[j])[v, u]
            ok = z > 0
            p = np.stack([(u + 0.5 - cx) / fx * z, (v + 0.5 - cy) / fy * z, z, np.ones_like(z)], 1) @ c2w[j].T
            seen = np.zeros(len(v), bool)
            for k in range(len(kf)):
                if k == j:
                    continue
                q = p @ w2c[k].T
                zk = q[:, 2]
                uk = np.floor(q[:, 0] / np.maximum(zk, 1e-6) * fx + cx).astype(int)
                vk = np.floor(q[:, 1] / np.maximum(zk, 1e-6) * fy + cy).astype(int)
                inside = (zk > 0.1) & (uk >= 0) & (uk < dw) & (vk >= 0) & (vk < dh)
                uk, vk = np.clip(uk, 0, dw - 1), np.clip(vk, 0, dh - 1)
                dk = depth[k][vk, uk]
                seen |= inside & ~masks[k][vk, uk] & (np.abs(dk - zk) < 0.1 * zk)
            hole[v[ok & ~seen], u[ok & ~seen]] = True
            hole[v[~ok], u[~ok]] = True
            # Back to a dense mask: grow the strided samples, keep them inside the mover mask.
            hole = cv2.dilate(hole.astype(np.uint8), np.ones((2 * args.stride + 1,) * 2, np.uint8)).astype(bool) & masks[j]
        hole_full = cv2.resize(hole.astype(np.uint8) * 255, (W, H), interpolation=cv2.INTER_NEAREST)
        frac = float((hole_full > 0).mean())
        report[stems[f]] = round(frac, 4)
        if frac >= args.min_hole:
            Image.fromarray(hole_full).save(out / f"{stems[f]}.png")
            # LaMa removes the whole (slightly grown) person, so no body pixels leak into the fill.
            person = cv2.dilate(cv2.resize(masks[j].astype(np.uint8) * 255, (W, H), interpolation=cv2.INTER_NEAREST),
                                np.ones((15, 15), np.uint8))
            lama = lama or load_lama()
            rgb = np.asarray(Image.open(w / "S0/frames" / f"{stems[f]}.jpg").convert("RGB"))
            Image.fromarray(lama(rgb, person > 0)).save(out / f"{stems[f]}.jpg", quality=95)
        progress(100 * (j + 1) / len(kf))

    (out / "holes.json").write_text(json.dumps({"frames": report}, indent=1))
    n = sum(1 for x in report.values() if x >= args.min_hole)
    print(f"S4a: {n} of {len(kf)} keyframes have holes, mean hole {np.mean(list(report.values())):.2%}", file=sys.stderr)


if __name__ == "__main__":
    main()
