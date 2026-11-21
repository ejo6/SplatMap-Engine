import os
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.s1_director import Direction, direct

SHOTS = [
    {"id": "s0", "start": 0, "end": 20, "frameCount": 600},
    {"id": "s1", "start": 20, "end": 45, "frameCount": 750},
]
DATA = {"fps": 30, "shots": SHOTS, "selected": SHOTS[1]}
VIDEO = Path("video.mp4")


class DirectorTest(unittest.TestCase):
    @patch.dict(os.environ, {"GEMINI_API_KEY": ""})
    def test_missing_key_uses_default_shot_person_and_title(self):
        result = direct(VIDEO, DATA, "Source title")
        self.assertEqual(result["source"], "fallback")
        self.assertEqual(result["window"], {"start": 20, "end": 45})
        self.assertEqual(result["subjects"], [
            {"noun": "person", "kind": "person", "start": 20, "end": 45},
        ])
        self.assertEqual(result["sceneCard"]["title"], "Source title")

    @patch("pipeline.s1_director.generate_json")
    def test_uses_exact_detected_boundaries_and_passes_segmentation_nouns(self, generate):
        generate.return_value = Direction.model_validate({
            "shots": [{"id": "s0", "usable": True, "reason": "Camera moves."},
                      {"id": "s1", "usable": False, "reason": "Camera zooms."}],
            "selectedShotId": "s0",
            "subjects": [{"noun": "person", "kind": "person", "start": 2, "end": 7}],
            "sceneCard": {"title": "Park", "sentences": ["A person walks.", "The path turns."]},
        })
        result = direct(VIDEO, DATA, "Source title")
        self.assertEqual(result["source"], "gemini")
        self.assertEqual(result["window"], {"start": 0, "end": 20})
        self.assertEqual(result["subjects"][0]["noun"], "person")
        self.assertEqual(generate.call_args.kwargs["media"], [VIDEO])

    @patch("pipeline.s1_director.generate_json")
    def test_unknown_shot_uses_fallback(self, generate):
        generate.return_value = Direction.model_validate({
            "shots": [{"id": "unknown", "usable": True, "reason": "Camera moves."}],
            "selectedShotId": "unknown",
            "subjects": [],
            "sceneCard": {"title": "Park", "sentences": ["A path turns.", "Trees line it."]},
        })
        self.assertEqual(direct(VIDEO, DATA, "Source title")["source"], "fallback")
