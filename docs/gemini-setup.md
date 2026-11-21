# Gemini pipeline setup

Install `pipeline/requirements-gemini.txt` in the pipeline environment. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) and export it as `GEMINI_API_KEY`. A local `.env` can store the key. Load it into the shell before running the pipeline.

`config/gemini.yaml` pins the model. Call `pipeline.gemini_client.generate_json` with a prompt, a Pydantic model, optional media paths, and a callable that returns the stage's local default. The helper validates the response and retries invalid output once. It also uses the fallback when the key is absent or a Gemini request fails.

Run this from the repo root with a creator-permitted or openly licensed 30-second MP4. A successful call prints schema-valid JSON. A fallback exits with an error so it cannot pass the smoke test.

```bash
CLIP=/path/to/clip.mp4 .venv/bin/python - <<'PY'
import os
from pathlib import Path

from pydantic import BaseModel

from pipeline.gemini_client import generate_json


class Scene(BaseModel):
    title: str
    summary: str


result = generate_json(
    "Describe the setting of this clip in a short title and one sentence.",
    Scene,
    media=[Path(os.environ["CLIP"])],
    fallback=lambda: None,
)
if result is None:
    raise SystemExit("Gemini did not return schema-valid JSON")
print(result.model_dump_json())
PY
```
