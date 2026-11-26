"""Pipeline runner: one command from a video file to a packaged world. See docs/pipeline-runner.md.

    python pipeline/run.py --video clip.mp4 [--id NAME] [--window a,b] [--preset fast|quality]
                           [--set S4.steps=50000 ...] [--no-people] [--stages S0..S9] [--force]

Runs each stage script in its own conda env as a subprocess. A stage is skipped when
work/<id>/.done/<stage>.json exists and its input hash still matches (the hash covers the
stage's args and the done records of the stages it depends on, so changing a stage's settings
re-runs it and everything downstream). Progress is JSON lines on stdout; anything else a
stage prints goes to stderr. On failure the last line is {"stage","error","detail"} and the
exit code is 1. On success work/<id>/run.json records the settings, commit, times and QA scores.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import tomllib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "pipeline"
PRESETS = ROOT / "config" / "pipeline.toml"
ENVS_DIR = Path(os.environ.get("ENVS_DIR", "/workspace/envs"))

# name, script, conda env, deps, error enum (PRD §9) used when the stage doesn't name one.
STAGES = [
    ("S0", "s0_ingest.py", "recon", [], "video_unavailable"),
    ("S2", "s2_masks.py", "sam3", ["S0"], "people_failed"),
    ("S3", "s3_cameras.py", "recon", ["S0"], "reconstruction_failed"),
    ("S3b", "s3b_world.py", "recon", ["S3"], "reconstruction_failed"),
    ("S4a", "s4a_holes.py", "recon", ["S2", "S3b"], "reconstruction_failed"),
    ("S4", "s4_background.py", "recon", ["S2", "S3b", "S4a"], "reconstruction_failed"),
    ("S5", "s5_bounds.py", "recon", ["S4"], "reconstruction_failed"),
    ("S6a", "s6_body.py", "people", ["S2", "S3b"], "people_failed"),
    ("S6b", "s6_place.py", "people", ["S6a"], "people_failed"),
    ("S7", "s7_avatar.py", "lhm", ["S6b"], "people_failed"),
    ("S8", "s8_people_layer.py", "depth", ["S2", "S3b"], "people_failed"),
    ("S9a", "s9_package.py", "recon", ["S5", "S6b", "S7", "S8"], "internal"),
    ("S9b", "tools/align_check.py", "recon", ["S4"], "internal"),
]
PEOPLE = {"S6a", "S6b", "S7", "S8"}  # left out with --no-people (S2 still erases people from the world)
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


def stage_options(preset, sets):
    """{stage: {flag: value}} from the preset table in config/pipeline.toml, then each --set STAGE.flag=value."""
    opts = {}
    if preset:
        table = tomllib.loads(PRESETS.read_text())
        if preset not in table:
            sys.exit(f"unknown preset {preset!r}; config/pipeline.toml has {sorted(table)}")
        opts = {stage: dict(flags) for stage, flags in table[preset].items()}
    names = {s[0] for s in STAGES}
    for s in sets:
        stage, _, kv = s.partition(".")
        flag, eq, value = kv.partition("=")
        if stage not in names or not flag or not eq:
            sys.exit(f"--set {s!r}: expected STAGE.flag=value with STAGE one of {sorted(names)}")
        opts.setdefault(stage, {})[flag] = value
    return opts


def load_dotenv(path):
    """KEY=VALUE lines (comments and blanks ignored)."""
    if not path.exists():
        return {}
    pairs = (l.split("=", 1) for l in path.read_text().splitlines() if "=" in l and not l.lstrip().startswith("#"))
    return {k.strip(): v.split(" #")[0].strip().strip("\"'") for k, v in pairs}


def stage_env(env):
    """The environment one stage runs in. On the GPU box: /workspace/.env, caches on the volume, and the conda
    cuda-toolkit paths gsplat and LHM need to compile their CUDA code (it keeps headers under targets/)."""
    e = dict(os.environ)
    e.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    e.setdefault("PYTHONUNBUFFERED", "1")
    prefix = ENVS_DIR / env
    if not prefix.exists():
        return e  # local dev: no conda envs
    box = ENVS_DIR.parent
    for k, v in {**load_dotenv(box / ".env"), "HF_HOME": box / "hf", "TORCH_HOME": box / ".cache/torch",
                 "TORCH_EXTENSIONS_DIR": box / ".cache/torch_extensions", "TORCH_CUDA_ARCH_LIST": "8.6;9.0",
                 "IMAGEIO_FFMPEG_EXE": "/usr/bin/ffmpeg"}.items():
        e.setdefault(k, str(v))
    targets = prefix / "targets" / "x86_64-linux"
    if targets.exists():
        e.update(CUDA_HOME=str(prefix), CPATH=str(targets / "include"), LIBRARY_PATH=str(targets / "lib"))
    e["PATH"] = f"{prefix / 'bin'}:{e.get('PATH', '')}"
    return e


def python_for(env):
    exe = ENVS_DIR / env / "bin" / "python"
    return str(exe) if exe.exists() else sys.executable  # local dev: no conda envs


def input_hash(args, deps, done_dir):
    """Hash of the stage's args plus the done records of its deps (missing dep -> None)."""
    upstream = {d: (json.loads(p.read_text())["finished"] if (p := done_dir / f"{d}.json").exists() else None)
                for d in deps}
    return hashlib.sha256(json.dumps([args, upstream], sort_keys=True).encode()).hexdigest()[:16]


