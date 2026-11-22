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
| `SJZnVmv_8Ns` | Snowy ridge traverse | no | 1 person |
| `evADsZV13gc` | Cathedral nave | no | 6 people |
| `h357f076SRw` | Mossy forest trail | no | 1 person |
| `IMG_6713` | Study room 360 | no | 1 person |
| `IMG_6714` | Study room walkaround | no | No people |
| `IMG_6716` | Lounge chair spin | no | 3 people |
| `IMG_6719` | Meeting room corner | no | 5 people |
| `IMG_6722` | Fourth floor hallway | no | 5 people |
| `IMG_6723` | Hallway hangout | no | 17 people |

**What the carousel shows (KAN-93).** The landing and `/unavailable` carousels list the world folders that are
actually on *your* machine: every `worlds/<folder>/v1/manifest.json`. This list comes from `/worlds-index.json`, which
`web/vite.config.ts` serves in dev (re-read on every request, so a copied-in world appears on refresh) and writes into
the build. Each card links to `/w/<folder>`, which the viewer resolves to `worlds/<folder>/v1/`. Any folder name
works, including `IMG_*` uploads and renamed copies such as `IMG_6719000`.

- **Cover:** for an 11-character YouTube id, YouTube's 1280×720 `maxresdefault.jpg`; otherwise (or when YouTube has
  no maxres cover) a frame at 0.5 s of the world's own `video.mp4`. No `thumb.jpg` is needed.
- **Title and credit:** from the `gallery.json` entry whose `youtubeId` matches the folder name or the manifest's
  `youtubeId`; otherwise the manifest's `title` and credit. `gallery.json` order puts curated worlds first.
- **Left out:** `worlds/test/` (the G1 fixture), folders without `v1/manifest.json`, and an alternate build such as
  `2PBXchYQdao-atlas` when the folder named for its `youtubeId` also exists.

**Landing and /unavailable (KAN-88).** No new videos are processed for the demo. The landing form opens `/w/<id>`
only if `<id>` is one of the worlds on disk; any other valid link goes to `/unavailable` ("The GPU cluster is
unavailable"). To add a world, copy its folder into `worlds/` (not committed); to give it a nicer title, add an
entry to `gallery.json`.

### Checking spatial audio in desktop Chrome

Open a world with an audible soundtrack and use headphones. Click the viewer to enable sound and capture the mouse. Ride-along uses the original stereo mix. Face along the recorded path and strafe right with D. The soundtrack should move toward the left ear. Turn around in place and the bearing should reverse. Press R to return to the recorded camera and restore the original mix. Seek to another time and repeat. Audio follows the master video through pauses, seeks, and loops. Unreconstructed intervals use the original mix.

The whole soundtrack is one source at the current recorded camera. The first half metre away blends from stereo into directional audio. Distance does not reduce the volume. CDN video files must permit anonymous CORS access from the viewer origin.
