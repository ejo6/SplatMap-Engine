import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s2_masks import dilate, load_prompts, to_ranges  # noqa: E402


def test_to_ranges():
    assert to_ranges([]) == []
    assert to_ranges([3]) == [[3, 3]]
    assert to_ranges([0, 1, 2, 5, 6, 9]) == [[0, 2], [5, 6], [9, 9]]


def test_dilate_grows_by_px():
    m = torch.zeros(21, 21, dtype=torch.bool)
    m[10, 10] = True
    d = dilate(m, 3)
    assert d.sum() == 7 * 7 and d[7, 7] and not d[6, 10]
    assert torch.equal(dilate(m, 0), m)


def test_load_prompts(tmp_path):
    assert load_prompts(tmp_path / "missing.json") == {"person": "person"}
    p = tmp_path / "director.json"
    p.write_text(json.dumps({"subjects": []}))
    assert load_prompts(p) == {"person": "person"}
    p.write_text(json.dumps({"subjects": [{"noun": "vlogger", "kind": "person"}, {"noun": "dog", "kind": "animal"}]}))
    assert load_prompts(p) == {"person": "person", "dog": "animal"}