def run_stage(name, cmd, env):
    """Run one stage, forward its progress lines. Returns (error, detail) or None on success."""
    tail = deque(maxlen=20)
    error = detail = None
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
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
    code = proc.wait()
    if code == 0 and not error:
        return None
    return error, detail or "\n".join(t for t in tail if t)[-2000:] or f"exit code {code}"


def commit():
    """Git commit of this checkout, or $PIPELINE_COMMIT (remote.sh sets it: the box copy isn't a checkout)."""
    r = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else os.environ.get("PIPELINE_COMMIT")


def main():
    ap = argparse.ArgumentParser(description="Video file -> world package. Stages: " + " ".join(s[0] for s in STAGES))
    ap.add_argument("--video", type=Path, help="local video, one continuous shot (needed until S0 has run)")
    ap.add_argument("--id", help="world id = work/<id> and worlds/<id> (default: the video's file name)")
    ap.add_argument("--window", help="a,b seconds into the video (S0; default the first 60 s)")
    ap.add_argument("--preset", help="settings table in config/pipeline.toml, e.g. fast or quality")
    ap.add_argument("--set", action="append", default=[], metavar="STAGE.flag=value",
                    help="pass --flag value to one stage, e.g. S4.steps=50000 or S2.prompts=person,dog (repeatable)")
    ap.add_argument("--no-people", action="store_true", help="skip S6-S8: no avatars or people layer")
    ap.add_argument("--stages", default="S0..S9")
    ap.add_argument("--force", action="store_true", help="re-run the selected stages even if done")
    ap.add_argument("--work-root", type=Path, default=ROOT / "work")
    args = ap.parse_args()
    if not (args.id or args.video):
        ap.error("give --video (and optionally --id), or --id of a clip already ingested")
    vid = args.id or args.video.stem

    work = args.work_root / vid
    done_dir = work / ".done"
    done_dir.mkdir(parents=True, exist_ok=True)
    table = {s[0]: s for s in STAGES}
    options = stage_options(args.preset, args.set)
    report = {"id": vid, "commit": commit(), "preset": args.preset, "set": args.set, "stages": {}}

    for name in select(args.stages):
        if args.no_people and name in PEOPLE:
            continue
        _, script, env, deps, default_error = table[name]
        done = done_dir / f"{name}.json"
        prev = json.loads(done.read_text()) if done.exists() else None
        stage_args = []
        if name == "S0":
            if not args.video:  # re-running later stages of a clip that's already ingested
                if not prev:
                    emit(stage=name, error="video_unavailable", detail="S0 has not run: pass --video")
                    sys.exit(1)
                emit(stage=name, pct=100, eta=0, skipped=True)
                continue
            stage_args = ["--video", str(args.video.resolve())] + (["--window", args.window] if args.window else [])
        for flag, value in options.get(name, {}).items():
            stage_args += [f"--{flag}", str(value)]
        h = input_hash(stage_args, deps, done_dir)
        report["stages"][name] = {"args": stage_args}
        if prev and prev["inputs"] == h and not args.force:
            emit(stage=name, pct=100, eta=0, skipped=True)
            report["stages"][name].update(skipped=True, seconds=prev["seconds"])
            continue

        script_path = PIPELINE / script
        # Stages skip themselves when their outputs exist; force them when we know inputs changed.
        force = ["--force"] if prev or args.force else []
        cmd = [python_for(env), str(script_path), "--work", str(work), *stage_args, *force]
        emit(stage=name, pct=0, eta=None)
        t0 = time.time()
        failed = run_stage(name, cmd, stage_env(env))
        if failed:
            error, detail = failed
            done.unlink(missing_ok=True)
            emit(stage=name, error=error or default_error, detail=detail)
            sys.exit(1)
        seconds = round(time.time() - t0, 1)
        done.write_text(json.dumps({"inputs": h, "finished": time.time(), "seconds": seconds}))
        report["stages"][name]["seconds"] = seconds
        emit(stage=name, pct=100, eta=0)

    if (qa := work / "qa" / "align.json").exists():
        a = json.loads(qa.read_text())
        report["qa"] = {"psnr": a["psnr"], "ssim": a["ssim"]}
    (work / "run.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
