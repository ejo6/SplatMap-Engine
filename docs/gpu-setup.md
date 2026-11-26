# GPU box setup (S-07 / KAN-19)

How the GPU box is built and how to bring a fresh pod back up. Everything heavy lives on the **network volume**, so a new pod needs about 1 minute of setup.

## Box

| | |
|---|---|
| Provider | RunPod (Vultr Cloud GPUs were unavailable in every region) |
| GPU | 1× A40 48 GB, On-Demand, **$0.60/h**. Datacenter **CA-MTL-1**, which also has H100 (Low availability) for jobs that run out of memory on 48 GB |
| Image | `runpod/pytorch:2.1.0-cu1290-torch280-ubuntu2404` (driver supports CUDA 13.x, so it runs every env below) |
| Volume | 200 GB high-performance network volume mounted at `/workspace`, with `/data` symlinked to it. $28/month: delete it after the hackathon |
| Teammate access | Public keys in `/workspace/authorized_keys` are re-added to every new pod by `setup_gpu.sh link` |
| Pod settings | Container disk 50 GB (wiped on every new pod); SSH over exposed TCP (port 22); volume mount `/workspace` |
| Access | Add your SSH public key in RunPod **Settings → SSH Public Keys** before deploying. Use the pod's **Connect → "SSH over exposed TCP"** line (`ssh root@<ip> -p <port>`); the IP and port change for every new pod |

## Layout on the volume

```
/workspace/
  miniforge/        conda/mamba (base)          deno/        Deno (yt-dlp PO tokens)
  envs/<name>/      one conda env per model family (see below)
  src/<repo>/       model repos (cloned --depth 1)
  hf/               HF_HOME (all Hugging Face weights)
  models/           SMPL/SMPL-X (copied by hand), weights.log
  work/ worlds/     pipeline output          .env    HF_TOKEN etc. (never commit)
  rust/ cargo/      Rust toolchain for Spark build-lod
  repo/pipeline/ repo/config/  copy of this repo's pipeline/ and config/ (remote.sh rsyncs them)
```

## Fresh pod (volume already set up)

```bash
rsync -rlt pipeline/envs root@<ip>:/workspace/repo/pipeline/ -e "ssh -p <port>"   # if the scripts changed
ssh root@<ip> -p <port> 'bash /workspace/repo/pipeline/envs/setup_gpu.sh link'    # /data link, apt pkgs, PATH/HF_HOME in .bashrc
```

Use `rsync -rlt` (not `-a`): the network volume rejects `chown`. Use `tar --no-same-owner` for the same reason.

## Building from scratch

```bash
bash pipeline/envs/setup_gpu.sh            # all envs; or: setup_gpu.sh recon sam3 ...
bash pipeline/envs/download_weights.sh     # weights (re-runnable)
bash pipeline/envs/smoke.sh da3 gsplat sam3 lama lhm spark gvhmr
```

Base install (once): `apt install git git-lfs ffmpeg build-essential`, Miniforge at `/workspace/miniforge`, then `git clone --depth 1` of each repo into `/workspace/src`.

## Envs

Run with `/workspace/envs/<name>/bin/python` (no activation needed). Specs: `pipeline/envs/<name>.yml`; the extra install steps are in `setup_gpu.sh`.

| Env | Python / torch | Contents | Used by |
|---|---|---|---|
| `recon` | 3.11 / 2.5.1 cu124 | Depth Anything 3 (editable), gsplat 1.5.3, plyfile, conda `cuda-toolkit=12.4`. Also runs `run.py` itself, S0 (system ffmpeg) and S4a LaMa (TorchScript) | S0, S3–S5, S9 |
| `sam3` | 3.12 / 2.7.1 cu126 | SAM 3 repo (editable) + transformers 5.24 (`Sam3VideoModel`, used by `s2_masks.py`) + kernels | S2 (Adam) |
| `people` | 3.10 / 2.3.0 cu121 | GVHMR (editable, pytorch3d wheel) | S6 |
| `lhm` | 3.10 / 2.3.0 cu121 | LHM requirements, pytorch3d, BasicSR, SAM 2 fork, diff-gaussian-rasterization, simple-knn, conda `cuda-toolkit=12.1` | S7 (Adam) |
| `depth` | 3.10 / 2.1.1 cu121 | Video Depth Anything requirements | S8 (Adam) |

Spark `build-lod` (S9a) is a Rust binary at `/workspace/src/spark/rust/target/release/build-lod` (override with `$BUILD_LOD`), built with `cargo build --release` in `rust/build-lod`. Its toolchain is in `/workspace/rust` and `/workspace/cargo`.

