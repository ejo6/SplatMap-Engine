# JIRA.md: Ticket brief for the Jira agent

Companion to **PRD.md** (v2.0). PRD.md is the source of truth for *what* we build. This file lists *who does what* and *how to set up*. Every ticket links back to PRD sections, written as §N.

---

## 0. Instructions for the Jira agent

1. **Connect.** Use the Atlassian connector and find the Jira site and project **`KAN`**. If `KAN` doesn't exist or you can't write to it, stop and ask the human. Don't create a project.
2. **Find the people.** Look up the account IDs of **Adam, Eric, Sharib, Kevin** by display name. If a name matches more than one user, or none, stop and ask. Never guess an assignee.
3. **Avoid duplicates.** Before creating any issue, search `project = KAN AND summary ~ "<Ref>"` (for example `"K-01"`). If it exists, skip it and record the existing key.
4. **Create epics first** (§3), then every ticket in §5 as a **Task** whose parent is its epic.
   - Summary: `<Ref> · <Title>`, for example `K-01 · Ingest stage (S0)`.
   - Assignee: the ticket's owner.
   - Priority: P0 → Highest, P1 → High, P2 → Medium. If the scheme differs, use the nearest match.
   - Labels: the area label, `p0`/`p1`/`p2`, and any `gate-G#` listed.
   - Story points, if the field exists: S = 2, M = 3, L = 5.
   - Description: use the template below.
5. **Link dependencies.** After every issue exists, add an **"is blocked by"** link for each ID in a ticket's *Blocked by* list. *Soft deps* go in the description only; don't link them.
6. **Don't change workflow status.** Everything starts in **To Do**. Don't create sprints.
7. **Report back.** Finish with a table of Ref → Jira key → assignee, plus any failures.

**Description template**

```
Ref: <Ref>  ·  PRD: <sections>  ·  Size: <S|M|L>
Soft deps: <refs or "none">

<Description paragraph(s) from this file>

Acceptance criteria
- [ ] ...

Setup: see JIRA.md §2 (<subsection>) if relevant.
```

---

## 1. Team and areas

| Person | Area | Area label |
|---|---|---|
| **Eric** | Reconstruction and GPU (GPU box, runner, cameras, splat, bounds, packaging, baking) | `area-recon` |
| **Adam** | People, end to end (masks, body tracking, avatars, people layer, viewer `people/` module) | `area-people` |
| **Sharib** | Viewer (loader, clock, cameras, scrubbing, fog/boundary, HUD, performance, demo recording) | `area-viewer` |
| **Kevin** | Ingest and Gemini, backend/hosting on Vultr, extension, landing page, clip rights, Devpost | `area-platform` |

---

## 2. Setup guide

The setup tickets point here. **Request gated access (SAM 3, SMPL-X) first, because approval can take hours.**

### 2.1 Accounts

| Account | Who | Purpose | Notes |
|---|---|---|---|
| GitHub (team repo) | All | Code | Kevin creates the repo and adds everyone |
| Jira `KAN` | All | Tasks | Already exists |
| **Vultr** | Kevin (owner), Eric added as a user | GPU, Object Storage, CPU VM, CDN | Redeem the MLH promo code at the MLH table. **Ask whether credits cover Cloud GPU plans.** |
| **Google AI Studio** | Kevin | Gemini API key | Share the key through a password manager or DM, never git |
| **Hugging Face** | Adam, Eric | Model downloads, token | **Request access to `facebook/sam3` now.** Create a read token. |
| **SMPL-X / SMPL** (`smpl-x.is.tue.mpg.de`, `smpl.is.tue.mpg.de`) | Adam | Body model files for the body tracker and LHM | Free registration; non-commercial licence |
| RunPod | Eric | Fallback GPU (A100 80 GB, or 4090 for dev) | Needs a card. Use only if Vultr GPUs aren't covered. |
| Throwaway Google account | Kevin | yt-dlp cookies **only if** downloads are bot-blocked | Never use a personal account (ban risk) |
| World Labs (Marble API) | Eric | **Only if ticket E-12 is approved** | API credits are separate from app credits; cap $5 |
| Domain (optional) | Kevin | Clean URL for the extension | Free at the MLH GoDaddy Registry table, or use the Vultr CDN URL |

### 2.2 Local machine (every Mac)

- **Everyone:**
  - Install Homebrew, then: `brew install git node@20 python@3.11 ffmpeg deno`
  - Optional: `npm i -g pnpm`
  - Chrome (latest). Go to `chrome://extensions` and turn on **Developer mode** (needed to load the unpacked extension).
  - Clone the repo, run `cp .env.example .env` and fill in only the keys your area needs (§2.4).
- **Sharib, Adam (web):** `cd web && npm i`, which installs `three` and `@sparkjsdev/spark` (v2.x, pinned in `package.json`). Check that the dev server shows the test world (S-09).
- **Kevin:**
  - `python3.11 -m venv .venv && pip install -U yt-dlp bgutil-ytdlp-pot-provider "scenedetect[opencv]" fastapi uvicorn google-genai boto3`
  - Test a download: `yt-dlp -f "bv*[height<=720]+ba" --download-sections "*0-30" <url>`
- **Eric (optional Mac quick looks):** Brush release binary from github.com/ArthurBrussee/brush/releases.

### 2.3 GPU box (Eric)

1. **Image:** Ubuntu 22.04, NVIDIA driver plus CUDA 12.x, at least 200 GB of persistent disk mounted at `/data`. On RunPod, use the PyTorch CUDA template with a network volume.
2. **System packages:** `apt install git git-lfs ffmpeg build-essential`. Then install Miniforge (`mamba`) and Deno.
3. **One conda environment per model family**, because their dependencies conflict. Specs live in `pipeline/envs/*.yml` with versions pinned.

