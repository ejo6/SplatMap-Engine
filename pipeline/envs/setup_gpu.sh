#!/usr/bin/env bash
# Builds every pipeline env on the GPU box. Everything lives on the network volume (/workspace),
# so a fresh pod only needs: bash /workspace/repo/pipeline/envs/setup_gpu.sh link
# Usage: setup_gpu.sh [link | <env> ...]   (no args = all envs)
set -uo pipefail
W=/workspace
export PATH=$W/miniforge/bin:$W/deno/bin:$PATH
export CONDA_PKGS_DIRS=$W/.cache/conda PIP_CACHE_DIR=$W/.cache/pip HF_HOME=$W/hf
HERE=$(cd "$(dirname "$0")" && pwd)

link() {  # per-pod setup: container disk is wiped on every new pod
  ln -sfn $W /data
  mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && cat $W/authorized_keys 2>/dev/null | while read -r k; do grep -qF "$k" ~/.ssh/authorized_keys || echo "$k" >> ~/.ssh/authorized_keys; done  # teammates' keys
  apt-get install -y -qq git-lfs ffmpeg build-essential libgl1 libglib2.0-0 tmux >/dev/null
  grep -q HF_HOME ~/.bashrc || cat >> ~/.bashrc <<RC
export PATH=$W/miniforge/bin:$W/deno/bin:\$PATH HF_HOME=$W/hf IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg CONDA_PKGS_DIRS=$W/.cache/conda PIP_CACHE_DIR=$W/.cache/pip
[ -f $W/.env ] && set -a && . $W/.env && set +a
RC
}

build() {
  local e=$1 p=$W/envs/$1
  [ -d $p ] || mamba env create -y -q -p $p -f $HERE/$e.yml || return 1
  local pip="$p/bin/pip install -q"
  case $e in
    recon) $pip -e $W/src/Depth-Anything-3 ;;
    sam3)  $pip -e $W/src/sam3 ;;
    people) $pip numpy==1.23.5 && $pip --no-build-isolation chumpy==0.70 \
             && $pip -r $W/src/GVHMR/requirements.txt && $pip -e $W/src/GVHMR ;;
    lhm)   (cd $W/src/LHM && $pip numpy==1.23.0 && $pip --no-build-isolation chumpy==0.70 && $pip -r requirements.txt && $p/bin/pip uninstall -y -q basicsr \
             && $pip git+https://github.com/XPixelGroup/BasicSR git+https://github.com/hitsz-zuoqi/sam2/ \
             && $pip --no-build-isolation git+https://github.com/ashawkey/diff-gaussian-rasterization/ git+https://github.com/camenduru/simple-knn/) ;;
  esac
}

if [ "${1:-}" = link ]; then link; exit; fi
for e in ${@:-recon sam3 people lhm depth}; do build $e 2>&1 && echo "ENV_OK $e" || echo "ENV_FAIL $e"; done
