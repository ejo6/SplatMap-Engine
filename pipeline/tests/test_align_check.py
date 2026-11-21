import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from align_check import qa_poses  # noqa: E402


def test_qa_offsets_follow_the_camera():
    c2w = np.eye(4)
    c2w[:3, :3] = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]])  # yawed 90 deg left: looks down -X, right is -Z
    c2w[:3, 3] = [5, 1.6, 0]
    p = qa_poses(c2w)
    np.testing.assert_allclose(p["right_1m"][:3, 3], [5, 1.6, -1], atol=1e-9)
    np.testing.assert_allclose(p["forward_1m"][:3, 3], [4, 1.6, 0], atol=1e-9)
    fwd = -p["yaw_left_20"][:3, 2]  # +20 deg yaw turns left: from -X towards +Z
    assert fwd[0] < -0.9 and fwd[2] > 0.3
    np.testing.assert_allclose(p["yaw_left_20"][:3, 3], c2w[:3, 3])
