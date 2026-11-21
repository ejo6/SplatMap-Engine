"""Detect cuts in the normalized video and select the default reconstruction shot."""

import argparse
import json
import os
import tempfile
from pathlib import Path

from scenedetect import ContentDetector, SceneManager, open_video
from scenedetect.video_stream import VideoOpenFailure

MAX_SHOT_SECONDS = 60


def shot_range(start, end, fps):
    return {
        "start": start / fps,
        "end": end / fps,
        "startFrame": start,
        "endFrame": end,
        "frameCount": end - start,
    }


def detect_shots(path):
    video = open_video(str(path), backend="opencv")
    manager = SceneManager()
    manager.add_detector(ContentDetector())
    manager.detect_scenes(video)
    fps = float(video.frame_rate)
    shots = [
        {"id": f"s{index}", **shot_range(start.frame_num, end.frame_num, fps)}
        for index, (start, end) in enumerate(manager.get_scene_list(start_in_scene=True))
        if end.frame_num > start.frame_num
    ]
    if not shots:
        raise ValueError("S0 video contains no decodable shots.")

    longest = max(shots, key=lambda shot: shot["frameCount"])
    start = longest["startFrame"]
    end = min(longest["endFrame"], start + int(MAX_SHOT_SECONDS * fps))
    selected = {"id": longest["id"], **shot_range(start, end, fps)}
    unreconstructed = [
        {"start": a / fps, "end": b / fps}
        for a, b in ((0, start), (end, shots[-1]["endFrame"]))
        if b > a
    ]
    return {
        "fps": fps,
        "shots": shots,
        "selected": selected,
        "unreconstructed": unreconstructed,
    }


def write_shots(output, data):
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, delete=False) as temp:
        temporary = Path(temp.name)
    try:
        temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    video = args.work / "S0" / "video.mp4"
    output = args.work / "S1" / "shots.json"

    try:
        source_mtime = video.stat().st_mtime_ns
        if not args.force and output.is_file() and output.stat().st_mtime_ns >= source_mtime:
            try:
                cached = json.loads(output.read_text(encoding="utf-8"))
                if cached["shots"] and cached["selected"] and isinstance(cached["unreconstructed"], list):
                    print(json.dumps({"stage": "S1a", "pct": 100, "eta": 0, "skipped": True}))
                    return 0
            except (ValueError, TypeError, KeyError):
                pass
        write_shots(output, detect_shots(video))
    except FileNotFoundError:
        print(json.dumps({"error": "no_usable_shot", "detail": "S0 video.mp4 is missing. Run S0 first."}))
        return 1
    except (VideoOpenFailure, ValueError) as exc:
        print(json.dumps({"error": "no_usable_shot", "detail": str(exc)}))
        return 1
    print(json.dumps({"stage": "S1a", "pct": 100, "eta": 0}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
