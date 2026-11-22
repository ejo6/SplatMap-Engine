import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from s7_avatar import top4  # noqa: E402


def test_top4_keeps_strongest_joints_and_renormalises():
    w = np.zeros((2, 55))
    w[0, [3, 9, 20, 40, 50]] = [0.5, 0.2, 0.1, 0.1, 0.1]  # 5 joints: the weakest is dropped
    w[1, 7] = 1.0
    s = top4(w)
    assert s.shape == (2, 8) and s.dtype == np.float32
    assert s[0, 0] == 3 and s[0, 1] == 9 and set(s[0, 2:4]) <= {20, 40, 50}
    np.testing.assert_allclose(s[:, 4:].sum(axis=1), 1, rtol=1e-6)
    np.testing.assert_allclose(s[0, 4:6], [0.5 / 0.9, 0.2 / 0.9], rtol=1e-6)
    assert s[1, 0] == 7 and s[1, 4] == 1