| Env | Contents | Source |
|---|---|---|
| `ingest` | yt-dlp, bgutil-ytdlp-pot-provider, scenedetect, google-genai, boto3 | pip |
| `recon` | torch, Depth Anything 3, Pi3 (fallback), gsplat, plyfile, open3d | github.com/ByteDance-Seed/Depth-Anything-3, github.com/yyfz/Pi3, `pip install gsplat` |
| `sam3` | SAM 3 | github.com/facebookresearch/sam3; weights `facebook/sam3` (HF, gated) |
| `people` | Body tracker (GVHMR **or** Multi-HMR, chosen in spike A-02), LHM, SMPL-X files | github.com/zju3dv/GVHMR, github.com/naver/multi-hmr, github.com/aigc3d/LHM |
| `depth` | Video Depth Anything | github.com/DepthAnything/Video-Depth-Anything |
| `lama` | LaMa (`big-lama`) or the `simple-lama-inpainting` pip package | github.com/advimman/lama |
| node | Spark LoD tool (`build-lod`) | See sparkjs.dev docs, "New features 2.0" |

4. **Weights:** download everything to `/data/models/` (set `HF_HOME=/data/hf`). Follow each repo's README for the exact checkpoint names. Write the names you used into `docs/gpu-setup.md`. Use DA3's best-quality model for demos; non-commercial is fine for the hackathon.
5. **Smoke test:** every environment runs one frame or one tiny clip. Record the commands and timings in `docs/gpu-setup.md`.
6. **Stop the box whenever it's idle.** Log every session in `docs/gpu-ledger.md` (date, box, hours, $). The budget cap is $60 (PRD §11).

### 2.4 Environment variables (`.env.example`)

```
GEMINI_API_KEY=
S3_ENDPOINT=                # Vultr Object Storage endpoint
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
CDN_BASE_URL=               # public base for worlds/ and the web app
API_BASE_URL=
WORKER_TOKEN=               # shared secret API <-> GPU worker
PIPELINE_VERSION=1
HF_TOKEN=
YTDLP_COOKIES=              # optional path, throwaway account only
VITE_CDN_BASE_URL=
VITE_API_BASE_URL=
```

### 2.5 Read before building

