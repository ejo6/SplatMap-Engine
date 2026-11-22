"""S4 background splat (E-04, PRD §7.2 S4, FR-12).

gsplat training on the keyframes with the S3b cameras, directly in our world frame (no normalization).
Movers (S2 union mask) are excluded from BOTH the RGB and the depth losses (Orbis PR #80): the rendered
image/depth is replaced by the target inside the mask, so those pixels give no error and no gradient.
MCMC densification with a fixed splat cap; init from DA3 keyframe depth.
Holes (E-07): mask pixels no keyframe ever saw (S4a) are supervised with the LaMa-inpainted frame at --hole-weight.

  in : work/<id>/S0/frames/*.jpg, S3/cameras.json, S3/depth/<stem>.npy (E-03), S2/masks/union/<stem>.png (A-01),
       S4/holes/<stem>.png + .jpg (S4a, optional)
  out: work/<id>/S4/world.ply   standard 3DGS ply, world frame, cropped to the scene box
       work/<id>/S4/train.json  {steps, seconds, splats, psnr (non-mover pixels, last 500 steps)}
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

STAGE = "S4"
CV_FROM_GL = np.diag([1.0, -1.0, -1.0, 1.0])


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": None if eta is None else int(eta)}), flush=True)


def fail(detail):
    print(json.dumps({"error": "reconstruction_failed", "detail": detail}), flush=True)
    sys.exit(1)


def backproject(depth, K, c2w_cv, keep, stride):
    """depth (h,w) with K at that resolution, OpenCV c2w -> (N,3) world points and their pixel rows/cols."""
    h, w = depth.shape
    v, u = np.mgrid[0:h:stride, 0:w:stride]
    m = keep[v, u] & (depth[v, u] > 0)
    u, v = u[m], v[m]
    z = depth[v, u]
    x = (u + 0.5 - K[0, 2]) / K[0, 0] * z
    y = (v + 0.5 - K[1, 2]) / K[1, 1] * z
    pts = np.stack([x, y, z, np.ones_like(z)], 1) @ c2w_cv.T
    return pts[:, :3], v, u


def ssim_map(a, b, window=11, sigma=1.5):
    """(1,3,H,W) images in [0,1] -> SSIM map (1,3,H,W)."""
    import torch
    import torch.nn.functional as F
    g = torch.exp(-((torch.arange(window, device=a.device) - window // 2) ** 2) / (2 * sigma**2))
    g = (g / g.sum())[None, :] * (g / g.sum())[:, None]
    k = g.expand(3, 1, window, window)
    f = lambda x: F.conv2d(x, k, padding=window // 2, groups=3)
    mu_a, mu_b = f(a), f(b)
    s_a, s_b, s_ab = f(a * a) - mu_a**2, f(b * b) - mu_b**2, f(a * b) - mu_a * mu_b
    c1, c2 = 0.01**2, 0.03**2
    return ((2 * mu_a * mu_b + c1) * (2 * s_ab + c2)) / ((mu_a**2 + mu_b**2 + c1) * (s_a + s_b + c2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--steps", type=int, default=30_000)
    ap.add_argument("--cap", type=int, default=1_500_000, help="max splats (PRD §10.8 LoD budget)")
    ap.add_argument("--init", type=int, default=300_000, help="initial splats from DA3 depth")
    ap.add_argument("--sh-degree", type=int, default=1)
    ap.add_argument("--depth-weight", type=float, default=0.1)
    ap.add_argument("--max-dist", type=float, default=80, help="drop init points farther than this from their camera (m)")
    ap.add_argument("--hole-weight", type=float, default=0.2, help="loss weight of LaMa-filled hole pixels (S4a)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = args.work / STAGE
    if (out / "world.ply").exists() and not args.force:
        print(f"{out / 'world.ply'} exists, skipping", file=sys.stderr)
        return
    cams = json.loads((args.work / "S3" / "cameras.json").read_text())
    W, H, I = cams["width"], cams["height"], cams["intrinsics"]
    stems = [p.stem for p in sorted((args.work / "S0" / "frames").glob("*.jpg"))]
    kf = cams["keyframes"]
    mask_dir = args.work / "S2" / "masks" / "union"
    if not mask_dir.exists():
        print("warning: no S2 union masks, movers will be baked into the splat", file=sys.stderr)
    else:  # a keyframe without its mask would bake people in, so leave it out
        dropped = [f for f in kf if not (mask_dir / f"{stems[f]}.png").exists()]
        kf = [f for f in kf if f not in dropped]
        if dropped:
            print(f"warning: {len(dropped)} keyframes have no S2 mask and are skipped", file=sys.stderr)
    c2w_cv = np.array([cams["frames"][f]["c2w"] for f in kf]).reshape(-1, 4, 4) @ CV_FROM_GL
    K = np.array([[I["fx"], 0, I["cx"]], [0, I["fy"], I["cy"]], [0, 0, 1]])
    progress(0)

    import torch
    import torch.nn.functional as F
    from PIL import Image
    from scipy.spatial import cKDTree
    from gsplat import export_splats, rasterization
    from gsplat.strategy import MCMCStrategy
    dev = "cuda"

    # Load keyframes: RGB, keep mask (1 = background), DA3 world depth.
    imgs, keeps, holes, depths, pts, cols = [], [], [], [], [], []
    for j, f in enumerate(kf):
        rgb = np.asarray(Image.open(args.work / "S0" / "frames" / f"{stems[f]}.jpg").convert("RGB"))
        keep = np.ones((H, W), bool)
        if (mask_dir / f"{stems[f]}.png").exists():
            keep = np.asarray(Image.open(mask_dir / f"{stems[f]}.png").convert("L")) < 128
        hole = np.zeros((H, W), bool)
        if (hole_png := args.work / "S4" / "holes" / f"{stems[f]}.png").exists():  # E-07: LaMa fill as the target there
            hole = np.asarray(Image.open(hole_png).convert("L")) >= 128
            rgb = np.where(hole[..., None], np.asarray(Image.open(hole_png.with_suffix(".jpg")).convert("RGB")), rgb)
        holes.append(torch.from_numpy(hole))
        d = np.load(args.work / "S3" / "depth" / f"{stems[f]}.npy").astype(np.float32)
        dh, dw = d.shape
        keep_d = np.asarray(Image.fromarray(keep).resize((dw, dh), Image.NEAREST))
        d[d > args.max_dist] = 0
        imgs.append(torch.from_numpy(rgb))
        keeps.append(torch.from_numpy(keep))
        depths.append(torch.from_numpy(np.where(keep_d, d, 0)))
        Kd = K * np.array([[dw / W], [dh / H], [1]])
        p, v, u = backproject(d, Kd, c2w_cv[j], keep_d, stride=2)
        pts.append(p)
        cols.append(np.asarray(Image.fromarray(rgb).resize((dw, dh)))[v, u])
    pts, cols = np.concatenate(pts), np.concatenate(cols)
    sel = np.random.default_rng(0).choice(len(pts), min(args.init, len(pts)), replace=False)
    pts, cols = pts[sel], cols[sel] / 255.0
    lo, hi = np.percentile(pts, 0.5, 0), np.percentile(pts, 99.5, 0)
    box = (lo - 0.1 * (hi - lo), hi + 0.1 * (hi - lo))
    cam_centers = c2w_cv[:, :3, 3]
    scene_scale = 1.1 * max(1.0, np.linalg.norm(cam_centers - cam_centers.mean(0), axis=1).max())
    print(f"{len(kf)} keyframes, {len(pts)} init points, scene scale {scene_scale:.2f}", file=sys.stderr)

    imgs = torch.stack(imgs).to(dev)  # uint8 (N,H,W,3)
    keeps = torch.stack(keeps).to(dev)
    holes = torch.stack(holes).to(dev)
    depths = torch.stack(depths).to(dev)
    viewmats = torch.from_numpy(np.linalg.inv(c2w_cv)).float().to(dev)
    Kt = torch.from_numpy(K).float().to(dev)[None]

    # Gaussians (MCMC init: opacity 0.5, scale 0.1 x mean distance to 3 nearest neighbours).
    nn_d = cKDTree(pts).query(pts, k=4)[0][:, 1:].mean(1)
    n = len(pts)
    C0 = 0.28209479177387814  # SH band 0
    params = torch.nn.ParameterDict({
        "means": torch.from_numpy(pts).float(),
        "scales": torch.log(torch.from_numpy(np.maximum(nn_d, 1e-4) * 0.1)).float()[:, None].repeat(1, 3),
        "quats": F.normalize(torch.randn(n, 4), dim=-1),
        "opacities": torch.logit(torch.full((n,), 0.5)),
        "sh0": ((torch.from_numpy(cols).float() - 0.5) / C0)[:, None, :],
        "shN": torch.zeros(n, (args.sh_degree + 1) ** 2 - 1, 3),
    }).to(dev)
    lrs = {"means": 1.6e-4 * scene_scale, "scales": 5e-3, "quats": 1e-3, "opacities": 5e-2, "sh0": 2.5e-3, "shN": 2.5e-3 / 20}
    opts = {k: torch.optim.Adam([{"params": params[k], "lr": lr, "name": k}], eps=1e-15) for k, lr in lrs.items()}
    means_sched = torch.optim.lr_scheduler.ExponentialLR(opts["means"], gamma=0.01 ** (1.0 / args.steps))
    strategy = MCMCStrategy(cap_max=args.cap, refine_stop_iter=int(args.steps * 0.85))
    strategy.check_sanity(params, opts)
    state = strategy.initialize_state()
    progress(5)

    t0, psnrs = time.time(), []
    rng = np.random.default_rng(0)
    for step in range(args.steps):
        j = int(rng.integers(len(kf)))
        gt = imgs[j].float()[None] / 255
        keep = keeps[j][None, ..., None].float()
        hole = holes[j][None, ..., None].float()
        render, alpha, info = rasterization(
            params["means"], F.normalize(params["quats"], dim=-1), torch.exp(params["scales"]),
            torch.sigmoid(params["opacities"]), torch.cat([params["sh0"], params["shN"]], 1),
            viewmats[j:j + 1], Kt, W, H, sh_degree=min(step // 1000, args.sh_degree), render_mode="RGB+ED", packed=False,
            # Random background: any see-through gap shows a random colour and is penalized, so the splat has to be
            # opaque everywhere the frame has content. With a black background, dark mist got faked by dark floaters.
            backgrounds=torch.rand(1, 3, device=dev))
        rgb = render[..., :3] * keep + gt * (1 - keep)  # movers: no error, no gradient
        # Holes (inside the mask): w*render + (1-w)*LaMa, so their error and gradient are scaled by hole_weight.
        rgb = rgb + hole * args.hole_weight * (render[..., :3] - gt)
        l1 = (rgb - gt).abs().mean()
        ssim = ssim_map(rgb.permute(0, 3, 1, 2), gt.permute(0, 3, 1, 2)).mean()
        loss = 0.8 * l1 + 0.2 * (1 - ssim)
        # Depth: rendered expected depth at DA3 resolution vs DA3, relative L1 where DA3 is valid (movers already 0).
        dgt = depths[j]
        dr = F.interpolate(render[..., 3:4].permute(0, 3, 1, 2), size=dgt.shape, mode="area")[0, 0]
        valid = dgt > 0
        if valid.any():
            loss = loss + args.depth_weight * ((dr[valid] - dgt[valid]).abs() / dgt[valid]).mean()
        loss = loss + 0.01 * torch.sigmoid(params["opacities"]).mean() + 0.01 * torch.exp(params["scales"]).mean()
        loss.backward()
        for o in opts.values():
            o.step()
            o.zero_grad(set_to_none=True)
        means_sched.step()
        strategy.step_post_backward(params, opts, state, step, info, lr=means_sched.get_last_lr()[0])
        if step >= args.steps - 500:
            with torch.no_grad():
                mse = (((rgb - gt) ** 2).sum() / (keep.sum() * 3)).item()
                psnrs.append(-10 * math.log10(max(mse, 1e-10)))
        if step % max(1, args.steps // 100) == 0 and step:
            el = time.time() - t0
            progress(5 + 90 * step / args.steps, el / step * (args.steps - step))

    with torch.no_grad():
        m = params["means"]
        inside = ((m >= torch.tensor(box[0], device=dev)) & (m <= torch.tensor(box[1], device=dev))).all(1)
        out.mkdir(parents=True, exist_ok=True)
        export_splats(m[inside], params["scales"][inside], params["quats"][inside], params["opacities"][inside],
                      params["sh0"][inside], params["shN"][inside], format="ply", save_to=str(out / "world.ply"))
    stats = {"steps": args.steps, "seconds": round(time.time() - t0), "splats": int(inside.sum()),
             "psnr": round(float(np.mean(psnrs)), 2) if psnrs else None, "box": [box[0].tolist(), box[1].tolist()]}
    (out / "train.json").write_text(json.dumps(stats, indent=1))
    print(f"S4: {stats}", file=sys.stderr)
    progress(100, 0)


if __name__ == "__main__":
    main()
