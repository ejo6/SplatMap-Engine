"""S9a package (E-08, PRD §8, FR-11). CPU only.

Assembles the world package from the stage outputs. Optional pieces (S5 bounds, S8 people layer,
S6 people) are included when their stage has run, so a world can be packaged before people exist.

  in : work/<id>/S0/{video.mp4, thumbs.jpg, thumbs.json, ingest.json}, S1/{shots.json, director.json},
       S3/cameras.json, S4/{world.ply, train.json}, S5/* (optional), S6/people/p*/ (optional), S8/holo.* (optional)
  out: <worlds-root>/<id>/v<version>/ (PRD §8.2 layout) with manifest.json
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

STAGE = "S9a"
ROOT = Path(__file__).resolve().parents[1]
BUILD_LOD = os.environ.get("BUILD_LOD", "/workspace/src/spark/rust/target/release/build-lod")
PIPELINE_VERSION = "1"


def progress(pct, eta=None):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": eta}), flush=True)


def fail(detail):
    print(json.dumps({"error": "internal", "detail": detail}), flush=True)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--worlds-root", type=Path, default=ROOT / "worlds")
    ap.add_argument("--creator", default="", help="creator credit (PRD §12)")
    ap.add_argument("--license", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    w, vid = args.work, args.work.name
    out = args.worlds_root / vid / f"v{PIPELINE_VERSION}"
    if (out / "manifest.json").exists() and not args.force:
        progress(100, 0)
        return
    s0 = out / "s0"
    s0.mkdir(parents=True, exist_ok=True)
    progress(0)

    # Splat: Spark LoD .rad (streamed) plus an .spz fallback, written next to the ply. build-lod writes one
    # format per run (with --rad --spz only the last one), and stale outputs from an older ply must not be reused.
    ply = w / "S4/world.ply"
    for fmt in ("rad", "spz"):
        ply.with_name(f"world-lod.{fmt}").unlink(missing_ok=True)
        r = subprocess.run([BUILD_LOD, "--quality", f"--{fmt}", str(ply)], capture_output=True, text=True)
        if r.returncode:
            fail(f"build-lod --{fmt} failed: {r.stderr[-500:]}")
    shutil.copy(ply.with_name("world-lod.rad"), s0 / "world.rad")
    shutil.copy(ply.with_name("world-lod.spz"), s0 / "world.spz")
    progress(70)

    for f in ("video.mp4", "thumbs.jpg", "thumbs.json"):
        shutil.copy(w / "S0" / f, out / f)
    shutil.copy(w / "S3/cameras.json", s0 / "cameras.json")

    shots = json.loads((w / "S1/shots.json").read_text())
    sel = shots["selected"]
    ingest = json.loads((w / "S0/ingest.json").read_text())
    director = json.loads(p.read_text()) if (p := w / "S1/director.json").exists() else {}
    card = director.get("sceneCard") or {}
    shot = {
        "id": "s0", "start": sel["start"], "end": sel["end"], "frameCount": sel["frameCount"],
        "world": {"rad": "s0/world.rad", "spz": "s0/world.spz",
                  "splatCount": json.loads((w / "S4/train.json").read_text())["splats"]},
        "cameras": "s0/cameras.json",
        "people": [],
    }
    qa = {"verdict": "unchecked", "notes": ""}

    if (w / "S5/walk.json").exists():  # E-06
        for f in ("walk.json", "walk_sdf.bin", "coverage.bin"):
            shutil.copy(w / "S5" / f, s0 / f)
        shot["bounds"] = {"walk": "s0/walk.json"}
        if (w / "S5/colliders.glb").exists():  # S5 writes none when it finds no obstacles
            shutil.copy(w / "S5/colliders.glb", s0 / "colliders.glb")
            shot["bounds"]["colliders"] = "s0/colliders.glb"
        qa["fogRadius"] = json.loads((w / "S5/walk.json").read_text())["fog"]["radius"]
    if (w / "S8/holo.json").exists():  # A-08
        shutil.copy(w / "S8/holo.mp4", s0 / "holo.mp4")
        shutil.copy(w / "S8/holo.json", s0 / "holo.json")
        shot["peopleLayer"] = {"video": "s0/holo.mp4", "meta": "s0/holo.json"}
    for pdir in sorted((w / "S6/people").glob("p*")):  # A-04 (+ A-06 avatar files, once S7 writes them there)
        shutil.copytree(pdir, s0 / "people" / pdir.name, dirs_exist_ok=True)
        person = json.loads((pdir / "person.json").read_text())
        shot["people"].append({"id": person["id"], "label": person.get("label", "person"),
                               "person": f"s0/people/{pdir.name}/person.json"})
    progress(90)

    manifest = {
        "schema": 1, "pipelineVersion": PIPELINE_VERSION, "youtubeId": vid,
        "title": card.get("title") or ingest.get("title") or vid,
        "credit": {"creator": args.creator, "license": args.license,
                   "url": f"https://youtube.com/watch?v={vid}" if len(vid) == 11 else ""},
        "sceneCard": " ".join(card.get("sentences", [])),
        "video": {"url": "video.mp4", "fps": shots["fps"], "width": 1280, "height": 720,
                  "duration": ingest["frameCount"] / ingest["fps"], "sourceStart": ingest["sourceStart"],
                  "thumbs": {"sprite": "thumbs.jpg", "index": "thumbs.json"}},
        "shots": [shot],
        "unreconstructed": shots.get("unreconstructed", []),
        "qa": qa,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    mb = sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) / 1e6
    print(f"S9a: {out} {mb:.0f} MB, {len(shot['people'])} people, "
          f"bounds {'bounds' in shot}, people layer {'peopleLayer' in shot}", file=sys.stderr)
    if mb > 100:
        print(f"S9a: warning: package is {mb:.0f} MB, over the 100 MB budget (NFR-05)", file=sys.stderr)
    progress(100, 0)


if __name__ == "__main__":
    main()
