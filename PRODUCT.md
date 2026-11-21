# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary (confirmed 2026-11-21): **Hack Western 13 judges**, seeing the project on the demo laptop or through the Devpost link during judging. They give each team a few minutes, so they need to understand the idea in seconds and get into a world fast.
Secondary (from PRD §4.1): YouTube viewers who click **Step inside** in the Chrome extension, or open a shared `/w/<youtubeId>` link.

## Product Purpose
Step Into the Video turns a YouTube video into a place you can walk around inside while the original video and audio play. The one-liner is *"Every video is a window. We turn it into a door."* (PRD §1). Success at the hackathon means judges step into a demo world, walk around the people in it, scrub the timeline and see the fog, and remember it. Prize targets: Organizers' Choice "Most Adventurous" (primary), Overall, MLH Best Use of Gemini, MLH Best Use of Vultr.

## Positioning
- **Honest reconstruction, not generation:** everything the camera saw is solid world, and everything it never saw is **fog**. Nothing unfilmed is invented. Generative novel-view models were rejected (PRD §2, §13).
- **The original video stays in charge:** it is the clock, and scrubbing glides you back to exactly where the camera stood.
- **People are walk-around avatars** blended with real video pixels.
- The fog is the "discover the unknown" theme made literal.

## Operating Context
- Entry points: the **Step inside** button next to Like on youtube.com (MV3 extension), the landing page at `/` (paste a link, or pick a demo world from the gallery), and direct `/w/<youtubeId>` links.
- A cache hit opens instantly. With no cache, P0 shows "Not processed yet"; P1 adds a progress screen.
- Desktop Chrome, keyboard and mouse. The demo laptop may run offline from a local bundle (SH-14).

## Capabilities and Constraints
- Stack: existing **Vite + TypeScript + three.js + Spark** app in `web/`. `/` routes to the landing page and everything else to the viewer (`web/src/entry.ts`).
- URL input accepts watch, youtu.be and Shorts links (`web/src/youtube.ts`). Invalid input shows an inline error (FR-03).
- The gallery reads `web/public/gallery.json` (`[{youtubeId, title, thumb, credit}]`, PRD §9). It must show title, thumbnail and **creator credit** (FR-04, §12).
- MVP processes a window of 60 s or less of a single continuous shot. Desktop only; no mobile or VR (PRD §2 non-goals).
- The landing page itself must stay light: no heavy 3D on the page (the demo laptop also has to run the viewer).

## Brand Commitments
- Name: **Step Into the Video**. One-liner: **"Every video is a window. We turn it into a door."** The extension button label is **Step inside**.
- The viewer is black, with light type and a YouTube-red (`#e33`) accent on the transport. The landing page must feel like the same product (K-11).

## Evidence on Hand
- **Two demo clips** (Kevin's uploads, `docs/clips.md`): a walking vlog with 1–2 people, and a quiet park walk. Their worlds are **not baked yet**, their links and credits are pending, and `gallery.json` is `[]`.
- **No real screenshots, renders or video of worlds exist yet.** Adam will supply real captures once worlds are baked. Until then the page uses clearly empty slots. Never fabricate world imagery, user counts, testimonials or benchmark numbers.
- The technical story (shot detection, DA3 cameras, gsplat, SAM 3 masks, GVHMR bodies, LHM avatars, Gemini director, Vultr hosting) is real and documented in `docs/`.

## Product Principles
1. **Never invent what wasn't filmed:** in the product, and in the marketing (no fake renders).
2. **Seconds to wonder:** a judge should get the idea and reach a world within one screen.
3. **The video is the source of truth:** show the original video's role, not a replacement for it.
4. **Credit creators** wherever their footage appears.

## Accessibility & Inclusion
No product-specific standard has been set. Follow WCAG AA for the landing page: contrast, a labelled input, and a visible focus state.
