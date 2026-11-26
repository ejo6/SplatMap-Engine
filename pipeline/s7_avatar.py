"""S7 Avatars (PRD §7.2 S7, §8.4; ticket A-06 / KAN-41). One LHM Gaussian avatar per placed person.

LHM's own zero-pose export is run with the person's GVHMR betas. It uses the same SMPLX_NEUTRAL model,
so the Gaussians land exactly in motion.bin's rest space (shaped T-pose, metres, unscaled). LHM keeps one
Gaussian per upsampled SMPL-X vertex, in order, so its per-vertex skinning weights are the skin.
  in : work/<id>/S6/people/p*/person.json, work/<id>/S6/body/<objId>.npz (betas)
       work/<id>/S0/frames + S2/masks/<objId>: identity crops, one per time bin, biggest unclipped mask first
  out: work/<id>/S7/people/p*/avatar.ply   3DGS PLY, splat i = skin row i
       work/<id>/S7/people/p*/skin.bin     Float32 N x 8: 4 joint indices, then 4 weights
Run in the `lhm` env:  python pipeline/s7_avatar.py --work work/<youtubeId>
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

STAGE = "S7"
PAD = 0.1  # identity crop padding as a fraction of the box size
N_CANDIDATES = 8  # identity crops tried per person (one per time bin)


def progress(pct):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": None}), flush=True)


def top4(weights):
    """(N, J) skinning weights -> (N, 8) float32: the 4 strongest joint indices, then their weights summing to 1."""
    idx = np.argsort(-weights, axis=1)[:, :4]
    w = np.take_along_axis(weights, idx, axis=1)
    w = w / w.sum(axis=1, keepdims=True)
    return np.concatenate([idx, w], axis=1).astype("<f4")


def pick_candidates(areas, border, k=N_CANDIDATES):
    """areas/border: {frame: mask px, frame: touches image edge}. Best-area frame from each of k time bins.

    Frames cut off by the image edge are skipped unless a bin has nothing else.
    """
    frames = sorted(areas)
    picks = []
    for chunk in np.array_split(frames, min(k, len(frames))):
        inside = [f for f in chunk if not border[f]] or list(chunk)
        picks.append(int(max(inside, key=lambda f: areas[f])))
    return picks


def crop_person(frame, mask):
    """Crop to the mask's padded bounding box and blank everything outside the mask to white,
    so a bystander's face can never end up in the avatar."""
    from PIL import Image

    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    py, px = int((y1 - y0) * PAD), int((x1 - x0) * PAD)
    y0, y1 = max(0, y0 - py), min(mask.shape[0], y1 + py)
    x0, x1 = max(0, x0 - px), min(mask.shape[1], x1 + px)
    out = np.where(mask[..., None], frame, 255).astype(np.uint8)
    return Image.fromarray(out[y0:y1, x0:x1])


def identity_crops(work, oid, dest):
    """Candidate identity crops of one person, biggest unclipped mask first, written to dest/cand_<frame>.png."""
    from PIL import Image

    stems = [p.stem for p in sorted((work / "S0" / "frames").glob("*.jpg"))]
    track = next(i for i in json.loads((work / "S2" / "tracks.json").read_text())["instances"] if i["id"] == oid)
    mask_dir = work / "S2" / "masks" / oid
    areas, border = {}, {}
    for start, end in track["visible"]:
        for f in range(start, end + 1):
            m = np.array(Image.open(mask_dir / f"{stems[f]}.png")) > 127
            areas[f] = int(m.sum())
            border[f] = bool(m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any())
    paths = []
    for f in sorted(pick_candidates(areas, border), key=lambda f: (border[f], -areas[f])):
        frame = np.array(Image.open(work / "S0" / "frames" / f"{stems[f]}.jpg").convert("RGB"))
        mask = np.array(Image.open(mask_dir / f"{stems[f]}.png")) > 127
        paths.append(dest / f"cand_{stems[f]}.png")
        crop_person(frame, mask).save(paths[-1])
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--lhm-repo", type=Path, default=Path(os.environ.get("LHM_REPO", "/data/src/LHM")))
    ap.add_argument("--model", default="LHM-1B")
    args = ap.parse_args()
    work = args.work.resolve()

    people = sorted((work / "S6" / "people").glob("p*/person.json"))
    if not people:
        sys.exit("need S6/people/p*/person.json (A-04)")
    out = work / "S7" / "people"
    if all((out / p.parent.name / "skin.bin").exists() for p in people) and not args.force:
        progress(100)
        return

    # LHM resolves configs and weights relative to its repo root and reads its options from argv.
    os.chdir(args.lhm_repo)
    sys.path.insert(0, str(args.lhm_repo))
    sys.argv = [sys.argv[0], f"model_name={args.model}"]
    from LHM.runners.infer.human_lrm import HumanLRMInferrer

    lhm = HumanLRMInferrer()
    smplx = lhm.model.renderer.smplx_model
    skin = top4(smplx.skinning_weight.detach().cpu().numpy())

    for n, pj in enumerate(people):
        person = json.loads(pj.read_text())
        oid = person["sourceInstance"]
        pdir = out / person["id"]
        if (pdir / "skin.bin").exists() and not args.force:
            continue  # already built (a rerun after one person failed)
        pdir.mkdir(parents=True, exist_ok=True)
        betas = np.zeros(smplx.smpl_x.shape_param_dim, np.float32)
        b = np.load(work / "S6" / "body" / f"{oid}.npz")["betas"].reshape(-1)
        betas[: len(b)] = b
        # LHM asserts the person is taller than wide (sitting, lying or edge-clipped crops fail): try the next crop.
        for image in identity_crops(work, oid, pdir):
            try:
                lhm.infer_mesh(str(image), dump_tmp_dir=str(pdir), dump_mesh_dir=str(pdir), shape_param=betas)
                break
            except AssertionError:
                print(f"S7: {person['id']} rejected {Path(image).name} (wider than tall)", file=sys.stderr)
        else:
            print(f"S7: skip {person['id']}: no usable identity crop", file=sys.stderr)
            continue
        (pdir / f"{Path(image).stem}.ply").replace(pdir / "avatar.ply")
        skin.tofile(pdir / "skin.bin")
        progress(100 * (n + 1) / len(people))


if __name__ == "__main__":
    main()
