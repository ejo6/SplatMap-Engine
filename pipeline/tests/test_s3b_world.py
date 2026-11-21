import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s3b_world import fit_plane, transform_c2w, world_transform  # noqa: E402


def scene(seed=0):
    """A floor (y = 0, +Y up) plus clutter and a camera 1.7 m up looking along -Z (yawed 20 deg, pitched down 10),
    all expressed in a randomly rotated, shifted 'DA3' world."""
    rng = np.random.default_rng(seed)
    floor = np.c_[rng.uniform(-5, 5, 3000), rng.normal(0, 0.01, 3000), rng.uniform(-10, 0, 3000)]
    clutter = rng.uniform([-5, 0.3, -10], [5, 3, 0], (1000, 3))
    cam_gl = np.eye(4)
    cam_gl[:3, :3] = Rotation.from_euler("YX", [20, -10], degrees=True).as_matrix()
    cam_gl[:3, 3] = [2, 1.7, 1]
    G = np.eye(4)  # true world -> DA3 world
    G[:3, :3] = Rotation.random(random_state=seed).as_matrix()
    G[:3, 3] = rng.normal(0, 3, 3)
    pts = np.c_[np.r_[floor, clutter], np.ones(4000)] @ G.T
    cam_cv = G @ cam_gl @ np.diag([1.0, -1, -1, 1])
    return pts[:, :3], cam_cv


def test_floor_fit_and_world_frame():
    pts, cam_cv = scene()
    up_guess = -cam_cv[:3, 1]
    n, d, inl = fit_plane(pts, up_guess, thresh=0.05)
    assert inl[:3000].mean() > 0.95 and inl[3000:].mean() < 0.1
    T = world_transform(n, d, cam_cv, scale=1.0)
    cam = transform_c2w(T, cam_cv[None], 1.0)[0]
    np.testing.assert_allclose(cam[:3, 3], [0, 1.7, 0], atol=0.03)  # above the origin at eye height
    fwd = -cam[:3, 2]
    assert fwd[2] < -0.95 and abs(fwd[0]) < 1e-6  # looks down -Z (pitched down a little)
    assert cam[1, 1] > 0.95  # camera up is world up
    np.testing.assert_allclose(cam[:3, :3] @ cam[:3, :3].T, np.eye(3), atol=1e-6)
    world_pts = np.c_[pts, np.ones(len(pts))] @ T.T
    assert np.abs(world_pts[:3000, 1]).max() < 0.06  # floor at y = 0


def test_scale_applies_to_positions_only():
    pts, cam_cv = scene(1)
    n, d, _ = fit_plane(pts, -cam_cv[:3, 1], thresh=0.05)
    cam = transform_c2w(world_transform(n, d, cam_cv, scale=2.0), cam_cv[None], 2.0)[0]
    assert np.isclose(cam[1, 3], 3.4, atol=0.06)
    np.testing.assert_allclose(cam[:3, :3] @ cam[:3, :3].T, np.eye(3), atol=1e-6)
