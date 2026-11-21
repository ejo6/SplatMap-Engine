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
    def test_missing_key_preserves_selection_person_and_title(self):
        result = direct(VIDEO, DATA, "Source title")
        self.assertEqual(result["source"], "fallback")
        self.assertEqual(result["selectedShotId"], "s1")
        self.assertEqual(result["window"], {"start": 20, "end": 45})
        self.assertEqual(result["subjects"], [
            {"noun": "person", "kind": "person", "start": 0, "end": 45},
        ])
        self.assertEqual(result["sceneCard"]["title"], "Source title")

    @patch("pipeline.s1_director.generate_json")
    def test_scene_card_and_mover_hints_keep_the_default_window(self, generate):
        generate.return_value = Direction.model_validate({
            "subjects": [
                {"noun": "Vlogger", "kind": "person", "start": 2, "end": 7},
                {"noun": " Dog ", "kind": "animal", "start": 38, "end": 46},
                {"noun": "Car", "kind": "vehicle", "start": 47, "end": 49},
            ],
            "sceneCard": {"title": "Park", "sentences": ["A path turns.", "Trees line it."]},
        })
        result = direct(VIDEO, DATA, "Source title")
        self.assertEqual(result["source"], "gemini")
        self.assertEqual(result["window"], {"start": 20, "end": 45})
        self.assertEqual(result["sceneCard"]["title"], "Park")
        self.assertEqual(result["subjects"], [
            {"noun": "person", "kind": "person", "start": 0, "end": 45},
            {"noun": "dog", "kind": "animal", "start": 38, "end": 45},
        ])
        self.assertEqual(generate.call_args.kwargs["media"], [VIDEO])
