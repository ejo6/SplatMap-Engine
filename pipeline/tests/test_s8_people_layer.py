import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s8_people_layer import encode_inv_depth, fit_scale  # noqa: E402


def decode(v, near, far):
    return 1 / (1 / far + (v.astype(float) - 16) / 239 * (1 / near - 1 / far))


def test_encode_round_trip_and_background():
    depth = np.full((4, 4), 9.0)
    mask = np.zeros((4, 4), bool)
    depth[1, 1], depth[2, 2], depth[2, 1] = 1.5, 4.0, 2.5
    mask[1, 1] = mask[2, 2] = mask[2, 1] = True
    v, (near, far) = encode_inv_depth(depth, mask)
    assert (near, far) == (1.5, 4.0)
    assert v[1, 1] == 255 and v[2, 2] == 16  # nearest -> 255, farthest -> 16
    assert (v[~mask] == 0).all()  # non-movers below 8
    assert abs(decode(v[2, 1], near, far) - 2.5) < 0.02


def test_encode_no_movers():
    v, nf = encode_inv_depth(np.ones((3, 3)), np.zeros((3, 3), bool))
    assert nf == [0.0, 0.0] and not v.any()


def test_fit_scale_uses_background_only():
    depths = np.full((2, 20, 20), 2.0, np.float32)
    masks = [np.zeros((20, 20), bool) for _ in range(2)]
    masks[0][:5] = True
    ref = np.full((20, 20), 3.0, np.float32)
    ref[:5] = 99.0  # people region in the reference must be ignored
    assert abs(fit_scale(depths, {0: ref}, masks) - 1.5) < 1e-6
    assert fit_scale(depths, {}, masks) == 1.0


def test_smooth_depth_stays_inside_each_instance():
    from s8_people_layer import smooth_depth

    depth = np.full((20, 20), 9.0, np.float32)  # background far away
    a = np.zeros((20, 20), bool)
    b = np.zeros((20, 20), bool)
    a[5:15, 2:9] = True
    b[5:15, 9:16] = True  # touching a, but a different person
    depth[a] = 2.0
    depth[b] = 4.0
    depth[10, 5] = 3.0  # noise inside a
    out = smooth_depth(depth, [a, b], 5)
    assert out[a].max() < 2.1 and out[a].min() > 1.9  # noise smoothed, no background or b leaked in
    assert np.allclose(out[b], 4.0)
    assert np.allclose(out[~(a | b)], 9.0)  # background untouched
