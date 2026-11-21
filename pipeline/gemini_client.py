"""Shared structured Gemini calls for the offline pipeline."""

import logging
import os
from collections.abc import Callable, Sequence
from pathlib import Path
from time import monotonic, sleep
from typing import TypeVar

import httpx2
import yaml
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

_CONFIG = Path(__file__).resolve().parents[1] / "config" / "gemini.yaml"
_LOG = logging.getLogger(__name__)
_REQUEST_ERRORS = (errors.APIError, httpx2.RequestError)
Result = TypeVar("Result", bound=BaseModel)
Fallback = TypeVar("Fallback")


def _wait_for_file(client: genai.Client, file: types.File) -> types.File:
    deadline = monotonic() + 120
    while file.state == types.FileState.PROCESSING and monotonic() < deadline:
        sleep(2)
        file = client.files.get(name=file.name)
    if file.state != types.FileState.ACTIVE:
        raise RuntimeError(f"Gemini file did not become active (state: {file.state})")
    return file


def generate_json(
    prompt: str,
    schema: type[Result],
    *,
    fallback: Callable[[], Fallback],
    media: Sequence[Path] = (),
) -> Result | Fallback:
    """Return a strictly validated model or call the stage's local fallback."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        _LOG.info("GEMINI_API_KEY is unset, using fallback")
        return fallback()

    model = yaml.safe_load(_CONFIG.read_text(encoding="utf-8"))["model"]
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_json_schema=schema.model_json_schema(),
    )
    http_options = types.HttpOptions(
        timeout=60_000,
        retry_options=types.HttpRetryOptions(attempts=1),
    )
    with genai.Client(api_key=api_key, vertexai=False, http_options=http_options) as client:
        uploaded = []
        contents = []
        try:
            for path in media:
                file = client.files.upload(file=path)
                uploaded.append(file.name)
                try:
                    contents.append(_wait_for_file(client, file))
                except RuntimeError as error:
                    _LOG.warning("%s", error)
                    break
            else:
                for attempt in (1, 2):
                    response = client.models.generate_content(
                        model=model, contents=[*contents, prompt], config=config
                    )
                    try:
                        return schema.model_validate_json(response.text or "", strict=True)
                    except ValidationError:
                        _LOG.warning("Gemini returned invalid JSON or schema data (attempt %d)", attempt)
        except _REQUEST_ERRORS as error:
            _LOG.warning("Gemini request failed (%s), using fallback", type(error).__name__)
        finally:
            for name in uploaded:
                try:
                    client.files.delete(name=name)
                except _REQUEST_ERRORS:
                    _LOG.warning("Could not delete uploaded Gemini file %s", name)

    return fallback()
