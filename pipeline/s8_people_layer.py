"""S8 People layer (PRD §7.2 S8, §8.4 holo; ticket A-08 / KAN-43).

Metric Video Depth Anything per frame -> holo.mp4 (top: RGB, bottom: mover inverse depth) + holo.json.
  in : work/<id>/S0/frames/*.jpg          (K-01)
       work/<id>/S2/masks/o*/<frame>.png  (A-01, undilated per-instance masks)
       work/<id>/S3/depth/<frame>.npy     (optional, E-02/E-03: keyframe depth in world metres) -> global scale fit
  out: work/<id>/S8/holo.mp4  (W x 2H, e.g. 1280x1440)
       work/<id>/S8/holo.json {frames: [[near, far], ...] metres per frame, depthScale, fps}
Run in the `depth` env:  python pipeline/s8_people_layer.py --work work/<youtubeId>
Needs a Video-Depth-Anything clone (--vda-repo or $VDA_REPO) with checkpoints/metric_video_depth_anything_vits.pth.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

STAGE = "S8"
MIN_DEPTH = 0.05  # metres; VDA can output 0
VDA_CONFIGS = {
    "vits": {"encoder": "vits", "features": 64, "out_channels": [48, 96, 192, 384]},
    "vitb": {"encoder": "vitb", "features": 128, "out_channels": [96, 192, 384, 768]},
    "vitl": {"encoder": "vitl", "features": 256, "out_channels": [256, 512, 1024, 1024]},
}


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def mover_mask(mask_dirs, stem, shape):
    """Union of all S2 instance masks for one frame (bool HxW)."""
    m = np.zeros(shape, bool)
    for d in mask_dirs:
        p = d / f"{stem}.png"
        if p.exists():
            m |= np.array(Image.open(p)) > 127
    return m


def encode_inv_depth(depth, mask):
    """Depth (metres) + mover mask -> (uint8 HxW, [near, far]). Movers map to 16..255 by inverse depth, rest 0.

    Decode (A-10): inv = 1/far + (v - 16) / 239 * (1/near - 1/far); discard v < 8.
    """
    if not mask.any():
        return np.zeros(depth.shape, np.uint8), [0.0, 0.0]
    d = np.maximum(depth, MIN_DEPTH)
    near, far = float(d[mask].min()), float(d[mask].max())
    far = max(far, near + 1e-3)
    t = (1 / d - 1 / far) / (1 / near - 1 / far)
    v = np.where(mask, np.rint(16 + 239 * np.clip(t, 0, 1)), 0).astype(np.uint8)
    return v, [round(near, 4), round(far, 4)]


def fit_scale(depths, ref_depths, masks):
    """Global scale so VDA metric depth matches DA3 world depth on background pixels of the keyframes.

    ref_depths: {frame index: HxW metres}. Returns 1.0 when there's nothing to fit.
    shortcut: scale only (no shift) since both are metric; upgrade to scale+shift if people float/sink in A-10.
    """
    ratios = []
    for i, ref in ref_depths.items():
        ok = (ref > 0) & (depths[i] > MIN_DEPTH) & ~masks[i]
        if ok.sum() > 100:
            ratios.append(np.median(ref[ok] / depths[i][ok]))
    return float(np.median(ratios)) if ratios else 1.0


def load_ref_depths(ref_dir, stems, size):
    refs = {}
    for i, s in enumerate(stems):
        p = ref_dir / f"{s}.npy"
        if p.exists():
            r = np.load(p).astype(np.float32)
            if r.shape != (size[1], size[0]):
                r = np.array(Image.fromarray(r).resize(size, Image.NEAREST))
            refs[i] = r
    return refs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--vda-repo", type=Path, default=Path(os.environ.get("VDA_REPO", "/data/src/Video-Depth-Anything")))
    ap.add_argument("--encoder", default="vits", choices=VDA_CONFIGS)
    ap.add_argument("--ref-depth", type=Path, help="default: <work>/S3/depth")
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = args.work / "S8"
    if (out / "holo.json").exists() and not args.force:
        progress(100)
        return

    frame_paths = sorted((args.work / "S0" / "frames").glob("*.jpg"))
    if not frame_paths:
        sys.exit(f"no frames in {args.work / 'S0' / 'frames'}")
    stems = [p.stem for p in frame_paths]
    frames = np.stack([np.array(Image.open(p).convert("RGB")) for p in frame_paths])
    n, h, w, _ = frames.shape
    mask_dirs = sorted((args.work / "S2" / "masks").glob("o*"))
    masks = [mover_mask(mask_dirs, s, (h, w)) for s in stems]
    progress(5)

    import torch

    sys.path.insert(0, str(args.vda_repo))
    from video_depth_anything.video_depth import VideoDepthAnything

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = VideoDepthAnything(**VDA_CONFIGS[args.encoder], metric=True)
    ckpt = args.vda_repo / "checkpoints" / f"metric_video_depth_anything_{args.encoder}.pth"
    model.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True), strict=True)
    model = model.to(device).eval()
    t0 = time.time()
    depths, _ = model.infer_video_depth(frames, args.fps, input_size=518, device=device, fp32=device != "cuda")
    progress(70, round(time.time() - t0) // 4)

    ref_dir = args.ref_depth or args.work / "S3" / "depth"
    scale = fit_scale(depths, load_ref_depths(ref_dir, stems, (w, h)), masks)
    depths *= scale

    out.mkdir(parents=True, exist_ok=True)
    enc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{2 * h}",
         "-r", str(args.fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
         "-g", "15", "-bf", "0", "-movflags", "+faststart", str(out / "holo.mp4")],
        stdin=subprocess.PIPE,
    )
    near_far = []
    for i in range(n):
        v, nf = encode_inv_depth(depths[i], masks[i])
        near_far.append(nf)
        enc.stdin.write(np.concatenate([frames[i], np.repeat(v[..., None], 3, axis=2)]).tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit("ffmpeg failed writing holo.mp4")

    (out / "holo.json").write_text(json.dumps({"frames": near_far, "depthScale": round(scale, 4), "fps": args.fps}))
    progress(100, 0)


if __name__ == "__main__":
    main()