**Compiling CUDA code (gsplat JIT, LHM extensions):** the conda `cuda-toolkit` puts headers under `targets/`. `run.py` sets the variables below for each stage itself. For running a script by hand, export them first (as `smoke.sh` does):

```bash
R=/workspace/envs/recon; T=$R/targets/x86_64-linux
export CUDA_HOME=$R CPATH=$T/include LIBRARY_PATH=$T/lib PATH=$R/bin:$PATH \
       TORCH_CUDA_ARCH_LIST="8.6;9.0" TORCH_EXTENSIONS_DIR=/workspace/.cache/torch_extensions
```

The compiled gsplat kernels are cached in `/workspace/.cache/torch_extensions`, so only the first run on a volume pays the ~4 min compile.

## Weights

All via `download_weights.sh`. Hugging Face models land in `HF_HOME=/workspace/hf`.

| Model | Source | Notes |
|---|---|---|
| DA3 | `depth-anything/DA3NESTED-GIANT-LARGE-1.1` | Best quality; CC BY-NC |
| SAM 3 | `facebook/sam3` | Gated: needs `HF_TOKEN` in `/workspace/.env` from an account with approved access |
| Video Depth Anything | `depth-anything/Metric-Video-Depth-Anything-Small` | Symlinked into `src/Video-Depth-Anything/checkpoints/` (S8) |
| big-lama | TorchScript `big-lama.pt` (GitHub release of simple-lama-inpainting) | `/workspace/.cache/torch/hub/checkpoints/` (S4a) |
| GVHMR | HF mirror `camenduru/GVHMR` → `src/GVHMR/inputs/checkpoints/` | dpvo, gvhmr, hmr2, vitpose, yolo |
| LHM | `3DAIGC/LHM-1B-HF` + LHM prior tar (Aliyun) → `src/LHM/pretrained_models/` | Prior is an 18.8 GB tar; extracted, then deleted |
| SMPL / SMPL-X | For now `/workspace/models/smplx` and `/workspace/models/smpl` are symlinks to the copies bundled in LHM's prior (`src/LHM/pretrained_models/human_model_files/`) | Linked into GVHMR `inputs/checkpoints/body_models/`. The SMPL licence expects each user to register at smpl-x.is.tue.mpg.de / smpl.is.tue.mpg.de (Adam, S-02) |

Volume use after setup: about 50 GB of 187 GB.

## Smoke tests

`bash pipeline/envs/smoke.sh <test>...` on the shared input (`$SMOKE_CLIP`, default Pi3's `man_walking_long` sample, cut to 3 s at 720p, 10 frames). Measured on the A40, 2026-11-21. Times include model load. The `lama` and `lhm` tests were changed after the cleanup (LaMa now runs in `recon`, and `lhm` is now an import check) and haven't been re-run.

| Test | Env | Result | Time | Peak VRAM |
|---|---|---|---|---|
| `da3` | recon | ✅ depth, extrinsics, intrinsics for 10 frames (504 px default res) | 67 s | 10.6 GB |
| `gsplat` | recon | ✅ 100k Gaussians rasterized at 1280×720, backward OK | 235 s first run (JIT compile), then cached | 0.1 GB |
| `sam3` | sam3 | ✅ video session, text prompt "person" → masks, boxes, IDs | 69 s | 6.3 GB |
| `lama` | recon | not re-run since the move from the `lama` env (was ✅ in 16 s) | | |
| `lhm` | lhm | import check, not re-run (the old full test made an avatar in 226 s) | | |
| `spark` | recon | ✅ `build-lod --quality` on 50k random splats → `rand-lod.rad` | 1 s | |
| `gvhmr` | people | ✅ static-camera demo: `hmr4d_results.pt` + in-camera and global renders | 73 s | |

## Gotchas

- **Network volume rejects `chown`:** use `rsync -rlt` and `tar --no-same-owner`.
- **`chumpy`** (used by GVHMR and LHM) only builds with `pip install --no-build-isolation chumpy==0.70`, because its setup.py imports pip.
- **GVHMR checkpoints:** Google Drive blocks scripted downloads, so they come from the HF mirror `camenduru/GVHMR` (same files and sizes as the official Drive folder).
- **`pkg_resources`:** Video Depth Anything's `imageio-ffmpeg 0.4.7` and SAM 3's `model_builder.py` both import it, so `depth` and `sam3` pin `setuptools==69.5.1`. Also set `IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg`.
- **DA3 memory:** the nested giant model runs out of memory at 1288 px even with 65 keyframes on the A40. At 504 px it needs 15 GB for 65 keyframes and 41.6 GB for 390, so S3 solves at 504 px (see `recon-pipeline.md`).
- **GVHMR and LHM can't share an env** (GVHMR needs `timm 0.9.12`, LHM needs `timm 1.0.15`), so they are `people` and `lhm`.
