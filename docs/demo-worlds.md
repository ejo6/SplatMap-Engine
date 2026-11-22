# Demo worlds

Packaged worlds live in `worlds/<id>/v1/` and **are committed**, so a fresh clone can open them:
`cd web && npm i && npm run dev`, then `http://localhost:5173/w/<id>`. `web/public/worlds` is a
symlink to the repo-root `worlds/`.

Commit only what the viewer loads: `manifest.json`, `video.mp4`, `thumbs.jpg/json`, `s0/cameras.json`,
`s0/world.rad`, plus the S5 bounds and people files when present. `pipeline/s9_package.py` builds the folder; `world.spz` is git-ignored. Sources, frames and the training `world.ply` stay
in `work/` (git-ignored; `*.ply` is also ignored under `worlds/`). Each world adds about 60 MB to the
repo history for good, so re-commit a world only when it really changed.

| ID | Title | Source | Size | Notes |
|---|---|---|---|---|
| `9lY7iZl1KbI` | Misty forest path | YouTube, 0–30 s | 62 MB | No people. G2 alignment PSNR 27.6 / SSIM 0.89 (KAN-30) |
