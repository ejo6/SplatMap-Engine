#!/usr/bin/env bash
# Downloads model weights onto the network volume. Safe to re-run (skips what exists).
# SAM 3 needs HF_TOKEN in /workspace/.env (account with facebook/sam3 access).
# SMPL/SMPL-X must be copied by hand to /workspace/models/smplx and /workspace/models/smpl (registration-gated).
set -uo pipefail
W=/workspace
export PATH=$W/miniforge/bin:$PATH HF_HOME=$W/hf HF_HUB_ENABLE_HF_TRANSFER=0
[ -f $W/.env ] && set -a && . $W/.env && set +a
python -c "import huggingface_hub" 2>/dev/null || pip install -q huggingface_hub
hf() { python -c "from huggingface_hub import snapshot_download as s; print(s('$1'${2:+, cache_dir='$2'}))" && echo "W_OK $1" || echo "W_FAIL $1"; }

hf depth-anything/DA3NESTED-GIANT-LARGE-1.1      # S3 cameras+depth (best quality)
hf yyfz233/Pi3X                                  # S3 fallback solver
hf depth-anything/Video-Depth-Anything-Large     # VDA smoke test (relative depth)
hf depth-anything/Metric-Video-Depth-Anything-Small   # S8 people layer (pipeline/s8_people_layer.py), linked below
hf naver/multiHMR_896_L                          # S6 tracker candidate
hf 3DAIGC/LHM-1B-HF $W/src/LHM/pretrained_models/huggingface   # S7 avatars
if [ -n "${HF_TOKEN:-}" ]; then hf facebook/sam3; else echo "W_SKIP facebook/sam3 (no HF_TOKEN)"; fi

cd $W/src/LHM && [ -d pretrained_models/human_model_files ] || \
  { wget -q https://virutalbuy-public.oss-cn-hangzhou.aliyuncs.com/share/aigc3d/data/LHM/LHM_prior_model.tar \
    && tar --no-same-owner -xf LHM_prior_model.tar && rm LHM_prior_model.tar && echo "W_OK LHM prior" || echo "W_FAIL LHM prior"; }

V=$W/src/Video-Depth-Anything/checkpoints && mkdir -p $V && \
  ln -sf $(ls $HF_HOME/hub/models--depth-anything--Metric-Video-Depth-Anything-Small/snapshots/*/metric_video_depth_anything_vits.pth) $V/ \
  && echo "W_OK VDA metric small linked" || echo "W_FAIL VDA metric small link"

C=$W/src/GVHMR/inputs/checkpoints && mkdir -p $C/body_models
[ -f $C/gvhmr/gvhmr_siga24_release.ckpt ] || \
  { python -c "from huggingface_hub import snapshot_download as s; s('camenduru/GVHMR', local_dir='$C', allow_patterns=['dpvo/*','gvhmr/*','hmr2/*','vitpose/*','yolo/*'])" \
    && echo "W_OK GVHMR ckpts" || echo "W_FAIL GVHMR ckpts"; }  # HF mirror of the official Google Drive folder (Drive blocks scripted downloads)
for m in smplx smpl; do [ -d $W/models/$m ] && ln -sfn $W/models/$m $C/body_models/$m; done
[ -d $W/models/smplx ] && echo "W_OK smplx linked" || echo "W_SKIP SMPL-X (copy files to $W/models/smplx)"
echo WEIGHTS_DONE
