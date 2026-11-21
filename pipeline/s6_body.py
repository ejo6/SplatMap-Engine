"""S6a Body tracking (PRD §7.2 S6, FR-13; ticket A-03 / KAN-38). Tracker: GVHMR (decided on A-02).

GVHMR runs once per SAM person instance, driven by that instance's own boxes instead of GVHMR's YOLO
tracker, so SAM instances and body tracks match one-to-one and non-person instances never become bodies.
Camera: intrinsics + per-frame rotation from cameras.json when E-03 has written it, else GVHMR's SimpleVO.
  in : work/<id>/S0/frames/*.jpg, work/<id>/S2/tracks.json, optional work/<id>/S3/cameras.json (PRD §8.4)
  out: work/<id>/S6/body/<objId>.npz   SMPL-X params per frame of the person's span (see docs/people-pipeline.md)
Run in the `people` env (GVHMR):  python pipeline/s6_body.py --work work/<youtubeId>
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

STAGE = "S6a"
CV_FROM_GL = np.diag([1.0, -1.0, -1.0])  # flips camera Y and Z: three.js/OpenGL <-> OpenCV (PRD §8.1)


def progress(pct):
    print(json.dumps({"stage": STAGE, "pct": round(pct, 1), "eta": None}), flush=True)


def interp_boxes(boxes, f0, f1):
    """tracks.json boxes [[f, x0, y0, x1, y1], ...] -> (f1-f0+1, 4) xyxy, linearly filled across gaps."""
    b = np.array(boxes, dtype=np.float64)
    frames = np.arange(f0, f1 + 1)
    return np.stack([np.interp(frames, b[:, 0], b[:, i]) for i in range(1, 5)], axis=1)


def r_w2c_from_cameras(c2w_rows):
    """cameras.json c2w (row-major 16, three.js convention) -> (N, 3, 3) world-to-camera rotations, OpenCV axes."""
    r_c2w = np.array(c2w_rows, dtype=np.float64).reshape(-1, 4, 4)[:, :3, :3] @ CV_FROM_GL
    return np.transpose(r_c2w, (0, 2, 1))


def smooth(x, k=5):
    """Centred moving average along time (axis 0), edges padded by repetition."""
    pad = k // 2
    xp = np.concatenate([np.repeat(x[:1], pad, 0), x, np.repeat(x[-1:], pad, 0)])
    return np.stack([xp[i : i + len(x)] for i in range(k)]).mean(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, type=Path, help="work/<youtubeId>")
    ap.add_argument("--gvhmr-repo", type=Path, default=Path(os.environ.get("GVHMR_REPO", "/data/src/GVHMR")))
    ap.add_argument("--cameras", type=Path, help="cameras.json from E-03 (default: <work>/S3/cameras.json)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    work = args.work.resolve()

    out = work / "S6" / "body"
    tracks = json.loads((work / "S2" / "tracks.json").read_text())
    people = [i for i in tracks["instances"] if i["label"] == "person"]
    if not people:
        sys.exit("no people in S2/tracks.json")
    if out.exists() and not args.force and all((out / f"{p['id']}.npz").exists() for p in people):
        progress(100)
        return
    frame_paths = sorted((work / "S0" / "frames").glob("*.jpg"))
    width, height = tracks["width"], tracks["height"]
    cams_path = (args.cameras or work / "S3" / "cameras.json").resolve()
    cams = json.loads(cams_path.read_text()) if cams_path.exists() else None

    # GVHMR resolves configs and checkpoints relative to its repo root.
    os.chdir(args.gvhmr_repo)
    sys.path.insert(0, str(args.gvhmr_repo))
    import hydra
    import torch
    from hydra import compose, initialize_config_module

    from hmr4d.configs import register_store_gvhmr
    from hmr4d.utils.geo.hmr_cam import estimate_K, get_bbx_xys_from_xyxy
    from hmr4d.utils.geo_transform import compute_cam_angvel
    from hmr4d.utils.net_utils import detach_to_cpu
    from hmr4d.utils.preproc import Extractor, SimpleVO, VitPoseExtractor

    with initialize_config_module(version_base="1.3", config_module="hmr4d.configs"):
        register_store_gvhmr()
        cfg = compose(config_name="demo", overrides=["video_name=s6"])
    model = hydra.utils.instantiate(cfg.model, _recursive_=False)
    model.load_pretrained_model(cfg.ckpt_path)
    model = model.eval().cuda()
    vitpose, extractor = VitPoseExtractor(), Extractor()

    out.mkdir(parents=True, exist_ok=True)
    for n_done, person in enumerate(people):
        f0 = person["visible"][0][0]
        f1 = person["visible"][-1][1]
        n = f1 - f0 + 1
        with tempfile.TemporaryDirectory() as tmp:
            clip = f"{tmp}/clip.mp4"  # GVHMR's extractors read a video file
            list_file = Path(tmp) / "frames.txt"
            list_file.write_text("".join(f"file '{p}'\nduration {1 / 30}\n" for p in frame_paths[f0 : f1 + 1]))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
                            "-frames:v", str(n), "-r", "30", "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", clip],
                           check=True)

            bbx_xys = get_bbx_xys_from_xyxy(torch.tensor(interp_boxes(person["boxes"], f0, f1)).float(), base_enlarge=1.2)
            with torch.no_grad():
                kp2d = vitpose.extract(clip, bbx_xys)
                f_imgseq = extractor.extract_video_features(clip, bbx_xys)
            if cams:
                fx, fy, cx, cy = (cams["intrinsics"][k] for k in ("fx", "fy", "cx", "cy"))
                K = torch.tensor([[fx, 0, cx], [0, fy, cy], [0, 0, 1]]).float()
                R_w2c = torch.tensor(r_w2c_from_cameras([cams["frames"][f]["c2w"] for f in range(f0, f1 + 1)])).float()
                cam_source = "cameras.json"
            else:  # shortcut: GVHMR's own odometry until E-03 writes cameras.json; A-04 needs the real one anyway
                K = estimate_K(width, height)
                R_w2c = torch.from_numpy(SimpleVO(clip, scale=0.5, step=8, method="sift").compute()[:, :3, :3]).float()
                cam_source = "simplevo"

        data = {
            "length": torch.tensor(n),
            "bbx_xys": bbx_xys,
            "kp2d": kp2d,
            "K_fullimg": K.repeat(n, 1, 1),
            "cam_angvel": compute_cam_angvel(R_w2c),
            "f_imgseq": f_imgseq,
        }
        pred = detach_to_cpu(model.predict(data, static_cam=False))
        inc = {k: v.numpy() for k, v in pred["smpl_params_incam"].items()}
        glo = {k: v.numpy() for k, v in pred["smpl_params_global"].items()}
        betas = np.median(inc["betas"], axis=0)  # one body shape per person (and per avatar)
        np.savez(
            out / f"{person['id']}.npz",
            frames=np.arange(f0, f1 + 1),
            visible=np.array(person["visible"]),
            K=K.numpy(),
            betas=betas,
            incam_global_orient=inc["global_orient"],
            incam_body_pose=inc["body_pose"],
            incam_transl=smooth(inc["transl"]),
            global_global_orient=glo["global_orient"],
            global_body_pose=glo["body_pose"],
            global_transl=glo["transl"],
            cam_source=cam_source,
        )
        progress(100 * (n_done + 1) / len(people))


if __name__ == "__main__":
    main()
