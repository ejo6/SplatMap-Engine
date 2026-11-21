#!/usr/bin/env bash
# One-frame / tiny-clip smoke test per env. Usage: smoke.sh <test> ...  (prints SMOKE_OK/SMOKE_FAIL + seconds)
# Input: Pi3's man_walking_long sample (one person walking), cut to 3 s / 10 frames.
set -uo pipefail
W=/workspace; E=$W/envs; S=$W/work/smoke
export HF_HOME=$W/hf PYTHONUNBUFFERED=1 IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg
[ -f $W/.env ] && set -a && . $W/.env && set +a
mkdir -p $S/frames $S/jpg
[ -f $S/clip.mp4 ] || ffmpeg -loglevel error -y -i $W/src/Pi3/examples/gradio_examples/man_walking_long.mp4 -t 3 -vf scale=-2:720 -r 30 $S/clip.mp4
[ -f $S/frames/01.png ] || ffmpeg -loglevel error -y -i $S/clip.mp4 -vf fps=10/3 -frames:v 10 $S/frames/%02d.png
[ -f $S/jpg/00000.jpg ] || ffmpeg -loglevel error -y -i $S/clip.mp4 -q:v 2 -start_number 0 $S/jpg/%05d.jpg
MEM='import torch;print(f"peak_vram_gb={torch.cuda.max_memory_allocated()/1e9:.1f}")'

run() { local t=$1; shift; local s=$(date +%s)
  if "$@" > $S/$t.log 2>&1; then echo "SMOKE_OK $t $(( $(date +%s)-s ))s $(grep -h peak_vram $S/$t.log | tail -1)"
  else echo "SMOKE_FAIL $t $(( $(date +%s)-s ))s :: $(tail -3 $S/$t.log | tr '\n' ' ')"; fi; }

for t in "$@"; do case $t in
ingest) run ingest bash -c "$E/ingest/bin/yt-dlp --version && $E/ingest/bin/scenedetect -i $S/clip.mp4 -o $S detect-content list-scenes -q && $E/ingest/bin/python -c 'import google.genai, boto3'" ;;
da3) run da3 $E/recon/bin/python -c "
import glob,torch; from depth_anything_3.api import DepthAnything3
m=DepthAnything3.from_pretrained('depth-anything/DA3NESTED-GIANT-LARGE-1.1').to('cuda')
p=m.inference(sorted(glob.glob('$S/frames/*.png')))
print(p.depth.shape,p.extrinsics.shape,p.intrinsics.shape); $MEM" ;;
pi3x) run pi3x $E/recon/bin/python -c "
import torch; from pi3.models.pi3x import Pi3X; from pi3.utils.basic import load_images_as_tensor
m=Pi3X.from_pretrained('yyfz233/Pi3X').to('cuda').eval(); x=load_images_as_tensor('$S/frames',interval=1).to('cuda')
with torch.no_grad(), torch.amp.autocast('cuda',dtype=torch.bfloat16): r=m(x[None])
print(r['camera_poses'].shape); $MEM" ;;
gsplat) run gsplat $E/recon/bin/python -c "
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
vda) mkdir -p $W/src/Video-Depth-Anything/checkpoints && ln -sf $(ls $HF_HOME/hub/models--depth-anything--Video-Depth-Anything-Large/snapshots/*/video_depth_anything_vitl.pth) $W/src/Video-Depth-Anything/checkpoints/
     run vda bash -c "cd $W/src/Video-Depth-Anything && $E/depth/bin/python run.py --input_video $S/clip.mp4 --output_dir $S/vda --encoder vitl && ls $S/vda" ;;
lama) run lama $E/lama/bin/python -c "
from simple_lama_inpainting import SimpleLama; from PIL import Image, ImageDraw
im=Image.open('$S/frames/01.png').convert('RGB'); m=Image.new('L',im.size,0); ImageDraw.Draw(m).rectangle([500,200,780,700],fill=255)
SimpleLama()(im,m).save('$S/lama.png'); print('saved')" ;;
gvhmr) run gvhmr bash -c "cd $W/src/GVHMR && $E/people/bin/python tools/demo/demo.py --video=$S/clip.mp4 -s --output_root $S/gvhmr" ;;
node) run node bash -c "$E/node/bin/node --version" ;;
esac; done
