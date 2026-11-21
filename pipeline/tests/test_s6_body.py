import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s6_body import interp_boxes, r_w2c_from_cameras, smooth  # noqa: E402


def test_interp_boxes_fills_gaps_and_span():
    boxes = [[2, 0, 0, 10, 10], [4, 10, 0, 20, 10]]  # frame 3 missing (occluded)
    b = interp_boxes(boxes, 2, 4)
    assert b.shape == (3, 4)
    assert np.allclose(b[1], [5, 0, 15, 10])


def test_r_w2c_converts_three_to_opencv():
    # three.js camera at the origin looking down -Z with +Y up == OpenCV camera looking down +Z with +Y down,
    # i.e. world->camera flips Y and Z.
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    r = r_w2c_from_cameras([ident])[0]
    assert np.allclose(r, np.diag([1, -1, -1]))
    # A world point straight ahead of the three.js camera (z = -2) lands at +Z (in front) in OpenCV.
    assert (r @ np.array([0, 0, -2]))[2] > 0
    # Yaw the camera 90 deg left (+Y): it now looks down world -X; that point must also be in front.
    yaw = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]
    assert (r_w2c_from_cameras([yaw])[0] @ np.array([-2, 0, 0]))[2] > 0


def test_smooth_keeps_length_and_constant():
    x = np.ones((7, 3))
    assert np.allclose(smooth(x), x)
    y = np.zeros((7, 1))
    y[3] = 5
    assert smooth(y).shape == (7, 1) and np.isclose(smooth(y)[3, 0], 1.0)
