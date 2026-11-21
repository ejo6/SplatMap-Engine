"""S6b World placement and motion export (PRD §8.4 person.json, §13; ticket A-04 / KAN-39).

Turns each GVHMR camera-space body (S6a) into world-space SMPL-X joint transforms for the viewer.
  in : work/<id>/S6/body/<objId>.npz (A-03), work/<id>/S3/cameras.json (E-03: world y-up metres, floor y = 0)
  out: work/<id>/S6/people/p<k>/motion.bin   float32 (frameCount, 55, 3, 4) row-major, little-endian
       work/<id>/S6/people/p<k>/person.json
motion[f][j] maps a point in the person's SMPL-X rest space (shaped T-pose, metres) to world space, i.e. the
linear-blend-skinning matrix: world = sum_j w_j * motion[f][j] @ [p_rest, 1]. The browser needs no SMPL-X code.
Run in the `people` env:  python pipeline/s6_place.py --work work/<youtubeId>
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

STAGE = "S6b"
M4 = np.diag([1.0, -1.0, -1.0, 1.0])  # OpenCV camera axes -> three.js camera axes (PRD §8.1)
FOOT_JOINTS = (10, 11)  # SMPL-X left_foot, right_foot
CONTACT_M = 0.10  # a foot this close to the floor counts as a contact and gets pinned
N_JOINTS = 55


def progress(pct):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": None}), flush=True)


def c2w_matrices(cams, frames):
    return np.array([cams["frames"][f]["c2w"] for f in frames], dtype=np.float64).reshape(-1, 4, 4)


def solve_scale(foot_cam, c2w, foot_offset):
    """One scale per person so the feet rest on y = 0. Scaling the body about the camera centre keeps its image
    projection, so it still overlaps its mask; only its distance and size change.

    foot_cam: (F, 3) lowest-foot joint in OpenCV camera space. foot_offset: that joint's height above the sole in
    rest pose. World y of the scaled joint is s*a + b, and it should equal s*foot_offset -> s = b / (foot_offset - a).
    """
    p = np.concatenate([foot_cam, np.ones((len(foot_cam), 1))], axis=1)
    a = np.einsum("fi,fi->f", (c2w @ M4)[:, 1, :3], p[:, :3])
    b = c2w[:, 1, 3]
    s = b / (foot_offset - a)
    s = s[np.isfinite(s) & (s > 0)]
    return float(np.median(s)) if len(s) else 1.0


def pin_offsets(foot_height, k=5):
    """Per-frame vertical shift that puts a foot within CONTACT_M of the floor onto it (smoothed, no pops)."""
    dy = np.where(foot_height < CONTACT_M, -foot_height, 0.0)
    pad = k // 2
    dp = np.concatenate([np.repeat(dy[:1], pad), dy, np.repeat(dy[-1:], pad)])
    return np.convolve(dp, np.ones(k) / k, mode="valid")


def world_transforms(c2w, scale, transl, A, dy):
    """(F,4,4) cameras, scale, (F,3) transl, (F,J,4,4) SMPL-X rest->posed, (F,) pin -> (F,J,3,4) world matrices."""
    T = np.tile(np.eye(4), (len(c2w), 1, 1))
    T[:, :3, 3] = transl
    S = np.diag([scale, scale, scale, 1.0])
    P = np.tile(np.eye(4), (len(c2w), 1, 1))
    P[:, 1, 3] = dy
    W = P @ c2w @ M4 @ S @ T  # (F,4,4)
    return (W[:, None] @ A)[:, :, :3, :]


def skinning(model, betas, global_orient, body_pose):
    """SMPL-X rest->posed joint transforms (F,J,4,4), rest joints (J,3), rest sole y and rest height (metres)."""
    import torch
    from smplx.lbs import batch_rigid_transform, batch_rodrigues, blend_shapes, vertices2joints

    with torch.no_grad():
        n = len(global_orient)
        b = torch.tensor(betas, dtype=torch.float32)[None]
        v_shaped = model.v_template[None] + blend_shapes(b, model.shapedirs[..., : b.shape[1]])
        J = vertices2joints(model.J_regressor, v_shaped)  # (1, J, 3)
        zeros = torch.zeros(n, 3)
        full_pose = torch.cat([
            torch.tensor(global_orient, dtype=torch.float32),
            torch.tensor(body_pose, dtype=torch.float32),
            zeros, zeros, zeros,  # jaw, eyes
            model.left_hand_mean.expand(n, -1), model.right_hand_mean.expand(n, -1),  # GVHMR: mean hands
        ], dim=1)
        rot = batch_rodrigues(full_pose.reshape(-1, 3)).reshape(n, -1, 3, 3)
        _, A = batch_rigid_transform(rot, J.expand(n, -1, -1), model.parents)
    y = v_shaped[0, :, 1]
    return A.numpy().astype(np.float64), J[0].numpy(), float(y.min()), float(y.max() - y.min())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--smplx-dir", type=Path,
                    default=Path(os.environ.get("SMPLX_DIR", "/data/src/GVHMR/inputs/checkpoints/body_models")))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    out = args.work / "S6" / "people"
    if (out / "p0" / "person.json").exists() and not args.force:
        progress(100)
        return
    bodies = sorted((args.work / "S6" / "body").glob("*.npz"))
    cams_path = args.work / "S3" / "cameras.json"
    if not bodies or not cams_path.exists():
        sys.exit("need S6/body/*.npz (A-03) and S3/cameras.json (E-03)")
    cams = json.loads(cams_path.read_text())
    n_frames = len(cams["frames"])
    tracks = {i["id"]: i for i in json.loads((args.work / "S2" / "tracks.json").read_text())["instances"]}

    import smplx

    model = smplx.create(str(args.smplx_dir), model_type="smplx", gender="neutral", use_pca=False,
                         flat_hand_mean=False, num_betas=10)
    parents = model.parents.tolist()

    for k, path in enumerate(bodies):
        body = np.load(path)
        frames = body["frames"]
        A, rest_joints, sole_y, rest_height = skinning(
            model, body["betas"], body["incam_global_orient"], body["incam_body_pose"])
        transl = body["incam_transl"]
        c2w = c2w_matrices(cams, frames)

        # Lowest foot joint per frame in camera space. The posed joint position is A[:, j, :3, 3] + transl,
        # because A maps the joint's rest position onto itself plus the motion (A @ [J_rest, 1]).
        feet = np.einsum("fjab,jb->fja", A[:, FOOT_JOINTS], np.c_[rest_joints[list(FOOT_JOINTS)], np.ones(2)])[..., :3]
        feet = feet + transl[:, None]
        foot_offset = float(rest_joints[list(FOOT_JOINTS), 1].mean() - sole_y)
        lowest = feet[np.arange(len(frames)), np.argmax(feet[:, :, 1], axis=1)]  # OpenCV y points down
        scale = solve_scale(lowest, c2w, foot_offset)
        foot_y = np.einsum("fi,fi->f", (c2w @ M4)[:, 1, :3], scale * lowest) + c2w[:, 1, 3]
        dy = pin_offsets(foot_y - scale * foot_offset)
        W = world_transforms(c2w, scale, transl, A, dy)  # (span, J, 3, 4)

        # Index by shot frame; outside the span repeat the edge pose (the avatar is hidden there via `visible`).
        idx = np.clip(np.arange(n_frames) - frames[0], 0, len(frames) - 1)
        pdir = out / f"p{k}"
        pdir.mkdir(parents=True, exist_ok=True)
        W[idx].astype("<f4").tofile(pdir / "motion.bin")
        oid = path.stem
        (pdir / "person.json").write_text(json.dumps({
            "id": f"p{k}",
            "label": tracks.get(oid, {}).get("prompt") or "person",
            "avatar": None,  # filled by S7/S9a once A-07 picks the format
            "joints": N_JOINTS,
            "skeleton": "smplx55",
            "parents": parents,
            # Rest space = this person's shaped SMPL-X T-pose, unscaled; the world scale is baked into motion.bin.
            "restJoints": np.round(rest_joints, 5).tolist(),
            "motion": {"url": "motion.bin", "frameCount": n_frames, "layout": "J x 3x4 row-major float32 per frame"},
            "visible": body["visible"].tolist(),
            "sourceInstance": oid,
            "scale": round(scale, 4),
            "heightM": round(scale * rest_height, 3),  # sanity check: adults ~1.5-1.9, children less
        }, indent=1))
        progress(100 * (k + 1) / len(bodies))


if __name__ == "__main__":
    main()
