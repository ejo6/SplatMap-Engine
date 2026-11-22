import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s3_cameras import apply_similarity, check_zoom, chunk_ranges, fit_similarity, interpolate_c2w, keyframe_indices  # noqa: E402


def test_keyframes_include_last_frame():
    assert keyframe_indices(13, 6) == [0, 6, 12]
    assert keyframe_indices(14, 6) == [0, 6, 12, 13]


def test_interpolation_hits_keyframes_and_midpoints():
    kf = [0, 6, 12]
    c2w = np.tile(np.eye(4), (3, 1, 1))
    for j, yaw in enumerate([0, 30, 60]):
        c2w[j, :3, :3] = Rotation.from_euler("y", yaw, degrees=True).as_matrix()
        c2w[j, :3, 3] = [j * 1.0, 0, 0]
    out = interpolate_c2w(kf, c2w, 13)
    assert out.shape == (13, 4, 4)
    np.testing.assert_allclose(out[kf], c2w, atol=1e-9)
    np.testing.assert_allclose(out[3, :3, 3], [0.5, 0, 0])
    assert np.isclose(Rotation.from_matrix(out[3, :3, :3]).as_euler("xyz", degrees=True)[1], 15)


def test_zoom_check():
    assert check_zoom(np.full(50, 1000.0), 0.08)[1]
    assert not check_zoom(np.linspace(1000, 1400, 50), 0.08)[1]


def test_chunk_ranges_overlap_and_cover():
    assert chunk_ranges(100, 360, 90) == [(0, 100)]
    r = chunk_ranges(224, 100, 25)
    assert r[0][0] == 0 and r[-1][1] == 224
    assert all(b - a <= 100 for a, b in r)
    assert all(r[i][1] - r[i + 1][0] == 25 for i in range(len(r) - 1))


def test_fit_similarity_recovers_transform():
    rng = np.random.default_rng(0)
    c2w = np.tile(np.eye(4), (10, 1, 1))
    c2w[:, :3, :3] = Rotation.random(10, random_state=1).as_matrix()
    c2w[:, :3, 3] = rng.normal(size=(10, 3))
    s, R, t = 1.7, Rotation.from_euler("xyz", [10, 40, -5], degrees=True).as_matrix(), np.array([1.0, -2, 3])
    ref = apply_similarity(s, R, t, c2w)
    depth = rng.uniform(1, 5, size=(10, 8, 8))
    s2, R2, t2 = fit_similarity(ref, c2w, depth * s, depth)
    np.testing.assert_allclose(apply_similarity(s2, R2, t2, c2w), ref, atol=1e-9)
