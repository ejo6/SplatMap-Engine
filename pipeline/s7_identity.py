"""S7a Identity frames (PRD §7.3, FR-28; ticket A-05 / KAN-40).

For each tracked person, pick the clearest front-facing, unoccluded frames to build their avatar from.
Crops are cut from that person's own mask (pixels outside it are blanked), so a bystander's face can't be picked.
Gemini ranks the candidates; the fallback ranks by mask area.
  in : work/<id>/S0/frames/*.jpg, work/<id>/S2/tracks.json, work/<id>/S2/masks/o<objId>/<frame>.png
  out: work/<id>/S7/identity/<objId>/cand_<frame>.png   candidate crops (kept for review)
       work/<id>/S7/identity/<objId>/best.png           top-ranked crop
       work/<id>/S7/identity.json
Run in an env with pipeline/requirements-gemini.txt + pillow + numpy:
  python pipeline/s7_identity.py --work work/<youtubeId>
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pydantic import BaseModel

from gemini_client import generate_json

STAGE = "S7a"
N_CANDIDATES = 8
PAD = 0.1  # crop padding as a fraction of the box size
PROMPT = (
    "Each image is a crop of the SAME person from one video; everything outside the person is blanked white. "
    "Rank the images from best to worst as the reference photo for building a 3D avatar of this person: "
    "prefer a clear front-facing view, face visible, full body in frame, not occluded, not motion-blurred. "
    "Images are numbered 0..{n} in the order given. Return every index exactly once in `ranking`."
)


class Ranking(BaseModel):
    ranking: list[int]
    reason: str


def progress(pct):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": None}), flush=True)


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


def valid_ranking(ranking, n):
    return sorted(ranking) == list(range(n))


def crop_person(frame, mask):
    """Crop to the mask's padded bounding box and blank everything outside the mask to white."""
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    py, px = int((y1 - y0) * PAD), int((x1 - x0) * PAD)
    y0, y1 = max(0, y0 - py), min(mask.shape[0], y1 + py)
    x0, x1 = max(0, x0 - px), min(mask.shape[1], x1 + px)
    out = np.where(mask[..., None], frame, 255).astype(np.uint8)
    return Image.fromarray(out[y0:y1, x0:x1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out_json = args.work / "S7" / "identity.json"
    if out_json.exists() and not args.force:
        progress(100)
        return

    stems = [p.stem for p in sorted((args.work / "S0" / "frames").glob("*.jpg"))]
    tracks = json.loads((args.work / "S2" / "tracks.json").read_text())
    people = [i for i in tracks["instances"] if i["label"] == "person"]
    if not people:
        sys.exit("no people in S2/tracks.json")
    out_dir = args.work / "S7" / "identity"
    if out_dir.exists():
        shutil.rmtree(out_dir)

    results = []
    for n_done, person in enumerate(people):
        mask_dir = args.work / "S2" / "masks" / person["id"]
        areas, border = {}, {}
        for start, end in person["visible"]:
            for f in range(start, end + 1):
                m = np.array(Image.open(mask_dir / f"{stems[f]}.png")) > 127
                areas[f] = int(m.sum())
                border[f] = bool(m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any())
        cands = pick_candidates(areas, border)

        pdir = out_dir / person["id"]
        pdir.mkdir(parents=True)
        paths = []
        for f in cands:
            frame = np.array(Image.open(args.work / "S0" / "frames" / f"{stems[f]}.jpg").convert("RGB"))
            mask = np.array(Image.open(mask_dir / f"{stems[f]}.png")) > 127
            p = pdir / f"cand_{stems[f]}.png"
            crop_person(frame, mask).save(p)
            paths.append(p)

        r = generate_json(PROMPT.format(n=len(cands) - 1), Ranking, fallback=lambda: None, media=paths)
        if r is not None and valid_ranking(r.ranking, len(cands)):
            ranking, source, reason = r.ranking, "gemini", r.reason
        else:  # PRD §7.3 fallback: largest unoccluded mask area
            ranking, source, reason = sorted(range(len(cands)), key=lambda i: -areas[cands[i]]), "fallback", ""

        shutil.copy(paths[ranking[0]], pdir / "best.png")
        results.append({
            "id": person["id"],
            "frame": cands[ranking[0]],
            "ranked": [{"frame": cands[i], "crop": str(paths[i].relative_to(args.work / "S7"))} for i in ranking],
            "source": source,
            "reason": reason,
        })
        progress(100 * (n_done + 1) / len(people))

    out_json.write_text(json.dumps({"persons": results}, indent=1))


if __name__ == "__main__":
    main()
