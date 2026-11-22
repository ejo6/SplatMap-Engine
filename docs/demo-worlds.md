# Demo worlds

Packaged worlds live in `worlds/<id>/v1/`. Only `9lY7iZl1KbI` is committed. Every other world folder is
git-ignored (`/worlds/*` in `.gitignore`, KAN-89) because each one adds 40–220 MB to the repo history for good.
Share them outside git: copy the folder from the GPU box or a teammate into `worlds/`. Then
`cd web && npm i && npm run dev` and open `http://localhost:5173/w/<id>`. `web/public/worlds` is a symlink to
the repo-root `worlds/`.

A world folder needs only what the viewer loads: `manifest.json`, `video.mp4`, `thumbs.jpg/json`,
`s0/cameras.json` and `s0/world.rad`, plus the S5 bounds and people files when present.
`pipeline/s9_package.py` builds the folder. Sources, frames and the training `world.ply` stay in `work/`.

| ID | Title | In git | Notes |
|---|---|---|---|
| `9lY7iZl1KbI` | Misty forest path | yes | No people. G2 alignment PSNR 27.6 / SSIM 0.89 (KAN-30) |
| `2KanGOaQjZI` | Snowy summit climb | no | No people |
| `2PBXchYQdao` | Modern living room | no | No people |
| `CEl6P5wo6ro` | Dark hallway | no | No people |
| `CThxyXWWqA0` | Hilltop overlook | no | 10 people, holo layer |

These five are in `web/public/gallery.json`, the source for the landing and `/unavailable` carousels.
A world that isn't on disk still shows in the carousel with its YouTube cover, but its `/w/<id>` link
won't load. Kept out of the gallery:
- `2PBXchYQdao-atlas`: a second build of the same youtubeId. The viewer resolves `/w/<id>` by youtubeId, so this folder can't be reached.
- `IMG_*`: local uploads, not YouTube videos.
- `test`: the G1 fixture (`docs/world-format.md`).
- `bedroom`: a people-layer test clip.

**Landing and /unavailable (KAN-88).** No new videos are processed for the demo. The landing form opens `/w/<id>`
only if `<id>` is in `gallery.json`; any other valid link goes to `/unavailable` ("The GPU cluster is unavailable").
Both pages show `gallery.json` as a rotating carousel (`web/src/carousel.ts`). Each slide uses YouTube's 1280×720
`maxresdefault.jpg` and falls back to the world's `thumb.jpg`. To add a world to both, put its folder in `worlds/`
(not committed) and add one entry to `gallery.json`.

### Checking spatial audio in desktop Chrome

Open a world with an audible soundtrack and use headphones. Click the viewer to enable sound and capture the mouse. Ride-along uses the original stereo mix. Face along the recorded path and strafe right with D. The soundtrack should move toward the left ear. Turn around in place and the bearing should reverse. Press R to return to the recorded camera and restore the original mix. Seek to another time and repeat. Audio follows the master video through pauses, seeks, and loops. Unreconstructed intervals use the original mix.

The whole soundtrack is one source at the current recorded camera. The first half metre away blends from stereo into directional audio. Distance does not reduce the volume. CDN video files must permit anonymous CORS access from the viewer origin.
