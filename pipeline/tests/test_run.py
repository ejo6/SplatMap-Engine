import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run  # noqa: E402

# Dummy stage: counts its runs, prints progress and some noise, fails if FAIL is in its args.
DUMMY = """
import json, sys
from pathlib import Path
work = Path(sys.argv[sys.argv.index("--work") + 1])
work.mkdir(parents=True, exist_ok=True)
with open(work / "runs.txt", "a") as f:
    f.write("{name} " + " ".join(sys.argv[2:]) + "\\n")
print("loading model...")
print(json.dumps({{"stage": "{name}", "pct": 50, "eta": 1}}), flush=True)
if "FAIL" in sys.argv:
    print(json.dumps({{"error": "video_unavailable", "detail": "unreadable video"}}))
    sys.exit(1)
"""


@pytest.fixture
def pipe(tmp_path, monkeypatch):
    for name in ("A", "B", "C"):
        (tmp_path / f"{name.lower()}.py").write_text(DUMMY.format(name=name))
    (tmp_path / "clip.mp4").write_bytes(b"")
    (tmp_path / "presets.toml").write_text('[fast]\nS2 = { steps = 7000, mode = "x" }\n')
    monkeypatch.setattr(run, "PIPELINE", tmp_path)
    monkeypatch.setattr(run, "PRESETS", tmp_path / "presets.toml")
    monkeypatch.setattr(run, "STAGES", [("S0", "a.py", "x", [], "video_unavailable"),
                                        ("S2", "b.py", "x", ["S0"], "people_failed"),
                                        ("S6a", "c.py", "x", ["S2"], "people_failed")])

    def go(capsys, *extra, video=True):
        monkeypatch.setattr(sys, "argv", ["run.py", "--id", "vid", "--work-root", str(tmp_path / "work"),
                                          "--stages", "S0..S6a",
                                          *(["--video", str(tmp_path / "clip.mp4")] if video else []), *extra])
        code = 0
        try:
            run.main()
        except SystemExit as e:
            code = e.code
        events = [json.loads(l) for l in capsys.readouterr().out.splitlines()]
        log = tmp_path / "work" / "vid" / "runs.txt"
        runs = log.read_text().splitlines() if log.exists() else []
        return code, events, runs
    return go


def test_progress_skip_and_rerun_on_input_change(pipe, capsys):
    code, events, runs = pipe(capsys)
    assert code == 0 and len(runs) == 3
    assert [(e["stage"], e["pct"]) for e in events[:6]] == [("S0", 0), ("S0", 50), ("S0", 100),
                                                             ("S2", 0), ("S2", 50), ("S2", 100)]
    assert "--video" in runs[0]

    code, events, runs = pipe(capsys)
    assert len(runs) == 3 and all(e.get("skipped") for e in events)  # nothing re-ran

    code, events, runs = pipe(capsys, "--window", "10,70")  # S0 input changed -> everything re-runs
    assert len(runs) == 6 and all("--force" in r for r in runs[3:])

    code, events, runs = pipe(capsys, "--window", "10,70", "--stages", "S2", "--force")
    assert len(runs) == 7 and runs[6].startswith("B")


def test_preset_and_set_reach_only_their_stage_and_rerun_downstream(pipe, capsys):
    pipe(capsys)
    code, events, runs = pipe(capsys, "--preset", "fast", "--set", "S2.steps=9", video=False)
    assert code == 0 and len(runs) == 5  # S0 skipped (no --video), S2 and S6a re-ran
    assert runs[3].split()[2:] == ["--steps", "9", "--mode", "x", "--force"]
    assert "--steps" not in runs[4]
    report = json.loads((Path(run.PIPELINE) / "work/vid/run.json").read_text())
    assert report["preset"] == "fast" and report["stages"]["S2"]["args"] == ["--steps", "9", "--mode", "x"]


def test_no_people_and_missing_video(pipe, capsys):
    code, events, runs = pipe(capsys, "--no-people")
    assert code == 0 and [r[0] for r in runs] == ["A", "B"]
    (Path(run.PIPELINE) / "work").rename(Path(run.PIPELINE) / "old")
    code, events, runs = pipe(capsys, video=False)  # S0 never ran: it needs --video
    assert code == 1 and runs == [] and events[-1]["error"] == "video_unavailable"


def test_failure_maps_error_and_stops(pipe, capsys):
    code, events, runs = pipe(capsys, "--window", "FAIL")
    assert code == 1 and len(runs) == 1  # S2 never ran
    assert events[-1] == {"stage": "S0", "error": "video_unavailable", "detail": "unreadable video"}


def test_bad_set_and_preset(pipe, capsys):
    with pytest.raises(SystemExit):
        run.stage_options(None, ["S4steps=1"])
    with pytest.raises(SystemExit):
        run.stage_options(None, ["S99.steps=1"])
    with pytest.raises(SystemExit):
        run.stage_options("nope", [])


def test_select():
    assert run.select("S0..S9")[-1] == "S9b" and len(run.select("S0..S9")) == len(run.STAGES)
    assert run.select("S3") == ["S3", "S3b"]
    assert run.select("S2..S3") == ["S2", "S3", "S3b"]
    assert run.select("S6a,S8") == ["S6a", "S8"]


def test_load_dotenv(tmp_path):
    p = tmp_path / ".env"
    p.write_text('# secrets\nHF_TOKEN=abc   # read token\nEMPTY=\nQUOTED="x y"\nnot a pair\n')
    assert run.load_dotenv(p) == {"HF_TOKEN": "abc", "EMPTY": "", "QUOTED": "x y"}
    assert run.load_dotenv(tmp_path / "missing") == {}
