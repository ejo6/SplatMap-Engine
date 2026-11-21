import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s7_identity import crop_person, pick_candidates, valid_ranking  # noqa: E402


def test_pick_candidates_one_per_bin_skipping_border():
    areas = {f: f for f in range(16)}  # later frames are bigger
    border = {f: f in (7, 15) for f in range(16)}  # the biggest of each half is cut off by the edge
    assert pick_candidates(areas, border, k=2) == [6, 14]
    assert pick_candidates({3: 1}, {3: True}, k=8) == [3]  # nothing better: keep it


def test_valid_ranking():
    assert valid_ranking([2, 0, 1], 3)
    assert not valid_ranking([0, 0, 1], 3)
    assert not valid_ranking([0, 1], 3)
    assert not valid_ranking([0, 1, 3], 3)


def test_crop_blanks_everything_outside_the_mask():
    frame = np.zeros((100, 100, 3), np.uint8)  # black frame, so a bystander would show up black
    mask = np.zeros((100, 100), bool)
    mask[40:60, 30:50] = True
    frame[40:60, 30:50] = 7
    crop = np.array(crop_person(frame, mask))
    assert crop.shape == (24, 24, 3)  # 20px box + 10% pad each side
    assert (crop[2:22, 2:22] == 7).all()
    assert (crop[0] == 255).all() and (crop[:, 0] == 255).all()