- **Everyone:** PRD.md in full.
- **Eric, Adam, Sharib:** read the parts of the Orbis repo relevant to your area (https://github.com/dtpu/OrbisEngine): the README, `docs/research-log.md` and the `archived-main` branch. Sharib also reads `src/video-projection.ts`, `src/walk-map.ts` and the edgefade logic. The code is Apache-2.0, so it can be reused with attribution. PRD §13 summarizes the lessons.

---

## 3. Epics

| Epic ref | Name | Owner |
|---|---|---|
| EP-0 | Setup & Infrastructure | Kevin |
| EP-1 | Ingest & Gemini Director | Kevin |
| EP-2 | Reconstruction & World Bounds | Eric |
| EP-3 | People Pipeline | Adam |
| EP-4 | Viewer | Sharib |
| EP-5 | People in the Viewer | Adam |
| EP-6 | Backend & Hosting | Kevin |
| EP-7 | Extension & Landing | Kevin |
| EP-8 | Demo & Submission | Eric |

Epic description: "See PRD.md. Tickets under this epic: <refs>."

## 4. Gates

Gates are tracked as labels. A gate passes when every ticket carrying its label is Done and the check below is met (PRD §14).

| Label | Pass condition |
|---|---|
| `gate-G1` | The viewer plays the hand-made test world in sync |
| `gate-G2` | **Go/no-go:** one real clip's splat lines up with its video frames from the camera poses |
| `gate-G3` | One person moves correctly in the world |
| `gate-G4` | Both demo worlds meet NFR-01/02 |
| `gate-G5` | Devpost submitted, backup video recorded |

---

## 5. Tickets

### EP-0 · Setup & Infrastructure

#### S-01 · Repo skeleton, CLAUDE.md, docs and .env.example
- **Owner:** Kevin · **P0** · Size S · Labels: `area-platform`, `setup` · Blocked by: none · PRD §16
- Create the monorepo with the layout in PRD §16. Add a `CLAUDE.md` telling agents to read PRD.md and follow §16. Add a `.gitignore` covering `.env`, `work/`, `worlds/`, models and cookies. Add `.env.example` from JIRA.md §2.4 and empty `docs/` files.
- **Acceptance:**
  - [ ] All four people can push.
  - [ ] The layout matches PRD §16.
  - [ ] Secrets are ignored.

#### S-02 · Personal setup: Adam
- **Owner:** Adam · **P0** · Size S · Labels: `area-people`, `setup` · Blocked by: none · PRD §17
- Follow JIRA.md §2.1 (Hugging Face, SAM 3 access request, SMPL-X/SMPL registration), §2.2 and §2.5.
- **Acceptance:**
  - [ ] SAM 3 access requested.
  - [ ] SMPL-X/SMPL files downloaded and handed to Eric for `/data/models`.
  - [ ] Web dev server runs locally.
  - [ ] Orbis people findings read.

#### S-03 · Personal setup: Eric
- **Owner:** Eric · **P0** · Size S · Labels: `area-recon`, `setup` · Blocked by: none
- JIRA.md §2.1 (Hugging Face, Vultr user, RunPod) and §2.2 plus §2.5.
- **Acceptance:**
  - [ ] Accounts ready.
  - [ ] Orbis reconstruction findings read.

#### S-04 · Personal setup: Sharib
- **Owner:** Sharib · **P0** · Size S · Labels: `area-viewer`, `setup` · Blocked by: none
- JIRA.md §2.2 and §2.5, including the Orbis viewer files.
- **Acceptance:**
  - [ ] Node 20 and the web dependencies are installed.
  - [ ] Notes on reusable Orbis viewer patterns are posted as a ticket comment.

#### S-05 · Personal setup: Kevin
- **Owner:** Kevin · **P0** · Size S · Labels: `area-platform`, `setup` · Blocked by: none
- JIRA.md §2.1 (Vultr, Google AI Studio, GitHub), §2.2.
- **Acceptance:**
  - [ ] yt-dlp test download works locally.
  - [ ] Chrome Developer mode is on.

#### S-06 · Vultr: credits, Object Storage, CDN, CPU VM
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform`, `setup` · Blocked by: S-05 · PRD §7.4, §11
- Redeem the MLH credits and **find out whether they cover Cloud GPU**, then report that to Eric. Create an Object Storage bucket with public read on `worlds/` and `web/`, CORS for the site origin, and CDN in front of it. Create a small CPU VM for the API (P1).
- **Acceptance:**
  - [ ] A test file uploaded with boto3 is fetchable from `CDN_BASE_URL` with the correct CORS headers.
  - [ ] GPU credit eligibility is written into this ticket.

#### S-07 · GPU box provisioning and model smoke tests
- **Owner:** Eric · **P0** · Size L · Labels: `area-recon`, `setup`, `gate-G2` · Blocked by: S-03 · Soft deps: S-06 (credit answer) · PRD §11
- Rent a Vultr A100 80 GB or L40S, or a RunPod A100 as fallback. Follow JIRA.md §2.3 in full: create every conda environment, download all weights, and run every smoke test. Start `docs/gpu-setup.md` and `docs/gpu-ledger.md`.
- **Acceptance:**
  - [ ] Every environment in §2.3 passes its smoke test.
  - [ ] Versions are pinned in `pipeline/envs/*.yml`.
  - [ ] The ledger is started.

#### S-08 · Gemini key, pinned model, client helper
- **Owner:** Kevin · **P0** · Size S · Labels: `area-platform`, `setup` · Blocked by: S-05, S-01 · PRD §7.3
- Create the API key. Choose the latest Gemini Flash model that accepts video and pin it in `config/gemini.yaml`. Build `pipeline/gemini_client.py`: upload video/images, prompt with a JSON schema, validate, retry once, then fall back.
- **Acceptance:**
  - [ ] Running a 30 s clip through the helper returns schema-valid JSON.
  - [ ] An invalid response triggers the fallback path.

#### S-09 · World format doc and hand-made test world
- **Owner:** Eric · **P0** · Size M · Labels: `area-recon`, `setup`, `gate-G1` · Blocked by: S-01 · PRD §8
- Copy PRD §8 into `docs/world-format.md`. Write a script that builds `worlds/test/v1/`:
  - any small sample splat;
  - a straight-line `cameras.json` of 10 s at 30 fps;
  - a circular walk SDF and a matching coverage sphere;
  - a synthetic `holo.mp4` (a coloured rectangle moving at 2 m depth);
  - a real `video.mp4` and thumbnails.

  No avatar yet. This unblocks all viewer work before the pipeline exists.
- **Acceptance:**
  - [ ] The test world validates against §8.
  - [ ] Sharib confirms it loads.

### EP-1 · Ingest & Gemini Director

#### K-01 · Ingest stage (S0)
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform`, `pipeline`, `gate-G2` · Blocked by: E-01, S-07 · PRD §7.2 S0, §8.2
- `pipeline/s0_ingest.py`:
  - Download only the requested window with yt-dlp (+ Deno + PO-token plugin; optional cookies).
  - Write `source.mp4`.
  - Encode `video.mp4`: 1280×720, 30 fps, H.264 with `-g 15–30`, no B-pyramid, `+faststart`, AAC.
  - Extract `frames/`.
  - Build a 2 fps thumbnail sprite plus `thumbs.json`.
  - Map failures to the `video_unavailable` / `download_blocked` errors.
- **Acceptance:**
  - [ ] It produces all outputs for a 60 s demo clip.
  - [ ] Seeking in Chrome lands within 1 GOP.
  - [ ] A re-run skips (idempotent).

#### K-02 · Shot detection and usable shot selection (S1a)
- **Owner:** Kevin · **P0** · Size S · Labels: `area-platform`, `pipeline` · Blocked by: K-01 · PRD §3 (Scene cuts), §7.2 S1
- Run the PySceneDetect content detector and write `shots.json` (start, end, frame count). The default selection is the longest shot, at most 60 s long. Fill `unreconstructed` in the manifest for the rest of the window.
- **Acceptance:**
  - [ ] A multi-cut test video gives the correct boundaries (within ±2 frames).
  - [ ] A single-shot clip gives exactly one shot.

#### K-03 · Gemini director (S1b)
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform`, `gemini`, `pipeline` · Blocked by: K-02, S-08 · PRD §7.3, FR-10, FR-27
- Send the clip and `shots.json` to Gemini. Get back:
  - usable/unusable per shot, with a reason;
  - the chosen window of 60 s or less for long videos;
  - every person, animal and vehicle with time ranges and a short noun (these become SAM 3 prompts);
  - the scene card (title plus 2 sentences).

  Write `director.json`. Fallbacks are as in PRD §7.3.
- **Acceptance:**
  - [ ] On 3 test clips, the prompt list covers every visible person.
  - [ ] The fallback works with the API key removed.

#### K-04 · Gemini quality gate (S9b)
- **Owner:** Kevin · **P1** · Size M · Labels: `area-platform`, `gemini` · Blocked by: E-05, S-08 · PRD §7.3, FR-29
- Take E-05's QA renders plus the matching source frames. Gemini returns `pass`/`warn`/`fail`, notes (floaters, ghost people, sunk feet) and a suggested fog radius. Write the result into `manifest.qa`.
- **Acceptance:**
  - [ ] A deliberately broken world (wrong scale) gets `fail`.
  - [ ] A demo world gets `pass` or `warn`, with notes.

### EP-2 · Reconstruction & World Bounds

#### E-01 · Pipeline runner and stage interface
- **Owner:** Eric · **P0** · Size M · Labels: `area-recon`, `pipeline`, `gate-G2` · Blocked by: S-07 · PRD §7.2, FR-09, §9
- `pipeline/run.py --youtube-id <id> [--stages S0..S9] [--window a,b]`.
  - Each stage runs in its own conda environment as a subprocess, reads and writes `work/<id>/<stage>/`, writes a `done.json` with input hashes, and skips if that file is valid.
  - Stages emit JSON-line progress (`{"stage","pct","eta"}`).
  - Errors map to the enum in PRD §9.
- **Acceptance:**
  - [ ] A dummy two-stage run shows progress, skips on re-run, and reruns when an input changes.

#### E-02 · Cameras and depth (S3)
- **Owner:** Eric · **P0** · Size L · Labels: `area-recon`, `pipeline`, `gate-G2` · Blocked by: E-01, K-01 · PRD §7.2 S3, §13
- Run DA3 on keyframes at 5 fps, long edge 1280–1600 px, as one global solve if it fits in memory. Output poses, intrinsics and depth. Interpolate the poses to every frame (slerp/lerp). Reject clips where the intrinsics change (zoom).
- **Acceptance:**
  - [ ] On demo clip 1, the camera path looks right in a viser/Brush check.
  - [ ] There's a pose for every frame.

#### E-03 · World frame normalization and floor fit (S3b)
- **Owner:** Eric · **P0** · Size M · Labels: `area-recon`, `pipeline`, `gate-G2` · Blocked by: E-02 · PRD §8.1
- Fit the floor plane (RANSAC on back-projected depth points in the lower part of the image). Transform all cameras and depth so the floor is y = 0, +Y is up and units are metres. Convert to the three.js camera convention, row-major. Write `cameras.json` and `world_transform.json`.
- **Acceptance:**
  - [ ] The camera height above the floor is plausible (1.2–2.0 m for handheld).
  - [ ] Frame 0 projects correctly in the viewer test (with E-05).

#### E-04 · Background splat training (S4)
- **Owner:** Eric · **P0** · Size L · Labels: `area-recon`, `pipeline`, `gate-G2` · Blocked by: E-03, A-01 · PRD §7.2 S4, FR-12
- Train gsplat on the keyframes with the poses from E-03:
  - The union mask is excluded from **both** the RGB and the depth losses.
  - Use a depth prior from DA3, about 30k steps, and world-space normalization **off** (or save and apply its transform).
  - Crop the scene's bounding box. Export `world.ply`.
- **Acceptance:**
  - [ ] No ghost people baked into the splat.
  - [ ] Training takes 30 min or less on an A100 for a 60 s clip.

#### E-05 · Alignment check and QA renders
- **Owner:** Eric · **P0** · Size M · Labels: `area-recon`, `gate-G2` · Blocked by: E-04 · PRD §14 (G2)
- `pipeline/tools/align_check.py`:
  - render the splat at 10 evenly spaced camera poses, overlay the source frames and report PSNR/SSIM per frame, plus a contact sheet;
  - render 6–8 QA views (centre path plus ±1 m and ±20° offsets) for K-04 and human review.
- **Acceptance:**
  - [ ] Demo clip 1 passes visual alignment (this is the **G2 go/no-go**).
  - [ ] QA renders are written to `work/<id>/qa/`.

#### E-06 · Coverage, walk SDF, colliders (S5)
- **Owner:** Eric · **P0** · Size M · Labels: `area-recon`, `pipeline` · Blocked by: E-04 · PRD §8.4, §10.4
- Build a voxel grid with 10–20 cm cells:
  - Per frame, carve free space along depth rays and mark the surfaces.
  - Accumulate view count and angular spread, add splat density, and write `coverage.bin` (Uint8).
  - Walkable = seen, free up to eye height, within `fog.radius` of the camera path. Write a 2D signed distance field (negative inside) to `walk_sdf.bin`.
  - Write a coarse `colliders.glb` for obvious obstacles.
  - Pick the fog colour from the scene's average sky/ambient colour.
- **Acceptance:**
  - [ ] All §8.4 files are written.
  - [ ] A top-down debug PNG of the SDF plus the camera path looks right.
  - [ ] Sharib confirms the files load.

#### E-07 · LaMa fill for holes behind people
- **Owner:** Eric · **P1** · Size S · Labels: `area-recon`, `pipeline` · Blocked by: E-04, A-01 · PRD §7.2 S4
- For keyframes where the background behind a person was **never** observed in any frame, inpaint the masked area with LaMa and add it to training with low weight.
- **Acceptance:**
  - [ ] The person-shaped hole on demo clip 1 is filled with no new ghosting.

#### E-08 · Packaging and upload (S9a)
- **Owner:** Eric · **P0** · Size M · Labels: `area-recon`, `pipeline`, `gate-G4` · Blocked by: E-05, E-06 · Soft deps: A-06, A-08 (people optional) · PRD §8, FR-11
- Build the Spark LoD `world.rad` plus a `world.spz` fallback. Assemble the §8.2 layout, write `manifest.json` (credit, scene card, shots, people, unreconstructed, qa) and validate it against `docs/world-format.md`. Upload to `worlds/<id>/v<ver>/` with long cache headers.
- **Acceptance:**
  - [ ] The viewer loads a packaged real world from the CDN.
  - [ ] The package is 100 MB or less for a 60 s clip.

#### E-09 · Pose robustness for long shots
- **Owner:** Eric · **P1** · Size M · Labels: `area-recon`, `pipeline` · Blocked by: E-02 · PRD §7.2 rules, §13
- Use overlapping chunks (20% or more overlap) aligned with a similarity transform on shared frames when a global solve won't fit, with Pi3X as an alternative solver. Never stitch independent batches.
- **Acceptance:**
  - [ ] A 60 s clip solved in chunks shows no visible seam or jump in the camera path.

#### E-10 · Multi-shot worlds
- **Owner:** Eric · **P1** · Size M · Labels: `area-recon`, `pipeline` · Blocked by: E-08, K-03 · PRD §3 (Scene cuts), FR-25
- Run S2–S8 per usable shot (`s0/`, `s1/`, …). Shots that are too short or unusable go into `unreconstructed`. The manifest lists every shot.
- **Acceptance:**
  - [ ] A 2-shot test video produces two worlds in one manifest.

### EP-3 · People Pipeline

#### A-01 · Masks and instance tracks (S2)
- **Owner:** Adam · **P0** · Size L · Labels: `area-people`, `pipeline`, `gate-G2` · Blocked by: E-01, K-01 · Soft deps: K-03 (prompts; fall back to "person") · PRD §7.2 S2
- Run SAM 3 video segmentation with Gemini's nouns as prompts:
  - per-instance masks with stable IDs, labelled person or other;
  - a union mask dilated 10–20 px;
  - `tracks.json` holding per-instance frame ranges and boxes.
- **Acceptance:**
  - [ ] On demo clip 1, every visible person has a stable ID.
  - [ ] The union mask leaves no halo in E-04.

#### A-02 · Spike: choose the body tracker
- **Owner:** Adam · **P0** · Size M · Labels: `area-people`, `spike`, `gate-G3` · Blocked by: A-01 · PRD §7.2 S6, §13
- Compare GVHMR and Multi-HMR on one clip:
  - stability over 60 s;
  - handling of multiple people;
  - how well they work with our camera poses;
  - runtime and licence.

  Pick one and comment the decision and evidence on this ticket.
- **Acceptance:**
  - [ ] Decision recorded, plus a side-by-side render.

#### A-03 · Body tracking (S6a)
- **Owner:** Adam · **P0** · Size L · Labels: `area-people`, `pipeline`, `gate-G3` · Blocked by: A-02 · PRD §7.2 S6, FR-13
- SMPL-X parameters per person per frame, matched **one-to-one** with the SAM instances (mask IoU). Apply temporal smoothing. **No refinement of limbs against 2D keypoints.**
- **Acceptance:**
  - [ ] No ID switches on demo clip 1.
  - [ ] Lamps and other objects are never tracked as people.

#### A-04 · World placement and motion export (S6b)
- **Owner:** Adam · **P0** · Size M · Labels: `area-people`, `pipeline`, `gate-G3` · Blocked by: A-03, E-03 · PRD §8.4 (person.json), §13
- Transform from camera space to world space with `cameras.json`. Set each person's scale from a body-height prior plus the y = 0 floor. Pin the feet during foot contacts. Precompute the world-space joint transforms and write `motion.bin`, plus the `visible` ranges in `person.json`.
- **Acceptance:**
  - [ ] The feet stay within 5 cm of the floor during contacts.
  - [ ] When rendered from the original camera, the person overlaps their mask (IoU of 0.7 or more).

#### A-05 · Identity frame selection
- **Owner:** Adam · **P0** · Size S · Labels: `area-people`, `gemini` · Blocked by: A-01, S-08 · PRD §7.3, FR-28
- Pick the clearest front-facing, unoccluded frames for each person, with **crops restricted to that person's mask**. Gemini ranks the candidates; the fallback is the largest mask area.
- **Acceptance:**
  - [ ] A bystander's face is never picked.
  - [ ] Crops are saved for review.

#### A-06 · Avatars (S7)
- **Owner:** Adam · **P0** · Size L · Labels: `area-people`, `pipeline`, `gate-G3` · Blocked by: A-05, A-07 · PRD §7.2 S7, §8.4
- Build an LHM avatar per person (try LHM++ with several identity frames for better backs and sides). Export in the format A-07 chose (`avatar.*`, `skin.bin`) with a joint order that matches `motion.bin`.
- **Acceptance:**
  - [ ] The avatar is recognizable as the person from the front and the side.
  - [ ] The export loads in the A-07 prototype.

#### A-07 · Spike: animated avatar rendering in Spark on an M1 Air
- **Owner:** Adam · **P0** · Size M · Labels: `area-people`, `spike`, `gate-G3` · Blocked by: SH-01 · PRD §8.4, §10.8
- Prototype 3 animated LHM avatars in the viewer with Spark's skeletal splat animation (`splat-lbs`). Compare against a skinned GLB (`mesh-glb`) and a short PLY sequence. Measure fps on an M1 Air. Pick `avatar.kind`, then update PRD §8.4 in a PR.
- **Acceptance:**
  - [ ] Decision recorded with fps numbers.
  - [ ] PRD §8.4 updated.

#### A-08 · People layer video (S8)
- **Owner:** Adam · **P0** · Size M · Labels: `area-people`, `pipeline`, `gate-G3` · Blocked by: A-01, E-03 · PRD §8.4 (holo), FR-14
- Run Video Depth Anything per frame and fit scale/shift to DA3 depth on the keyframes. For every masked mover, encode inverse depth to 16–255 in the bottom half and RGB in the top half; everything else stays below 8. Write `holo.mp4` (1280×1440) and `holo.json` (near/far per frame).
- **Acceptance:**
  - [ ] No flicker in depth over 60 s.
  - [ ] The test world shader (A-10) shows the people in the right place.

### EP-4 · Viewer

#### SH-01 · Viewer scaffold and world loader
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer`, `gate-G1` · Blocked by: S-09, S-04 · PRD §7.4, §8, §10.8, FR-05
- Vite + TS + three.js + Spark. Route `/w/:youtubeId`:
  - Resolve `manifest.json` from `VITE_CDN_BASE_URL/worlds/<id>/v<ver>/`, or from the local `public/worlds/` copy.
  - Load `world.rad` with the LoD budget (1.5M by default, 2.5M on discrete GPUs), falling back to SPZ.
  - Show a loading state.
  - If the world isn't found, show "Not processed yet" (K-09 replaces this with the progress screen).
- **Acceptance:**
  - [ ] The test world renders.
  - [ ] First interactive frame in 3 s or less from localhost.

#### SH-02 · Master clock and layer sync bus
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer`, `gate-G1` · Blocked by: SH-01 · PRD §10.1, FR-15
- `<video>` plus a `requestVideoFrameCallback` loop publishing `{t, frame, shotId, playing}`. Includes the helper that keeps secondary videos (`holo.mp4`) slaved to the master. Audio unmutes on the first user gesture.
- **Acceptance:**
  - [ ] The test-world rectangle (holo) stays within 1 frame of the video over 60 s with repeated seeks.

#### SH-03 · Camera modes: ride-along, walk, return
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer` · Blocked by: SH-02 · PRD §10.2, FR-16–18
- Ride-along takes the pose and FOV from `cameras.json` and intrinsics. Walk mode uses pointer lock, WASD, mouse, Shift and an eye height of 1.6 m. R tweens back (400 ms) without seeking. C toggles ride-along. Any movement input leaves ride-along.
- **Acceptance:**
  - [ ] All modes behave as described in PRD §10.2 on the test world.

#### SH-04 · Video overlay at the original pose
- **Owner:** Sharib · **P0** · Size S · Labels: `area-viewer` · Blocked by: SH-03 · PRD §10.2, §10.5
- A plane filling the original camera frustum, textured with the video, with configurable opacity: 100% in ride-along, fading out in walk mode.
- **Acceptance:**
  - [ ] On a real world (after E-08), the overlay edges line up with the splat (no visible seam at the frame border).

#### SH-05 · Transport UI
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer` · Blocked by: SH-02 · PRD §10.7, FR-19
- A YouTube-style seek bar with hover thumbnails from the sprite. Play/pause (Space and button), ±5 s with the arrow keys, time display, loop at the end. Shot boundaries are marked on the bar.
- **Acceptance:**
  - [ ] Feels like YouTube.
  - [ ] Keyboard shortcuts work while the pointer is locked.

#### SH-06 · Scrub state machine
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer` · Blocked by: SH-04, SH-05 · PRD §10.3, FR-20, NFR-04
- Implement the PRD §10.3 table exactly: tween to the original pose on pointerdown, keep the camera locked to the path while dragging with the overlay on, then seek, re-sync layers on `seeked`, fade the overlay and resume in ride-along.
- **Acceptance:**
  - [ ] Overlay within 100 ms of starting a drag.
  - [ ] Resume within 500 ms of release.
  - [ ] Avatars never visibly snap.

#### SH-07 · Walk boundary
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer` · Blocked by: SH-03 · Soft deps: E-06 · PRD §10.4, FR-22
- Sample the walk SDF: damp velocity inside the 0.75 m margin, push along the gradient, slide on the tangent at the edge, and block on colliders. Eye height stays on the floor.
- **Acceptance:**
  - [ ] You can't leave the walkable area.
  - [ ] There's no jitter along the edge.

#### SH-08 · Fog rendering and F toggle
- **Owner:** Sharib · **P0** · Size L · Labels: `area-viewer` · Blocked by: SH-01 · Soft deps: E-06 · PRD §10.4, FR-21
- Per-splat coverage fade through Spark's splat-processing hook, plus a half-resolution height-and-coverage fog pass and the SDF distance term. Fog is local only, never a full-screen darken. F toggles it.
- **Acceptance:**
  - [ ] The world dissolves softly at its edges.
  - [ ] Fog on vs. off is a clear demo moment.
  - [ ] The frame-rate cost on an M1 Air is 5 ms or less.

#### SH-09 · Out-of-shot panel
- **Owner:** Sharib · **P0** · Size S · Labels: `area-viewer` · Blocked by: SH-02 · PRD §10.6, FR-25
- When `t` falls in `unreconstructed`, fade to fog and show the video on a floating panel, then restore the world when `t` re-enters the shot.
- **Acceptance:**
  - [ ] Works on a test manifest with an unreconstructed tail.

#### SH-10 · Multi-shot crossfade
- **Owner:** Sharib · **P1** · Size M · Labels: `area-viewer` · Blocked by: SH-09, E-10 · PRD §10.6
- At a cut: fog fade (300 ms), swap the world, then snap to the new shot's pose. Preload the next shot's world. Scrubbing across shots swaps under the overlay.
- **Acceptance:**
  - [ ] A 2-shot world plays and scrubs with no visible hitch.

#### SH-11 · Ghost camera path
- **Owner:** Sharib · **P1** · Size S · Labels: `area-viewer` · Blocked by: SH-03 · FR-30
- A faint line of the original camera path, with a marker at the current time. Visible in walk mode only.
- **Acceptance:**
  - [ ] Visible but subtle.
  - [ ] Hidden in ride-along.

#### SH-12 · HUD, scene card and creator credit
- **Owner:** Sharib · **P0** · Size S · Labels: `area-viewer` · Blocked by: SH-01 · FR-26, PRD §12
- Controls-hint overlay (dismissible), title, Gemini scene card on load, and the **creator credit always visible** in a corner.
- **Acceptance:**
  - [ ] Credit visible in every state.
  - [ ] Hint shown on first load.

#### SH-13 · Performance pass
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer`, `gate-G4` · Blocked by: SH-08, A-09 · PRD §10.8, NFR-02
- Cap DPR at 1.5, detect the GPU to set the LoD budget, run fog at half resolution and throttle avatar updates. Measure on an M1 Air and one integrated-GPU laptop with 3 avatars.
- **Acceptance:**
  - [ ] 45 fps or more on an M1 Air.
  - [ ] 30 fps or more on integrated GPUs.
  - [ ] Results posted on the ticket.

#### SH-17 · Playback speed
- **Owner:** Sharib · **P2** · Size S · Labels: `area-viewer` · Blocked by: SH-05 · FR-32
- 0.5×, 1×, 1.5× and 2× through `playbackRate`. Slaved videos follow.
- **Acceptance:**
  - [ ] Sync holds within 1 frame at every speed.

#### SH-18 · Spatial audio
- **Owner:** Sharib · **P2** · Size S · Labels: `area-viewer` · Blocked by: SH-03 · FR-32
- A Web Audio panner placed at the original camera position.
- **Acceptance:**
  - [ ] Audio pans as you walk around the camera path.

### EP-5 · People in the Viewer

#### A-09 · Animated avatars in the viewer
- **Owner:** Adam · **P0** · Size L · Labels: `area-people`, `area-viewer`, `gate-G3` · Blocked by: A-06, A-04, SH-02 · PRD §10.5, FR-23
- `web/src/people/avatars.ts` (in the format chosen in A-07):
  - pose from `motion.bin[frame]` on the clock bus;
  - hidden outside the `visible` ranges;
  - **hold the last pose at loop or end, and never interpolate across a seek**;
  - blob contact shadows.
- **Acceptance:**
  - [ ] Within 1 frame of the video.
  - [ ] No snap back to frame 0.
  - [ ] Feet on the floor.

#### A-10 · People layer shader
- **Owner:** Adam · **P0** · Size M · Labels: `area-people`, `area-viewer` · Blocked by: A-08, SH-02 · PRD §10.5, FR-14
- `web/src/people/holo.ts`:
  - a grid of about 256×144 displaced by `holo.mp4` depth and placed at `cameras[frame]`;
  - discard pixels below 8 and stretched triangles (depth ratio above 1.08).
- **Acceptance:**
  - [ ] From the original pose, people match the video overlay exactly.

#### A-11 · View-dependent blend
- **Owner:** Adam · **P1** · Size M · Labels: `area-people`, `area-viewer` · Blocked by: A-09, A-10 · PRD §10.5, FR-24
- Crossfade from the people layer to the avatars between 10° and 20° from the original camera ray (within 0.5 m). P0 behaviour before this ticket: a hard switch at 15°.
- **Acceptance:**
  - [ ] Walking off-axis gives a smooth transition with no double image.

### EP-6 · Backend & Hosting

#### K-06 · Static hosting for the web app and worlds
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform`, `gate-G4` · Blocked by: S-06, SH-01 · PRD §7.4, NFR-01
- Deploy the built `web/` to Vultr (Object Storage + CDN, or the VM with Caddy) over HTTPS, with an SPA fallback for `/w/*`. Worlds are served with immutable cache headers and CORS. Publish `gallery.json`.
- **Acceptance:**
  - [ ] The public URL loads a demo world within NFR-01.
  - [ ] `/w/<id>` deep links work.

#### K-07 · API: worlds and jobs
- **Owner:** Kevin · **P1** · Size M · Labels: `area-platform` · Blocked by: S-06 · PRD §9, FR-06–08
- FastAPI plus SQLite on the Vultr VM implementing PRD §9. Dedupe on `{youtubeId, pipelineVersion}`. Bearer token on `/internal/*`.
- **Acceptance:**
  - [ ] All §9 endpoints pass a curl test script checked into `server/`.

#### K-08 · GPU worker loop
- **Owner:** Kevin · **P1** · Size M · Labels: `area-platform`, `pipeline` · Blocked by: K-07, E-01, E-08 · PRD §7.4, §9
- `server/worker.py` on the GPU box: claim a job, run `pipeline/run.py`, forward the progress events, upload the package, then complete or fail with the reason enum.
- **Acceptance:**
  - [ ] Submitting a new clip through the API ends in a ready world with no manual steps.

#### K-09 · Progress screen
- **Owner:** Kevin · **P1** · Size S · Labels: `area-platform`, `area-viewer` · Blocked by: K-07, SH-01 · FR-07
- On a cache miss, the viewer calls `POST /api/worlds` and polls status every 2 s. It shows the stage list, percentage, ETA, the scene card once available, and a readable error. The world loads automatically when ready.
- **Acceptance:**
  - [ ] Works end to end with K-08.
  - [ ] Every error enum has a readable message.

### EP-7 · Extension & Landing

#### K-10 · Chrome extension: Step inside button
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform` · Blocked by: S-01 · PRD §4.1, FR-01–02
- MV3 with the content script on `youtube.com/*`. Insert the button next to Like in the watch-page actions area. Re-insert it on `yt-navigate-finish`/`popstate` and through a scoped `MutationObserver`. Insert only if it isn't already there. Fall back to finding Like by `aria-label`. Style it like YouTube's pill buttons. On click, open `/w/<id>?t=<currentTime>` in a new tab. No remote code, minimal permissions.
- **Acceptance:**
  - [ ] The button appears on 10 different videos with SPA navigation between them.
  - [ ] Never duplicated.
  - [ ] Opens the right URL.

#### K-11 · Landing page
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform` · Blocked by: S-01 · PRD §1, §4.2, FR-03–04
- `/` in `web/`: one-liner, link input (watch, youtu.be and shorts formats parsed to an ID), demo gallery with creator credits, a short "how it works" and an extension install note. Must match the viewer's visual style.
- **Acceptance:**
  - [ ] All URL formats route correctly.
  - [ ] Invalid input shows an error.
  - [ ] Gallery cards open worlds.

#### K-12 · Extension ready badge
- **Owner:** Kevin · **P2** · Size S · Labels: `area-platform` · Blocked by: K-10, K-06 · FR-31
- A HEAD request for the manifest on page load. Show a "Ready" dot on the button when the video is cached.
- **Acceptance:**
  - [ ] Correct for cached and uncached videos.

### EP-8 · Demo & Submission

#### K-05 · Demo clip shortlist and rights
- **Owner:** Kevin · **P0** · Size S · Labels: `area-platform`, `demo` · Blocked by: none · PRD §12
- Kevin hand-selects two clips that meet PRD §12: a walking vlog with 1–2 people and a scenic walk through a quiet park. Confirm each clip's rights (own, CC BY or written permission) and record its exact window and creator credit in `docs/clips.md`.
- **Acceptance:**
  - [ ] Two hand-selected clips with exact windows, rights and creator credits documented.
  - [ ] Eric agrees they're reconstructable (good camera motion).

#### E-11 · Bake the demo worlds
- **Owner:** Eric · **P0** · Size L · Labels: `area-recon`, `demo`, `gate-G4` · Blocked by: E-08, A-06, A-08, K-05 · Soft deps: K-04 · PRD §12, NFR-01/06/07
- Run both hand-selected clips end to end, review them with E-05/K-04, upload them, and add them to `gallery.json`. Record timings and cost per clip in `docs/demo-worlds.md` and the ledger.
- **Acceptance:**
  - [ ] Both worlds live on the CDN, each meeting NFR-01/02.
  - [ ] Timings recorded.

#### E-12 · Room-fill experiment (HY-World 2.0, then Marble)
- **Owner:** Eric · **P2** · Size M · Labels: `area-recon`, `experiment` · Blocked by: E-11 · PRD §3 (Marble), §11
- On one hero clip, try free HY-World 2.0 fill outside the observed coverage. **Only with team approval**, try one Marble 1.1 world (API credits, $5 or less, logged). Align the result and train it against the real frames. Mark the generated splats so they can be tinted. Compare with fog.
- **Acceptance:**
  - [ ] Side-by-side renders posted.
  - [ ] Team decides whether it goes in the demo.

#### SH-14 · Offline demo bundle and cache pre-warm
- **Owner:** Sharib · **P0** · Size S · Labels: `area-viewer`, `demo`, `gate-G4` · Blocked by: E-11 · PRD §7.4, NFR-01
- Copy both worlds into `web/public/worlds/`. One command serves the whole demo from localhost. Add a pre-warm script for the venue laptop.
- **Acceptance:**
  - [ ] The demo runs with Wi-Fi off.

#### SH-15 · Demo script, rehearsal and backup video
- **Owner:** Sharib · **P0** · Size M · Labels: `area-viewer`, `demo`, `gate-G5` · Blocked by: SH-14 · PRD §1, §4
- A 3-minute script:
  1. Click Step inside on YouTube.
  2. Ride along.
  3. Walk around the vlogger.
  4. Scrub (the camera glides back).
  5. Walk into the fog ("the camera never looked here"), F toggle.
  6. Gallery.

  Rehearse 3 times. Record a backup walkthrough video.
- **Acceptance:**
  - [ ] Script in `docs/demo.md`.
  - [ ] Backup video saved locally and in the shared drive.

#### K-13 · Devpost and sponsor write-ups
- **Owner:** Kevin · **P0** · Size M · Labels: `area-platform`, `demo`, `gate-G5` · Blocked by: E-11 · PRD §1, §7.3, §13
- The Devpost story: what it does, how we built it (pipeline diagram), the Orbis-informed choices (fog over hallucination), challenges and what's next. Separate sections for **Gemini** (director, identity, QA) and **Vultr** (GPU, storage, CDN, API). Screenshots, demo video link, licence and credit notes. Submit to Organizers' Choice, Overall, Gemini and Vultr (and Canada Life only if K-14 ships).
- **Acceptance:**
  - [ ] Submitted before the deadline.
  - [ ] Each sponsor section names concrete usage.

#### K-14 · Canada Life "Future Me" mode
- **Owner:** Kevin · **P2** · Size M · Labels: `area-platform`, `experiment` · Blocked by: E-11 · PRD §1
- Optional. In a dream-destination world, a Gemini goal card shows an estimated trip or move cost, a savings target and a monthly nudge, overlaid in the viewer. Only if every P0 is Done.
- **Acceptance:**
  - [ ] The card works on one demo world.
  - [ ] There's a pitch paragraph for the Canada Life judges.

---

## 6. Summary by owner

| Owner | P0 | P1 | P2 |
|---|---|---|---|
| Eric | S-03, S-07, S-09, E-01, E-02, E-03, E-04, E-05, E-06, E-08, E-11 | E-07, E-09, E-10 | E-12 |
| Adam | S-02, A-01, A-02, A-03, A-04, A-05, A-06, A-07, A-08, A-09, A-10 | A-11 | — |
| Sharib | S-04, SH-01, SH-02, SH-03, SH-04, SH-05, SH-06, SH-07, SH-08, SH-09, SH-12, SH-13, SH-14, SH-15 | SH-10, SH-11 | SH-17, SH-18 |
| Kevin | S-01, S-05, S-06, S-08, K-01, K-02, K-03, K-05, K-06, K-10, K-11, K-13 | K-04, K-07, K-08, K-09 | K-12, K-14 |

**Critical path to G2 (go/no-go):** S-07 → E-01 → K-01 → (A-01 alongside E-02 → E-03) → E-04 → E-05.
