# YouTube clip → walkable world (manual GPU run)

How to turn a YouTube clip (or a phone video) into a world by hand on the GPU box, then view it locally. Written for an agent; follow it top to bottom. Stage details: [pipeline-runner.md](pipeline-runner.md), box setup: [gpu-setup.md](gpu-setup.md).

## 0. Before you start

- **Box access:** the human adds their SSH public key in RunPod and gives you the pod's `ssh root@<ip> -p <port>` line. Below, `BOX="ssh -i ~/.ssh/id_ed25519 -p <port> root@<ip>"`. Never ask for or paste API keys; they already live in `/workspace/.env` on the box (`pipe_env.sh` loads them).
- **Pick a free GPU:** `$BOX nvidia-smi --query-gpu=index,memory.used --format=csv,noheader`. One clip per GPU (S2 and S3 each need most of an A40's 44 GB). Others may be running jobs: never kill a process you didn't start.
- **Box code is a plain copy, not a git checkout.** If `main` changed, sync it first (`-rlt`, not `-a`: the volume rejects `chown`):
  `rsync -rlt pipeline/ root@<ip>:/workspace/repo/pipeline/ -e "ssh -i ~/.ssh/id_ed25519 -p <port>"`

## 1. Download on your laptop (the box is blocked by YouTube)

```bash
cd ~/Downloads
yt-dlp -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]" \
  --download-sections "*34:53-35:30" --force-keyframes-at-cuts \
  -o "<youtubeId>.%(ext)s" "https://www.youtube.com/watch?v=<youtubeId>"
```

- Keep clips **≤ 60 s**. 15–40 s of one continuous shot works best.
- Note the start in seconds (34:53 → 2093) for `ingest.json`.

## 2. Upload and ingest (S0)

```bash
scp -i ~/.ssh/id_ed25519 -P <port> ~/Downloads/<id>.mp4 root@<ip>:/workspace/uploads/
```

Then, on the box (replace `<id>`, `<start>`, `<end>`, `<duration>`):

```bash
ID=<id>; W=/workspace/work/$ID; mkdir -p $W/S0 && cp /workspace/uploads/$ID.mp4 $W/S0/source.mp4
cd /workspace/repo/pipeline && /workspace/envs/ingest/bin/python -c "
import json, sys; from pathlib import Path; sys.argv=['x']
import s0_ingest as s
out = Path('$W/S0'); n = s.encode('/usr/bin/ffmpeg', out, <duration>)
(out/'ingest.json').write_text(json.dumps({'inputs': {'youtubeId': '$ID', 'start': <start>, 'end': <end>},
  'sourceStart': <start>, 'fps': 30, 'frameCount': n, 'title': '$ID'}) + '\n'); print('frames', n)"
```

**iPhone `.MOV` (HDR/HLG):** tone-map to SDR first, or colours come out washed out. Use this in place of the `cp` above:

```bash
ffmpeg -nostdin -y -i /workspace/uploads/$ID.MOV -map 0:v:0 -map 0:a:0? \
  -vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p" \
  -c:v libx264 -crf 16 -preset fast -c:a aac $W/S0/source.mp4
```

## 3. Run the pipeline (detached, one GPU)

```bash
cd /workspace/repo && . /workspace/work/pipe_env.sh && nohup bash -c \
  "CUDA_VISIBLE_DEVICES=<gpu> PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
   /workspace/envs/ingest/bin/python pipeline/run.py --youtube-id $ID --stages S1a..S8 --work-root /workspace/work \
   > $W/run.out 2> $W/run.err" < /dev/null > /dev/null 2>&1 &
```

- **No people** (world only, people erased): `--stages S1a..S5`.
- **Fewer people:** after S2, edit `S2/tracks.json` to keep only the person instances you want (the union mask still erases everyone else from the world), then run `--stages S6a..S8`.
- Time: ~25–45 min for a 30–60 s clip. S4 (world training) is the long pole.
- Use `nohup`, so the run survives your ssh session closing. Watch with `$BOX "tail -1 $W/run.out"`. One JSON line per progress tick; a failure is a line with `"error"`. The traceback is in `run.err`.
- To resume after a fix, rerun with `--stages <failed>..S8`: finished stages skip.

## 4. Package (S9a) and copy it to your laptop

```bash
$BOX "cd /workspace/repo && . /workspace/work/pipe_env.sh && /workspace/envs/recon/bin/python pipeline/s9_package.py --work /workspace/work/<id> --worlds-root /workspace/worlds"
rsync -a -e "ssh -i ~/.ssh/id_ed25519 -p <port>" --exclude world.spz root@<ip>:/workspace/worlds/<id> worlds/
```

S9a runs fine without S6–S8 (it packages 0 people). The 100 MB budget warning is OK for local viewing.

## 5. View

```bash
npm --prefix web run dev
```

Then open `http://localhost:5173/w/<id>`. Click to look, WASD to walk, C to rejoin the camera.

## Gotchas (all seen on real clips)

| Symptom | Cause / fix |
|---|---|
| Can't move for part of the video | That stretch is another shot (a cut). Only the longest shot is reconstructed (KAN-87). Pick a clip window with no cuts. |
| S2 `CUDA out of memory` | Old box code. Sync `main` (KAN-76 keeps tracker state on CPU). Don't lower `--max-objects`: it just leaves people un-erased. |
| People missing (`skip oN: solved height …` in `run.err`) | S6b drops people whose fitted height is under 1.2 m: seated people, partly visible people, or steep ground. Expected. Their pixels are still erased from the world. |
| S7 `AssertionError` (`w < h`) | Old box code. Sync `main` (KAN-86 tries other identity crops). |
| `ModuleNotFoundError: PIL` in S7a | `/workspace/envs/ingest/bin/pip install pillow` |
| World is white in the viewer | People + world must both load as ExtSplats; already handled in `web/src/main.ts`. Re-pull `main`. |

## Don'ts

- **Never commit `worlds/<id>`.** Locally built worlds stay on your machine: add `/worlds/` to `.git/info/exclude`. Also never commit `.env`, keys, cookies, model weights or SMPL-X files.
- Don't run `pkill -f <pattern>` over ssh: it can match your own ssh command. Anchor the pattern with `^` or kill by PID.
- Don't start a second job on a GPU that's already in use.
