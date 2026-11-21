import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s3_cameras import check_zoom, interpolate_c2w, keyframe_indices  # noqa: E402


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
