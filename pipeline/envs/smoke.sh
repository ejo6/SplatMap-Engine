#!/usr/bin/env bash
# One-frame / tiny-clip smoke test per env. Usage: smoke.sh <test> ...  (prints SMOKE_OK/SMOKE_FAIL + seconds)
# Input: $SMOKE_CLIP (default: Pi3's man_walking_long sample, one person walking), cut to 3 s / 10 frames.
set -uo pipefail
W=/workspace; E=$W/envs; S=$W/work/smoke
export HF_HOME=$W/hf PYTHONUNBUFFERED=1 IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg
[ -f $W/.env ] && set -a && . $W/.env && set +a
mkdir -p $S/frames $S/jpg
[ -f $S/clip.mp4 ] || ffmpeg -loglevel error -y -i ${SMOKE_CLIP:-$W/src/Pi3/examples/gradio_examples/man_walking_long.mp4} -t 3 -vf scale=-2:720 -r 30 $S/clip.mp4
[ -f $S/frames/01.png ] || ffmpeg -loglevel error -y -i $S/clip.mp4 -vf fps=10/3 -frames:v 10 $S/frames/%02d.png
[ -f $S/jpg/00000.jpg ] || ffmpeg -loglevel error -y -i $S/clip.mp4 -q:v 2 -start_number 0 $S/jpg/%05d.jpg
MEM='import torch;print(f"peak_vram_gb={torch.cuda.max_memory_allocated()/1e9:.1f}")'

run() { local t=$1; shift; local s=$(date +%s)
  if "$@" > $S/$t.log 2>&1; then echo "SMOKE_OK $t $(( $(date +%s)-s ))s $(grep -h peak_vram $S/$t.log | tail -1)"
  else echo "SMOKE_FAIL $t $(( $(date +%s)-s ))s :: $(tail -3 $S/$t.log | tr '\n' ' ')"; fi; }

for t in "$@"; do case $t in
da3) run da3 $E/recon/bin/python -c "
import glob,torch; from depth_anything_3.api import DepthAnything3
m=DepthAnything3.from_pretrained('depth-anything/DA3NESTED-GIANT-LARGE-1.1').to('cuda')
p=m.inference(sorted(glob.glob('$S/frames/*.png')))
print(p.depth.shape,p.extrinsics.shape,p.intrinsics.shape); $MEM" ;;
gsplat) R=$E/recon; T=$R/targets/x86_64-linux  # conda cuda-toolkit keeps headers under targets/
  CUDA_HOME=$R CPATH=$T/include LIBRARY_PATH=$T/lib PATH=$R/bin:$PATH TORCH_CUDA_ARCH_LIST="8.6;9.0" TORCH_EXTENSIONS_DIR=$W/.cache/torch_extensions \
  run gsplat $E/recon/bin/python -c "
import torch; from gsplat import rasterization
n=100000; d='cuda'; means=torch.randn(n,3,device=d,requires_grad=True); q=torch.randn(n,4,device=d); s=torch.full((n,3),-4.,device=d)
o=torch.zeros(n,device=d); c=torch.rand(n,3,device=d,requires_grad=True)
V=torch.eye(4,device=d)[None]; V[0,2,3]=5; K=torch.tensor([[[600.,0,640],[0,600,360],[0,0,1]]],device=d)
img,_,_=rasterization(means,q,torch.exp(s),torch.sigmoid(o),c,V,K,1280,720); img.mean().backward()
print(img.shape, means.grad.abs().sum().item()>0); $MEM" ;;
sam3) run sam3 $E/sam3/bin/python -c "
from sam3.model_builder import build_sam3_video_predictor
p=build_sam3_video_predictor(); r=p.handle_request(dict(type='start_session',resource_path='$S/jpg'))
o=p.handle_request(dict(type='add_prompt',session_id=r['session_id'],frame_index=0,text='person'))['outputs']
print(type(o), list(o.keys()) if hasattr(o,'keys') else len(o)); $MEM" ;;
lama) TORCH_HOME=$W/.cache/torch run lama $E/recon/bin/python -c "
import sys, numpy as np; sys.path.insert(0, '$(dirname "$0")/..'); from s4a_holes import load_lama; from PIL import Image
im=np.asarray(Image.open('$S/frames/01.png').convert('RGB')); m=np.zeros(im.shape[:2],bool); m[200:700,500:780]=True
Image.fromarray(load_lama()(im,m)).save('$S/lama.png'); print('saved')" ;;
lhm) run lhm bash -c "cd $W/src/LHM && $E/lhm/bin/python -c 'from LHM.runners.infer.human_lrm import HumanLRMInferrer; print(\"ok\")'" ;;
gvhmr) run gvhmr bash -c "cd $W/src/GVHMR && $E/people/bin/python tools/demo/demo.py --video=$S/clip.mp4 -s --output_root $S/gvhmr" ;;
spark) run spark bash -c "$E/recon/bin/python -c \"
import numpy as np; from plyfile import PlyData, PlyElement
n=50000; names=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']
a=np.random.randn(n,len(names)).astype('f4'); a[:,7:10]=-4; v=np.empty(n,[(k,'f4') for k in names])
for i,k in enumerate(names): v[k]=a[:,i]
PlyData([PlyElement.describe(v,'vertex')]).write('$S/rand.ply')\" && $W/src/spark/rust/target/release/build-lod --quality $S/rand.ply && ls -la $S/rand-lod.rad" ;;
esac; done
