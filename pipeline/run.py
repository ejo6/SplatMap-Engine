"""Pipeline runner (E-01, PRD §7.2, FR-09).

    python pipeline/run.py --youtube-id <id> [--stages S0..S9] [--window a,b] [--force]

Runs each stage script in its own conda env as a subprocess. A stage is skipped when
work/<id>/.done/<stage>.json exists and its input hash still matches (the hash covers the
stage's args and the done records of the stages it depends on, so re-running a stage
makes everything downstream re-run). Progress is JSON lines on stdout; anything else a
stage prints goes to stderr. On failure the last line is {"stage","error","detail"} and the
exit code is 1. See docs/pipeline-runner.md.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "pipeline"
ENVS_DIR = Path(os.environ.get("ENVS_DIR", "/workspace/envs"))

# name, script, conda env, deps, error enum (PRD §9) used when the stage doesn't name one.
STAGES = [
    ("S0", "s0_ingest.py", "ingest", [], "download_blocked"),
    ("S1a", "s1_shots.py", "ingest", ["S0"], "no_usable_shot"),
    ("S1b", "s1_director.py", "ingest", ["S1a"], "no_usable_shot"),
    ("S2", "s2_masks.py", "sam3", ["S0", "S1b"], "people_failed"),
    ("S3", "s3_cameras.py", "recon", ["S0"], "reconstruction_failed"),
    ("S3b", "s3b_world.py", "recon", ["S3"], "reconstruction_failed"),
    ("S4", "s4_background.py", "recon", ["S2", "S3b"], "reconstruction_failed"),
    ("S5", "s5_bounds.py", "recon", ["S4"], "reconstruction_failed"),
    ("S6a", "s6_body.py", "people", ["S2", "S3b"], "people_failed"),
    ("S6b", "s6_place.py", "people", ["S6a"], "people_failed"),
    ("S7a", "s7_identity.py", "ingest", ["S2"], "people_failed"),
    ("S7", "s7_avatar.py", "lhm", ["S7a"], "people_failed"),
    ("S8", "s8_people_layer.py", "depth", ["S2", "S3b"], "people_failed"),
    ("S9a", "s9_package.py", "recon", ["S5", "S6b", "S7", "S8"], "internal"),
    ("S9b", "s9_qa.py", "ingest", ["S9a"], "qa_rejected"),
]
ERRORS = {"invalid_url", "video_unavailable", "download_blocked", "no_usable_shot",
          "reconstruction_failed", "people_failed", "qa_rejected", "internal"}


def emit(**event):
    print(json.dumps(event), flush=True)


def select(spec):
    """'S0..S9' (inclusive range) or 'S2,S8'. A name matches its substages: S3 -> S3, S3b."""
    names = [s[0] for s in STAGES]
    match = lambda p: [i for i, n in enumerate(names) if n == p or (n.startswith(p) and n[len(p)].isalpha())]
    if ".." in spec:
        a, b = spec.split("..")
        return names[match(a)[0]:match(b)[-1] + 1]
    return [names[i] for p in spec.split(",") for i in match(p)]


def python_for(env):
    exe = ENVS_DIR / env / "bin" / "python"
    return str(exe) if exe.exists() else sys.executable  # local dev: no conda envs


def input_hash(args, deps, done_dir):
    """Hash of the stage's args plus the done records of its deps (missing dep -> None)."""
    upstream = {d: (json.loads(p.read_text())["finished"] if (p := done_dir / f"{d}.json").exists() else None)
                for d in deps}
    return hashlib.sha256(json.dumps([args, upstream], sort_keys=True).encode()).hexdigest()[:16]


def run_stage(name, cmd):
    """Run one stage, forward its progress lines. Returns (error, detail) or None on success."""
    tail = deque(maxlen=20)
    error = detail = None
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in proc.stdout:
        try:
            event = json.loads(line)
        except ValueError:
            event = None
        if isinstance(event, dict) and "error" in event:
            error = event["error"] if event["error"] in ERRORS else "internal"
            detail = event.get("detail")
        elif isinstance(event, dict) and "pct" in event:
            emit(stage=name, pct=event["pct"], eta=event.get("eta"))
        else:
            sys.stderr.write(line)
            tail.append(line.rstrip())
    if proc.wait() == 0 and not error:
        return None
    return error, detail or "\n".join(t for t in tail if t)[-2000:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--youtube-id", required=True)
    ap.add_argument("--stages", default="S0..S9")
    ap.add_argument("--window", help="a,b in seconds (S0)")
    ap.add_argument("--force", action="store_true", help="re-run the selected stages even if done")
    ap.add_argument("--work-root", type=Path, default=ROOT / "work")
    args = ap.parse_args()

    work = args.work_root / args.youtube_id
    done_dir = work / ".done"
    done_dir.mkdir(parents=True, exist_ok=True)
    table = {s[0]: s for s in STAGES}

    for name in select(args.stages):
        _, script, env, deps, default_error = table[name]
        stage_args = []
        if name == "S0":
            stage_args = ["--youtube-id", args.youtube_id] + (["--window", args.window] if args.window else [])
        h = input_hash(stage_args, deps, done_dir)
        done = done_dir / f"{name}.json"
        prev = json.loads(done.read_text()) if done.exists() else None
        if prev and prev["inputs"] == h and not args.force:
            emit(stage=name, pct=100, eta=0, skipped=True)
            continue

        script_path = PIPELINE / script
        if not script_path.exists():
            emit(stage=name, error="internal", detail=f"{script} not written yet")
            sys.exit(1)
        # Stages skip themselves when their outputs exist; force them when we know inputs changed.
        force = ["--force"] if prev or args.force else []
        cmd = [python_for(env), str(script_path), "--work", str(work), *stage_args, *force]
        emit(stage=name, pct=0, eta=None)
        t0 = time.time()
        failed = run_stage(name, cmd)
        if failed:
            error, detail = failed
            done.unlink(missing_ok=True)
            emit(stage=name, error=error or default_error, detail=detail)
            sys.exit(1)
        done.write_text(json.dumps({"inputs": h, "finished": time.time(), "seconds": round(time.time() - t0, 1)}))
        emit(stage=name, pct=100, eta=0)


if __name__ == "__main__":
    main()
