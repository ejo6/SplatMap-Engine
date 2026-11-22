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

`9lY7iZl1KbI` has a `thumb.jpg` (cropped from `thumbs.json`'s first sprite tile) referenced by
`web/public/gallery.json` for the landing page gallery (FR-04, KAN-83). `worlds/test/` (gate G1,
see `docs/world-format.md`) is a git-ignored local fixture, so it's left out of the committed
gallery — it would 404 on anyone else's clone.

**Landing and /unavailable (KAN-88).** No new videos are processed for the demo. The landing form opens `/w/<id>`
only if `<id>` is in `gallery.json`; any other valid link goes to `/unavailable` ("The GPU cluster is unavailable").
Both pages show `gallery.json` as a rotating carousel (`web/src/carousel.ts`). Each slide uses YouTube's 1280×720
`maxresdefault.jpg` and falls back to the world's `thumb.jpg`. To add a world to both, commit it under `worlds/`
and add one entry to `gallery.json`.

### Checking spatial audio in desktop Chrome

Open a world with an audible soundtrack and use headphones. Click the viewer to enable sound and capture the mouse. Ride-along uses the original stereo mix. Face along the recorded path and strafe right with D. The soundtrack should move toward the left ear. Turn around in place and the bearing should reverse. Press R to return to the recorded camera and restore the original mix. Seek to another time and repeat. Audio follows the master video through pauses, seeks, and loops. Unreconstructed intervals use the original mix.

The whole soundtrack is one source at the current recorded camera. The first half metre away blends from stereo into directional audio. Distance does not reduce the volume. CDN video files must permit anonymous CORS access from the viewer origin.
