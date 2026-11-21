import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from pipeline.s1_shots import detect_shots, write_shots


class ShotDetectionTest(unittest.TestCase):
    def make_video(self, intervals):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "fixture.mp4"
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30, (64, 64))
        self.assertTrue(writer.isOpened())
        try:
            for level, count in intervals:
                frame = np.full((64, 64, 3), level, dtype=np.uint8)
                for _ in range(count):
                    writer.write(frame)
        finally:
            writer.release()
        return path

    def test_cuts_select_the_longest_shot_and_report_both_gaps(self):
        video = self.make_video([(0, 30), (255, 60), (0, 45)])
        result = detect_shots(video)

        self.assertEqual(len(result["shots"]), 3)
        for shot, expected in zip(result["shots"], (0, 30, 90)):
            self.assertLessEqual(abs(shot["startFrame"] - expected), 2)
        self.assertEqual(result["shots"][-1]["endFrame"], 135)
        self.assertEqual(result["selected"], result["shots"][1])
        self.assertEqual(result["unreconstructed"], [
            {"start": 0, "end": result["selected"]["start"]},
            {"start": result["selected"]["end"], "end": 4.5},
        ])
        output = video.with_name("shots.json")
        write_shots(output, result)
        self.assertEqual(json.loads(output.read_text()), result)

    def test_single_shot_is_capped_only_in_the_selection(self):
        result = detect_shots(self.make_video([(0, 1830)]))

        self.assertEqual(len(result["shots"]), 1)
        self.assertEqual(result["shots"][0]["frameCount"], 1830)
        self.assertEqual(result["selected"]["frameCount"], 1800)
        self.assertEqual(result["unreconstructed"], [{"start": 60, "end": 61}])

    def test_single_shot_within_limit_uses_the_full_window(self):
        result = detect_shots(self.make_video([(100, 30)]))

        self.assertEqual(result["shots"], [result["selected"]])
        self.assertEqual(result["unreconstructed"], [])
