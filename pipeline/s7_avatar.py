"""S7 Avatars (PRD §7.2 S7, §8.4; ticket A-06 / KAN-41). One LHM Gaussian avatar per placed person.

LHM's own zero-pose export is run with the person's GVHMR betas. It uses the same SMPLX_NEUTRAL model,
so the Gaussians land exactly in motion.bin's rest space (shaped T-pose, metres, unscaled). LHM keeps one
Gaussian per upsampled SMPL-X vertex, in order, so its per-vertex skinning weights are the skin.
  in : work/<id>/S6/people/p*/person.json, work/<id>/S6/body/<objId>.npz (betas)
       work/<id>/S7/identity/<objId>/best.png (S7a), else the largest unclipped mask frame
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
PAD = 0.1  # identity crop padding as a fraction of the box size (same as S7a)


def progress(pct):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": None}), flush=True)


def top4(weights):
    """(N, J) skinning weights -> (N, 8) float32: the 4 strongest joint indices, then their weights summing to 1."""
    idx = np.argsort(-weights, axis=1)[:, :4]
    w = np.take_along_axis(weights, idx, axis=1)
    w = w / w.sum(axis=1, keepdims=True)
    return np.concatenate([idx, w], axis=1).astype("<f4")


def identity_image(work, oid, dest):
    """S7a's pick if it ran; otherwise its fallback rule: the largest mask not cut off by the frame edge."""
    best = work / "S7" / "identity" / oid / "best.png"
    if best.exists():
        return best
    from PIL import Image

    stems = [p.stem for p in sorted((work / "S0" / "frames").glob("*.jpg"))]
    track = next(i for i in json.loads((work / "S2" / "tracks.json").read_text())["instances"] if i["id"] == oid)
    best_f, best_area, best_mask = None, -1, None
    for start, end in track["visible"]:
        for f in range(start, end + 1):
            m = np.array(Image.open(work / "S2" / "masks" / oid / f"{stems[f]}.png")) > 127
            clipped = m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any()
            area = m.sum() / (100 if clipped else 1)  # a clipped mask wins only if nothing else is visible
            if area > best_area:
                best_f, best_area, best_mask = f, area, m
    frame = np.array(Image.open(work / "S0" / "frames" / f"{stems[best_f]}.jpg").convert("RGB"))
    ys, xs = np.nonzero(best_mask)
    py, px = int((ys.max() - ys.min()) * PAD), int((xs.max() - xs.min()) * PAD)
    y0, y1 = max(0, ys.min() - py), min(frame.shape[0], ys.max() + 1 + py)
    x0, x1 = max(0, xs.min() - px), min(frame.shape[1], xs.max() + 1 + px)
    Image.fromarray(np.where(best_mask[..., None], frame, 255).astype(np.uint8)[y0:y1, x0:x1]).save(dest)
    return dest


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
        # LHM asserts the person is taller than wide (sitting, lying or edge-clipped crops fail): try S7a's next picks.
        ranked = work / "S7" / "identity.json"
        ranked = [work / "S7" / c["crop"] for i in json.loads(ranked.read_text())["persons"] if i["id"] == oid
                  for c in i["ranked"]] if ranked.exists() else []
        for image in [identity_image(work, oid, pdir / "identity.png")] + ranked:
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
