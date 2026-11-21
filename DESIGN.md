---
name: Step Into the Video
description: Every video is a window. We turn it into a door.
colors:
  glacier: "#17808f"
  glacier-pale: "#d3e7e8"
  trail-red: "#e33b30"
  trail-red-deep: "#c42d23"
  alarm-red: "#a5231b"
  snow: "#f4f8f7"
  spruce-ink: "#0d2a33"
  spruce-ink-soft: "#36545d"
  lake-deep: "#2f5862"
  lake-shade: "#06242c"
  white: "#ffffff"
typography:
  display:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "clamp(3.1rem, 7.2vw, 6rem)"
    fontWeight: 720
    lineHeight: 0.96
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "clamp(2.2rem, 4.4vw, 3.7rem)"
    fontWeight: 720
    lineHeight: 1
    letterSpacing: "-0.032em"
  tagline:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "clamp(1.7rem, 3.1vw, 2.7rem)"
    fontWeight: 680
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  numeral:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "clamp(2.6rem, 4.4vw, 3.8rem)"
    fontWeight: 760
    lineHeight: 1
  title:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "1.45rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  lede:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Bricolage Grotesque Variable', 'Avenir Next', 'Segoe UI', sans-serif"
    fontSize: "1.05rem"
    fontWeight: 680
    lineHeight: 1
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.9em"
    fontWeight: 500
    lineHeight: 1
rounded:
  focus: "4px"
  code: "5px"
  notice: "8px"
  button: "10px"
  frame: "14px"
  panel: "20px"
  full: "50%"
spacing:
  gutter: "clamp(20px, 6vw, 96px)"
  band: "clamp(80px, 10vw, 148px)"
  section-gap: "48px"
  grid-gap: "36px 28px"
components:
  button-primary:
    backgroundColor: "{colors.trail-red}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.trail-red-deep}"
  input-waterline:
    backgroundColor: "{colors.white}"
    textColor: "{colors.spruce-ink}"
    rounded: "{rounded.frame}"
    padding: "6px"
    height: "54px"
  world-card-image:
    backgroundColor: "{colors.glacier-pale}"
    rounded: "{rounded.frame}"
  notice-error:
    backgroundColor: "{colors.white}"
    textColor: "{colors.alarm-red}"
    rounded: "{rounded.notice}"
    padding: "8px 12px"
  code-chip:
    backgroundColor: "{colors.glacier-pale}"
    textColor: "{colors.spruce-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.code}"
    padding: "0.18em 0.42em"
  panel:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.panel}"
    padding: "32px"
---

# Design System: Step Into the Video

## Overview

**Creative North Star: "The Mirror Lake"**

A bright alpine lake at dawn, photographed, not illustrated. The real Moraine Lake photograph (Unsplash, Redd Francisco, credited on the page and in the footer) is the ground the page stands on. The lake's reflection stands for the flat video; the land above the waterline is the world. The waterline is the threshold between them, and it is the system's one recurring idea: the link field sits on it in the hero, and it returns as the divider between every section below.

Below the hero the page goes to snow: a cool near-white ground with deep spruce-navy ink, glacier turquoise for line work and markers, and a single YouTube-adjacent red reserved for the one action. Density is low and calm; sections breathe with large vertical padding and big, tight-tracked grotesk headings. Depth comes from the photo and soft ambient shadows, never from hard edges.

Motion is water and ascent: the pointer stirs the reflection (an SVG turbulence/displacement filter that settles back to a slow swell), a valid link floats that video's own thumbnail on the water as a mirrored echo, and submitting rises through the waterline into the peaks and fades to black, the colour of the viewer it opens. Everything that moves is dropped under `prefers-reduced-motion`.

**Key Characteristics:**
- Real photograph as ground; the waterline is measured from the photo, not guessed.
- Snow ground, spruce-navy ink, glacier line work, one red action.
- One variable grotesk (Bricolage Grotesque) for everything, heavy and tight at display sizes.
- The waterline divider recurs between sections; trails and ridgelines are drawn as line work.
- Empty states are mist, the same fog the worlds use where nothing was filmed.

## Colors

Daylight alpine: cool snow and glacier water carried by a deep spruce-navy ink, with one warm red as the only call to act.

### Primary
- **Glacier Turquoise** (glacier): focus rings, text selection, trail numerals, waypoint rings, list markers, the ripple tint in the waterline divider. The structural accent: lines and markers, never fills of large areas.
- **Glacier Mist** (glacier-pale): code/kbd chips, image placeholders, the pale end of mist gradients.

### Secondary
- **Trail Red** (trail-red): the single primary action ("Step inside"), the input caret, the invalid-input wavy underline, the outline that marks the real extension button. Darkens to **Trail Red Deep** (trail-red-deep) on hover.
- **Alarm Red** (alarm-red): error text on a white notice; darker than Trail Red so it passes contrast as text.

