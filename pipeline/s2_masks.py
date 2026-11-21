"""S2 Masks (PRD §7.2, ticket A-01 / KAN-36).

SAM 3 video segmentation driven by the Gemini director's nouns:
  in : work/<id>/S0/frames/*.jpg           (K-01)
       work/<id>/S1/director.json          (K-03, optional; falls back to prompt "person")
  out: work/<id>/S2/masks/o<objId>/<frame>.png   per-instance mask, only frames where visible
       work/<id>/S2/masks/union/<frame>.png      every frame, all movers, dilated (255 = mover)
       work/<id>/S2/tracks.json                  instance ids, labels, visible ranges, boxes
  <frame> is the source frame's filename stem; frame numbers in tracks.json are 0-based sorted indices.
Run in the `sam3` env:  python pipeline/s2_masks.py --work work/<youtubeId>
"""

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

# Less fragmentation on long clips with many objects (KAN-76). Must be set before CUDA initialises.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

STAGE = "S2"
MODEL_ID = "facebook/sam3"


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def load_prompts(director_path):
    """Return {noun: kind}. Expects director.json `subjects: [{noun, kind}]`; kind is person|animal|vehicle."""
    if director_path.exists():
        subjects = json.loads(director_path.read_text()).get("subjects", [])
        prompts = {s["noun"]: s.get("kind", "person") for s in subjects if s.get("noun")}
        if prompts:
            return prompts
    return {"person": "person"}  # PRD §7.3 fallback


def to_ranges(frames):
    """Sorted frame indices -> inclusive [[start, end], ...] runs."""
    ranges = []
    for f in frames:
        if ranges and f == ranges[-1][1] + 1:
            ranges[-1][1] = f
        else:
            ranges.append([f, f])
    return ranges


def dilate(mask, px):
    """Bool HxW tensor grown by px pixels (square kernel)."""
    if px <= 0:
        return mask
    return F.max_pool2d(mask[None, None].float(), 2 * px + 1, stride=1, padding=px)[0, 0] > 0


def save_mask(mask, path):
    Image.fromarray(mask.cpu().numpy().astype(np.uint8) * 255).save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--dilate", type=int, default=15, help="union mask dilation in px (PRD: 10-20)")
    ap.add_argument("--min-frames", type=int, default=10, help="drop instances visible fewer frames (still in union)")
    ap.add_argument("--max-objects", type=int, default=20,
                    help="cap on tracked objects; SAM 3 keeps the highest-scoring detections (KAN-76: crowds OOM)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = args.work / "S2"
    if (out / "tracks.json").exists() and not args.force:
        progress(100)
        return

    frame_paths = sorted((args.work / "S0" / "frames").glob("*.jpg"))
    if not frame_paths:
        sys.exit(f"no frames in {args.work / 'S0' / 'frames'}")
    frames = [Image.open(p).convert("RGB") for p in frame_paths]
    width, height = frames[0].size
    prompts = load_prompts(args.work / "S1" / "director.json")

    from transformers import Sam3VideoModel, Sam3VideoProcessor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    model = Sam3VideoModel.from_pretrained(MODEL_ID).to(device, dtype=dtype)
    # Default is 10000 (no cap): a crowd makes the per-frame N x N mask IoU and tracker state blow GPU memory.
    model.max_num_objects = args.max_objects
    processor = Sam3VideoProcessor.from_pretrained(MODEL_ID)
    # Frames live on CPU so a 60 s clip doesn't fill GPU memory.
    session = processor.init_video_session(
        video=frames, inference_device=device, processing_device="cpu", video_storage_device="cpu", dtype=dtype
    )
    session = processor.add_text_prompt(inference_session=session, text=list(prompts))
    del frames

    if out.exists():
        shutil.rmtree(out)
    union_dir = out / "masks" / "union"
    union_dir.mkdir(parents=True)

    tracks = {}  # objId -> {prompt, frames, boxes, scores}
    n, t0 = len(frame_paths), time.time()
    with torch.inference_mode():
        for i, mo in enumerate(model.propagate_in_video_iterator(inference_session=session)):
            o = processor.postprocess_outputs(session, mo)
            f = mo.frame_idx
            png = frame_paths[f].stem + ".png"  # same name as the source frame, whatever S0's numbering
            prompt_of = {oid: p for p, ids in o["prompt_to_obj_ids"].items() for oid in ids}
            masks = o["masks"]
            union = masks.any(0) if len(masks) else torch.zeros(height, width, dtype=torch.bool)
            save_mask(dilate(union.to(device), args.dilate), union_dir / png)
            for oid, m, box, score in zip(o["object_ids"].tolist(), masks, o["boxes"].tolist(), o["scores"].tolist()):
                t = tracks.setdefault(oid, {"prompt": prompt_of.get(oid), "frames": [], "boxes": [], "scores": []})
                t["frames"].append(f)
                t["boxes"].append([f] + [round(v, 1) for v in box])
                t["scores"].append(score)
                inst_dir = out / "masks" / f"o{oid}"
                inst_dir.mkdir(exist_ok=True)
                save_mask(m, inst_dir / png)
            if i % 30 == 0:
                done = i + 1
                progress(100 * done / n, round((time.time() - t0) / done * (n - done)))

    instances = []
    for oid, t in sorted(tracks.items()):
        if len(t["frames"]) < args.min_frames:  # flicker/false positive; union already covers it
            shutil.rmtree(out / "masks" / f"o{oid}")
            continue
        instances.append({
            "id": f"o{oid}",
            "prompt": t["prompt"],
            "label": "person" if prompts.get(t["prompt"]) == "person" else "other",
            "visible": to_ranges(sorted(t["frames"])),
            "boxes": t["boxes"],  # [frame, x0, y0, x1, y1] in video pixels
            "meanScore": round(float(np.mean(t["scores"])), 3),
        })
    (out / "tracks.json").write_text(json.dumps({
        "width": width, "height": height, "frameCount": n,
        "dilatePx": args.dilate, "maxObjects": args.max_objects, "prompts": prompts, "instances": instances,
    }))
    progress(100, 0)


if __name__ == "__main__":
    main()
