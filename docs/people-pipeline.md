# People pipeline (Adam)

Stages S2, S6, S7 and S8 from PRD §7.2. Each reads and writes `work/<youtubeId>/<stage>/`.

## S2 masks: `pipeline/s2_masks.py` (A-01)

- **Env:** `conda env create -f pipeline/envs/sam3.yml`. SAM 3 is loaded through Hugging Face `transformers` (`Sam3VideoModel`), not the `facebookresearch/sam3` repo. `HF_TOKEN` must belong to an account with `facebook/sam3` access.
- **Run:** `python pipeline/s2_masks.py --work work/<id> [--dilate 15] [--min-frames 10] [--force]`. It skips if `S2/tracks.json` exists. It prints JSON progress lines like `{"stage":"S2","pct":..,"eta":..}`.
- **Inputs:**
  - `S0/frames/*.jpg`: every frame of the processed window, sorted by name.
  - `S1/director.json` (optional): reads `subjects: [{noun, kind}]`, where `kind` is `person`, `animal` or `vehicle`. All nouns go to SAM 3 in one session. Without the file it uses the prompt `"person"`.
- **Outputs:** mask PNGs use the same filename stem as the source frame in `S0/frames`. Frame numbers inside `tracks.json` are 0-based indices into the sorted frame list.
  - `S2/masks/union/<frame>.png`: one file for **every** frame. 255 means a mover (any instance, dilated by `--dilate` px). E-04 excludes this from both the RGB and depth losses.
  - `S2/masks/o<objId>/<frame>.png`: one mask per instance, written **only for frames where it's visible**, undilated. A missing file means not visible.
  - `S2/tracks.json`: `{width, height, frameCount, dilatePx, prompts, instances: [{id:"o3", prompt, label:"person"|"other", visible:[[start,end],...], boxes:[[f,x0,y0,x1,y1],...], meanScore}]}`. Boxes are in video pixels.
- **Behaviour:**
  - Object IDs come from SAM 3 tracking and stay stable across the clip.
  - Instances seen in fewer than `--min-frames` frames are dropped from `tracks.json` but stay in the union mask.
  - Person IDs `p0…` (PRD §8.4) are assigned later in S6, when tracks are matched one-to-one with body tracks.
- **Memory (S2):** frames are kept on the CPU (`video_storage_device="cpu"`). A 60 s clip at 30 fps needs tens of GB of system RAM for the preprocessed frames; GPU memory is the model plus a small feature cache.

## S8 people layer: `pipeline/s8_people_layer.py` (A-08)

- **Env:** `conda env create -f pipeline/envs/depth.yml`, plus a clone of Video-Depth-Anything with its metric Small checkpoint. Setup commands are in the yml header. Point `--vda-repo` (or `$VDA_REPO`, default `/data/models/Video-Depth-Anything`) at the clone.
- **Run:** `python pipeline/s8_people_layer.py --work work/<id> [--ref-depth DIR] [--fps 30] [--force]`. It skips if `S8/holo.json` exists.
- **Inputs:**
  - `S0/frames/*.jpg`.
  - `S2/masks/o*/<frame>.png`: undilated instance masks. Their union is the mover mask.
  - Optional `S3/depth/<frame>.npy`: keyframe depth in **world metres** (after E-03), float32 HxW, 0 = invalid. Only some frames need it.
- **Depth:**
  - Uses the **metric** Video Depth Anything model, so depth is already roughly in metres. That avoids the relative model's unknown scale and shift.
  - When `S3/depth` exists, one global scale (median ratio on background pixels) aligns it to the world. Without it, the scale is 1.0. The scale is written to `holo.json.depthScale`.
- **Outputs (PRD §8.4):**
  - `S8/holo.mp4`: W×2H (1280×1440 for 720p), H.264 yuv420p, CRF 16, GOP 15, no B-frames, faststart. Top half is the full RGB frame. Bottom half is greyscale: movers are 16–255 by inverse depth, everything else is 0.
  - `S8/holo.json`: `{frames: [[near, far], ...], depthScale, fps}`. Near and far are the min and max mover depth per frame, in metres. A frame with no movers gets `[0, 0]`.
- **Decode in the viewer (A-10):**
  - Discard `v < 8`.
  - `inv = 1/far + (v - 16)/239 * (1/near - 1/far)`, then `depth = 1/inv`.
  - H.264 ringing leaves a few non-mover pixels at 8–55, all within 3 px of a silhouette. The stretched-triangle discard (depth ratio above 1.08) removes them.
- **Speed:** 8 frames at 960×540 took about 70 s on a Mac CPU. GPU time hasn't been measured.