### Neutral
- **Snow** (snow): the page ground below the lake, waypoint fills.
- **Spruce Ink** (spruce-ink): all headings and body text, the waterline hairline, the ridgeline stroke.
- **Spruce Ink Soft** (spruce-ink-soft): ledes, captions, step copy, footer.
- **Lake Deep** (lake-deep): the lake colour behind the hero, visible only if the ripple opens a sub-pixel gap.
- **Lake Shade** (lake-shade): the base of every translucent shade on the photo (the reflection's deepening gradient at 0.2 to 0.58 alpha, text shadows on white type, ambient shadows).
- **White** (white): the link field, the error notice, the extension panel, and type set on the reflection.

### Named Rules
**The One Red Rule.** Trail Red marks the single action and the things that point at it (caret, invalid state, the real extension button). It never decorates, never fills a section, never appears twice as a button on one screen.

**The Lake-Shade Rule.** Every shadow and every darkening on the photo is Lake Shade at partial alpha, never neutral black. The one exception is the rise transition, which ends in pure black to hand off to the viewer.

## Typography

**Display Font:** Bricolage Grotesque Variable (with Avenir Next, Segoe UI, sans-serif), optical sizing on.
**Body Font:** the same family.
**Label/Mono Font:** ui-monospace / SF Mono / Menlo for code and keys only.

**Character:** One characterful variable grotesk does all the work; hierarchy comes from weight (400 to 760) and tracking (down to -0.032em at headline size), not from a second family.

### Hierarchy
- **Display** (720, clamp 3.1 to 6rem, 0.96): the hero headline only, centred on the mirror axis in the sky, two lines, max 11.5ch.
- **Headline** (720, clamp 2.2 to 3.7rem, 1): section headings.
- **Tagline** (680, clamp 1.7 to 2.7rem, 1.05): the white line set on the reflection under the field ("We turn it into a door.").
- **Numeral** (760, clamp 2.6 to 3.8rem, 1): trail step numbers, in Glacier.
- **Title** (700, 1.45rem, 1.15): step titles; world-card titles run at 680 / 1.3rem.
- **Lede** (400, 1.15rem, 1.6): section intros, max 58ch, Spruce Ink Soft.
- **Body** (400, 1.0625rem, 1.6): running copy, 38 to 60ch measures.
- **Label** (680, 1.05rem, 1): the primary button; the brand mark runs at 720 / 1.12rem, nav at 560 / 0.98rem.

### Named Rules
**The One Family Rule.** Bricolage Grotesque carries display, body and labels. Monospace is allowed only inside code and kbd chips.

**The Tight-At-Size Rule.** Tracking tightens as size grows: -0.02em at display and titles, -0.025em at tagline, -0.032em at headline. Body text stays at 0.

## Layout

A single column of full-width bands with a fluid side gutter (clamp 20px to 96px) and fluid vertical padding (clamp 80px to 148px). The hero is one full-bleed viewport (100svh, 620px min, 1100px max) composed on the mirror axis: headline centred in the sky, the field centred exactly on the waterline (computed from the photo's measured lake edge at 60.6% of its height under cover fit), the tagline and hint below it on the reflection, credit bottom right.

Below the hero: the gallery is an auto-fill grid of 340px-minimum 16:9 frames (gap 36px by 28px); "how it works" is three equal columns hung from a ridgeline SVG with waypoints on its vertices; the fog section is a split of copy on snow over a photo that dissolves into haze; the extension section is a 1.1fr / 1fr two-column grid. At 760px and below the ridge is hidden and the trail becomes a vertical line with waypoint dots, grids collapse to one column, the fog photo stacks under its copy, and the nav keeps only its first link. At 1100px and below the hero's thumbnail echo is hidden.

### Named Rules
**The Waterline Rule.** The waterline is computed, not placed: anything that sits on the threshold reads its position from the photo's measured lake edge. Between sections it recurs as a Spruce Ink hairline with a faint Glacier ripple fading beneath it, inset to the gutter and feathered at both ends.

## Elevation & Depth

Depth is atmospheric: the photograph, a gradient that deepens the reflection toward the viewer, and soft ambient shadows tinted with Lake Shade. Nothing has a hard or offset shadow. Surfaces on snow are flat; only things floating over the photo (the field) or presented as objects (the extension panel, kbd keys) lift.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 14px 34px -14px rgba(6, 36, 44, 0.55), 0 2px 6px rgba(6, 36, 44, 0.12)`): the link field resting on the water.
- **Panel** (`box-shadow: 0 18px 44px -24px rgba(6, 36, 44, 0.5)`): a white presentation panel on snow.
- **Key** (`box-shadow: inset 0 -1px 0 #a9c9cb, 0 1px 2px rgba(13, 42, 51, 0.18)`): kbd keys.
- **Legibility** (`text-shadow: 0 2px 14px rgba(4, 28, 36, 0.4)` and lighter variants): white type on the reflection or photo only.

### Named Rules
**The Atmosphere-Not-Edges Rule.** Depth comes from light, water and haze. Shadows are long, soft and Lake-Shade tinted; text shadows exist only to seat white type on the photograph.

## Shapes

Gently rounded, never pill-shaped for house components: 10px on the button inside a 14px field, 14px on image frames and mist slots, 18 to 20px on larger panels, 5px on code chips. Circles appear only as waypoints (14px, 3px Glacier ring on Snow). Line work (ridgeline, waterline, trail stems) is 1 to 2px, round-joined, non-scaling. Empty states use a 1.5px dashed mist border.

## Components

### Buttons
Single, warm, decisive: there is one.
- **Shape:** gently rounded (10px), nested inside the field's 6px padding.
- **Primary:** Trail Red fill, white Label type, 0 24px padding, full field height.
- **Hover / Focus:** darkens to Trail Red Deep (160ms ease-out); presses down 1px on active; focus is carried by the field's Glacier ring.

### Inputs / Fields
**The waterline field.** A white bar (14px radius, 6px padding) floating on the water with the Float shadow, input and button side by side. Input text 500 / 1.08rem in Spruce Ink, placeholder #557078, caret Trail Red.
- **Focus:** the whole field takes a 3px Glacier outline at 3px offset; the input's own outline is suppressed.
- **Error:** the input gets a wavy Trail Red underline and an Alarm Red message appears in a white 8px-radius notice below; the message is a live alert.

### Cards / Containers
- **World card:** a link with a 16:9 image in a 14px frame (Glacier Mist placeholder), title at 680 / 1.3rem, credit "Video by ..." in Spruce Ink Soft. Hover lifts the image 3px (300ms, cubic-bezier(0.2, 0.7, 0.15, 1)).
- **Mist slot:** an empty 16:9 frame filled with layered white radial mists over a pale glacier gradient, followed by an honest note. Used wherever real content is not ready yet.
- **Panel:** white, 20px radius, 32px padding, Panel shadow, for presenting an object (the extension's button row).

### Navigation
Slim header absolutely set into the sky: brand mark left (720 / 1.12rem), section links right (560 / 0.98rem, gap clamp 14 to 34px), no underline until hover. Links elsewhere underline at 1px with a 0.22em offset, thickening to 2px on hover. On phones only the first nav link remains. The header fades out with the rise.

### Waypoint Trail (signature)
Steps drawn as a hike: a Spruce Ink ridgeline across the section with Glacier-ringed waypoints on its vertices, each dropping a fading Glacier stem to its numbered step below. On phones it becomes a 2px vertical trail line with waypoint dots beside each step.

### Waterline Hero (signature)
Photo, mirrored reflection clipped at the waterline under a rippling SVG displacement filter, deepening shade, centred headline, field on the line, white tagline and hint below, credit. A valid link floats its thumbnail on the water as a feathered, flipped echo at 0.55 opacity. Submit scales the photo up (720ms) as the reflection and copy fade, ending in black.

## Do's and Don'ts

### Do:
- **Do** use real, credited photography as ground, with provenance recorded beside each shipped raster.
- **Do** put the one action on Trail Red (#e33b30) and keep every other accent Glacier (#17808f).
- **Do** separate sections with the waterline divider: Spruce Ink hairline, faint Glacier ripple, feathered ends, inset to the gutter.
- **Do** fill unready content slots with mist and say plainly what is coming.
- **Do** tint every shadow and photo shade with Lake Shade, and seat white type on the photo with a soft text shadow.
- **Do** honour reduced motion: no ripple, no rise, no transitions.

### Don't:
- **Don't** fabricate world imagery, renders, counts or testimonials; empty is mist, not a mock.
- **Don't** use a second display family or a system face for headings.
- **Don't** use hard or offset shadows, or neutral black shading on the photo (the end of the rise is the only black).
- **Don't** add a second red button or use red decoratively.
- **Don't** set display type over the cliff faces of the photo; keep it in open sky on the mirror axis.

## Known Divergence

The 3D viewer (`web/src/main.ts`, `web/src/style.css`) is a separate, older surface: black ground, light type, `#e33` YouTube-red transport accent. It does not yet follow this world and has not been restyled. The landing's rise transition deliberately ends in black to bridge into it. Trail Red (#e33b30) is close to but not identical with the viewer's #e33.
