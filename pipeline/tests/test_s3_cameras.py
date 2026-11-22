import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s3_cameras import (apply_similarity, check_zoom, chunk_ranges, fit_similarity, interpolate_c2w,  # noqa: E402
                        keyframe_indices, selected_frames)


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


def test_selected_shot_and_edge_poses(tmp_path):
    assert selected_frames(tmp_path, 50) == (0, 50)  # no S1: whole clip
    (tmp_path / "S1").mkdir()
    (tmp_path / "S1/shots.json").write_text(json.dumps({"selected": {"startFrame": 20, "endFrame": 50}}))
    a, b = selected_frames(tmp_path, 50)
    kf = [a + k for k in keyframe_indices(b - a, 6)]
    assert kf[0] == 20 and kf[-1] == 49
    c2w = np.tile(np.eye(4), (len(kf), 1, 1))
    c2w[:, 0, 3] = np.arange(len(kf))
    out = interpolate_c2w(kf, c2w, 50)
    assert np.allclose(out[:21], c2w[0])  # frames before the shot repeat its first pose
    assert np.isclose(out[23, 0, 3], 0.5)
