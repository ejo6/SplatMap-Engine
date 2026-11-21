import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s4_background import backproject  # noqa: E402


def test_backproject_respects_mask_and_pose():
    depth = np.full((4, 6), 2.0, np.float32)
    keep = np.ones((4, 6), bool)
    keep[:, :3] = False  # left half is a mover
    K = np.array([[3.0, 0, 3], [0, 3, 2], [0, 0, 1]])
    c2w = np.eye(4)
    c2w[:3, 3] = [10, 0, 0]
    pts, v, u = backproject(depth, K, c2w, keep, stride=1)
    assert len(pts) == 12 and (u >= 3).all()
    np.testing.assert_allclose(pts[:, 2], 2.0)
    assert (pts[:, 0] > 10).all()  # right half of the image, shifted by the camera position


def test_ssim_is_one_for_identical_images():
    torch = pytest.importorskip("torch")
    from s4_background import ssim_map
    a = torch.rand(1, 3, 32, 32)
    assert torch.allclose(ssim_map(a, a).mean(), torch.tensor(1.0), atol=1e-4)
    assert ssim_map(a, torch.rand(1, 3, 32, 32)).mean() < 0.5
