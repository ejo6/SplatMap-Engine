import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s6_place import M4, pin_offsets, solve_scale, world_transforms  # noqa: E402


def cam(height=1.6, yaw_deg=0.0):
    """three.js c2w: camera at (0, height, 0), level, yawed about +Y."""
    t = np.radians(yaw_deg)
    c2w = np.eye(4)
    c2w[:3, :3] = [[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]]
    c2w[1, 3] = height
    return c2w


def test_solve_scale_puts_feet_on_floor():
    # A foot 3 m ahead and 1.6 m below a 1.6 m-high camera (OpenCV: +y down, +z forward) is on the floor: s = 1.
    c2w = np.stack([cam(), cam(yaw_deg=40)])
    foot = np.array([[0, 1.6, 3.0], [0, 1.6, 3.0]])
    assert np.isclose(solve_scale(foot, c2w, 0.0), 1.0)
    # GVHMR put the body at half the true distance and size: the scale must double it.
    assert np.isclose(solve_scale(foot / 2, c2w, 0.0), 2.0)
    # The foot joint sits 5 cm above the sole: it should end up at 5 cm (times the scale), not at 0.
    s = solve_scale(np.array([[0, 1.6 - 0.05, 3.0]]), cam()[None], 0.05)
    assert np.isclose(s * (-(1.6 - 0.05)) + 1.6, s * 0.05)


def test_world_transforms_match_manual_chain():
    # Identity skinning: the joint sits at the body's translation. Camera-space (OpenCV) (0, 1.6, 3) is 3 m ahead
    # on the floor -> world (0, 0, -3) for a level camera at 1.6 m looking down -Z.
    A = np.tile(np.eye(4), (1, 2, 1, 1))
    W = world_transforms(cam()[None], 1.0, np.array([[0, 1.6, 3.0]]), A, np.zeros(1))
    assert W.shape == (1, 2, 3, 4)
    assert np.allclose(W[0, 0] @ [0, 0, 0, 1], [0, 0, -3])
    # Scale 2 doubles distance about the camera; a pin shift lifts it.
    W2 = world_transforms(cam()[None], 2.0, np.array([[0, 0.8, 1.5]]), A, np.array([0.1]))
    assert np.allclose(W2[0, 0] @ [0, 0, 0, 1], [0, 0.1, -3])
    # Rotations pass through: OpenCV +x (camera right) maps to world +x for an unrotated camera.
    assert np.allclose((cam() @ M4)[:3, 0], [1, 0, 0])


def test_pin_offsets_only_near_floor():
    h = np.array([0.05] * 6 + [0.5] * 6)  # standing then jumping
    dy = pin_offsets(h)
    assert np.allclose(dy[:2], -0.05)  # contact frames pulled onto the floor
    assert np.allclose(dy[-2:], 0.0)  # mid-air frames untouched
    assert len(dy) == len(h)
