import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from google.genai import types
from pydantic import BaseModel

from pipeline.gemini_client import generate_json


class Scene(BaseModel):
    title: str


class GeminiClientTest(unittest.TestCase):
    @patch.dict(os.environ, {"GEMINI_API_KEY": ""})
    @patch("pipeline.gemini_client.genai.Client")
    def test_missing_key_uses_fallback_without_opening_client(self, factory):
        self.assertEqual(generate_json("Describe", Scene, fallback=lambda: "local"), "local")
        factory.assert_not_called()

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"})
    @patch("pipeline.gemini_client.genai.Client")
    def test_invalid_json_and_schema_trigger_single_retry_then_fallback(self, factory):
        client = factory.return_value.__enter__.return_value
        generate = client.models.generate_content
        generate.side_effect = [
            SimpleNamespace(text="invalid JSON"),
            SimpleNamespace(text='{"title": 123}'),
        ]

        self.assertEqual(generate_json("Describe", Scene, fallback=lambda: "local"), "local")
        self.assertEqual(generate.call_count, 2)

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"})
    @patch("pipeline.gemini_client.genai.Client")
    def test_uploads_media_once_and_cleans_up_after_retry(self, factory):
        client = factory.return_value.__enter__.return_value
        file = types.File(name="files/test", state=types.FileState.ACTIVE)
        client.files.upload.return_value = file
        generate = client.models.generate_content
        generate.side_effect = [
            SimpleNamespace(text="{}"),
            SimpleNamespace(text='{"title": "A field"}'),
        ]

        path = Path("clip.mp4")
        result = generate_json("Describe", Scene, media=[path], fallback=lambda: None)

        self.assertEqual(result, Scene(title="A field"))
        client.files.upload.assert_called_once_with(file=path)
        self.assertEqual(generate.call_count, 2)
        for call in generate.call_args_list:
            self.assertEqual(call.kwargs["contents"], [file, "Describe"])
            self.assertEqual(call.kwargs["config"].response_json_schema, Scene.model_json_schema())
        client.files.delete.assert_called_once_with(name=file.name)
