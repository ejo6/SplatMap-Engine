# GPU box setup (S-07 / KAN-19)

How the GPU box is built and how to bring a fresh pod back up. Everything heavy lives on the **network volume**, so a new pod needs about 1 minute of setup.

## Box

| | |
|---|---|
| Provider | RunPod (Vultr Cloud GPUs were unavailable in every region) |
| GPU | 1× A40 48 GB, On-Demand, **$0.60/h**. Datacenter **CA-MTL-1**, which also has H100 (Low availability) for jobs that run out of memory on 48 GB |
| Image | `runpod/pytorch:2.1.0-cu1290-torch280-ubuntu2404` (driver supports CUDA 13.x, so it runs every env below) |
| Volume | 200 GB high-performance network volume mounted at `/workspace`, with `/data` symlinked to it. $28/month: delete it after the hackathon |
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
  repo/pipeline/envs/  copy of this repo's pipeline/envs (rsync from a laptop)
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
bash pipeline/envs/smoke.sh da3 pi3x gsplat sam3 vda lama gvhmr ingest node
```

Base install (once): `apt install git git-lfs ffmpeg build-essential`, Miniforge at `/workspace/miniforge`, Deno at `/workspace/deno`, then `git clone --depth 1` of each repo into `/workspace/src`.

## Envs

TODO: filled in when all smoke tests pass.

## Weights

TODO

## Smoke tests

TODO

## Gotchas

- **Network volume rejects `chown`:** use `rsync -rlt` and `tar --no-same-owner`.
- **`chumpy`** (used by GVHMR and LHM) only builds with `pip install --no-build-isolation chumpy==0.70`, because its setup.py imports pip.
- **GVHMR checkpoints:** Google Drive blocks scripted downloads, so they come from the HF mirror `camenduru/GVHMR` (same files and sizes as the official Drive folder).
- **Video Depth Anything** pins `imageio-ffmpeg 0.4.7`, which needs `pkg_resources`, so `depth` pins `setuptools==69.5.1`.
- **DA3** processes at 504 px by default. For E-02, raise the processing resolution to the planned 1280–1600 px long edge.
- **GVHMR and LHM can't share an env** (GVHMR needs `timm 0.9.12`, LHM needs `timm 1.0.15`), so they are `people` and `lhm`.
