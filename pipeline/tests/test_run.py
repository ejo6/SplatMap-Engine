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
    print(json.dumps({{"error": "video_unavailable", "detail": "private video"}}))
    sys.exit(1)
"""


@pytest.fixture
def pipe(tmp_path, monkeypatch):
    for name in ("A", "B"):
        (tmp_path / f"{name.lower()}.py").write_text(DUMMY.format(name=name))
    monkeypatch.setattr(run, "PIPELINE", tmp_path)
    monkeypatch.setattr(run, "STAGES", [("S0", "a.py", "x", [], "download_blocked"),
                                        ("S1", "b.py", "x", ["S0"], "no_usable_shot")])

    def go(capsys, *extra):
        monkeypatch.setattr(sys, "argv", ["run.py", "--youtube-id", "vid", "--work-root", str(tmp_path / "work"),
                                          "--stages", "S0..S1", *extra])
        code = 0
        try:
            run.main()
        except SystemExit as e:
            code = e.code
        events = [json.loads(l) for l in capsys.readouterr().out.splitlines()]
        runs = (tmp_path / "work" / "vid" / "runs.txt").read_text().splitlines()
        return code, events, runs
    return go


def test_progress_skip_and_rerun_on_input_change(pipe, capsys):
    code, events, runs = pipe(capsys, "--stages", "S0..S1")
    assert code == 0 and len(runs) == 2
    assert [(e["stage"], e["pct"]) for e in events] == [("S0", 0), ("S0", 50), ("S0", 100),
                                                         ("S1", 0), ("S1", 50), ("S1", 100)]

    code, events, runs = pipe(capsys)
    assert len(runs) == 2 and all(e.get("skipped") for e in events)  # nothing re-ran

    code, events, runs = pipe(capsys, "--window", "10,70")  # S0 input changed -> S0 and S1 re-run
    assert len(runs) == 4 and "--force" in runs[2] and "--force" in runs[3]

    code, events, runs = pipe(capsys, "--window", "10,70", "--stages", "S1", "--force")
    assert len(runs) == 5 and runs[4].startswith("B")


def test_failure_maps_error_and_stops(pipe, capsys):
    code, events, runs = pipe(capsys, "--window", "FAIL")
    assert code == 1 and len(runs) == 1  # S1 never ran
    assert events[-1] == {"stage": "S0", "error": "video_unavailable", "detail": "private video"}


def test_select():
    assert run.select("S0..S9")[-1] == "S9b" and len(run.select("S0..S9")) == len(run.STAGES)
    assert run.select("S3") == ["S3", "S3b"]
    assert run.select("S2..S3") == ["S2", "S3", "S3b"]
    assert run.select("S6a,S8") == ["S6a", "S8"]
