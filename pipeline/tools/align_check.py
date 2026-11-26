"""Alignment check and QA renders (E-05, PRD §14 G2).

    python pipeline/tools/align_check.py --work work/<id> [--n 10]

1. Renders the S4 splat at n evenly spaced frames from S3/cameras.json and compares with the source frames.
   PSNR/SSIM are on non-mover pixels (S2 union mask), since movers aren't in the splat.
   -> qa/align.json {frames:[{f, psnr, ssim}], psnr, ssim}, qa/align_sheet.jpg (source | render | 50/50 blend)
2. Renders 8 QA views for human review: path at 25/50/75%, and at 50%
   +-1 m sideways, 1 m forward, +-20 deg yaw.
   -> qa/view_<name>.jpg, qa/views.json [{name, file, c2w:[16]}]
Runs as S9b of pipeline/run.py (or by hand in the `recon` env with the CUDA vars from docs/gpu-setup.md).
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s4_background import ssim_map  # noqa: E402

CV_FROM_GL = np.diag([1.0, -1.0, -1.0, 1.0])


def yaw(deg):
    r = math.radians(deg)
    return np.array([[math.cos(r), 0, math.sin(r)], [0, 1, 0], [-math.sin(r), 0, math.cos(r)]])


def qa_poses(c2w):
    """c2w (three.js, 4x4) of the centre frame -> {name: c2w} offsets in the camera's own frame (yaw about world +Y)."""
    def moved(right=0.0, fwd=0.0, deg=0.0):
        m = c2w.copy()
        m[:3, 3] += right * c2w[:3, 0] - fwd * c2w[:3, 2]  # three.js: +X right, -Z forward
        m[:3, :3] = yaw(deg) @ c2w[:3, :3]
        return m
    return {"left_1m": moved(right=-1), "right_1m": moved(right=1), "forward_1m": moved(fwd=1),
            "yaw_left_20": moved(deg=20), "yaw_right_20": moved(deg=-20)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--force", action="store_true", help="accepted for the runner; renders are always redone")
    args = ap.parse_args()

    import torch
    from PIL import Image
    from plyfile import PlyData
    from gsplat import rasterization

    cams = json.loads((args.work / "S3" / "cameras.json").read_text())
    W, H, I = cams["width"], cams["height"], cams["intrinsics"]
    frames = sorted((args.work / "S0" / "frames").glob("*.jpg"))
    c2w_all = np.array([f["c2w"] for f in cams["frames"]]).reshape(-1, 4, 4)
    v = PlyData.read(args.work / "S4" / "world.ply")["vertex"].data
    g = lambda *k: torch.tensor(np.stack([v[x] for x in k], 1), dtype=torch.float32, device="cuda")
    rest = sorted((n for n in v.dtype.names if n.startswith("f_rest_")), key=lambda n: int(n.split("_")[-1]))
    sh = g("f_dc_0", "f_dc_1", "f_dc_2")[:, None]
    if rest:  # ply stores f_rest channel-major: (3, K)
        sh = torch.cat([sh, g(*rest).reshape(len(v), 3, -1).transpose(1, 2)], 1)
    splat = dict(means=g("x", "y", "z"), quats=torch.nn.functional.normalize(g("rot_0", "rot_1", "rot_2", "rot_3"), dim=-1),
                 scales=torch.exp(g("scale_0", "scale_1", "scale_2")), opacities=torch.sigmoid(g("opacity")[:, 0]), colors=sh)
    deg = int(round(math.sqrt(sh.shape[1]))) - 1
    K = torch.tensor([[I["fx"], 0, I["cx"]], [0, I["fy"], I["cy"]], [0, 0, 1]], dtype=torch.float32, device="cuda")[None]

    def render(c2w_gl):
        vm = torch.tensor(np.linalg.inv(c2w_gl @ CV_FROM_GL), dtype=torch.float32, device="cuda")[None]
        with torch.no_grad():
            img = rasterization(**splat, viewmats=vm, Ks=K, width=W, height=H, sh_degree=deg)[0][0]
        return img.clamp(0, 1)

    out = args.work / "qa"
    out.mkdir(exist_ok=True)
    mask_dir = args.work / "S2" / "masks" / "union"
    rows, report = [], []
    for f in np.linspace(0, len(frames) - 1, args.n).astype(int):
        r = render(c2w_all[f])
        gt = torch.tensor(np.asarray(Image.open(frames[f]).convert("RGB")), device="cuda").float() / 255
        keep = torch.ones(H, W, device="cuda")
        if (mask_dir / f"{frames[f].stem}.png").exists():
            keep = torch.tensor(np.asarray(Image.open(mask_dir / f"{frames[f].stem}.png").convert("L")) < 128, device="cuda").float()
        mse = (((r - gt) ** 2) * keep[..., None]).sum() / (keep.sum() * 3)
        smap = ssim_map(r.permute(2, 0, 1)[None], gt.permute(2, 0, 1)[None])[0].mean(0)
        report.append({"f": int(f), "psnr": round(-10 * math.log10(max(mse.item(), 1e-10)), 2),
                       "ssim": round(((smap * keep).sum() / keep.sum()).item(), 3)})
        a, b = (gt.cpu().numpy() * 255).astype(np.uint8), (r.cpu().numpy() * 255).astype(np.uint8)
        rows.append(np.concatenate([a, b, ((a.astype(np.uint16) + b) // 2).astype(np.uint8)], 1))
        print(f"frame {f}: psnr {report[-1]['psnr']} ssim {report[-1]['ssim']}", file=sys.stderr)
    sheet = Image.fromarray(np.concatenate(rows, 0))
    sheet.resize((sheet.width // 2, sheet.height // 2)).save(out / "align_sheet.jpg", quality=85)
    summary = {"frames": report, "psnr": round(float(np.mean([x["psnr"] for x in report])), 2),
               "ssim": round(float(np.mean([x["ssim"] for x in report])), 3)}
    (out / "align.json").write_text(json.dumps(summary, indent=1))

    n = len(c2w_all)
    poses = {f"path_{p}": c2w_all[int((n - 1) * p / 100)] for p in (25, 50, 75)}
    poses.update(qa_poses(c2w_all[(n - 1) // 2]))
    views = []
    for name, c2w in poses.items():
        Image.fromarray((render(c2w).cpu().numpy() * 255).astype(np.uint8)).save(out / f"view_{name}.jpg", quality=90)
        views.append({"name": name, "file": f"view_{name}.jpg", "c2w": c2w.ravel().round(6).tolist()})
    (out / "views.json").write_text(json.dumps(views, indent=1))
    print(f"align: psnr {summary['psnr']} ssim {summary['ssim']}; {len(views)} QA views in {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
