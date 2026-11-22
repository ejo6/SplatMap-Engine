// A-11 / KAN-61: view-dependent blend between the people layer and the avatars (PRD §10.5, FR-24).
// No imports so node --test can load it directly.

const FADE_START_DEG = 10; // at or below: people layer only (real pixels)
const FADE_END_DEG = 20; // at or above: avatars only
const DIST_START_M = 0.4; // the people layer is only valid within ~0.5 m of the original camera,
const DIST_END_M = 0.5; // so fade over a short band there instead of popping

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Avatar weight in [0, 1] for a viewer `angleDeg` off the original view direction and `distM` from its position.
 *  The people layer gets 1 - weight. */
export function avatarWeight(angleDeg: number, distM: number): number {
  return Math.max(smoothstep(FADE_START_DEG, FADE_END_DEG, angleDeg), smoothstep(DIST_START_M, DIST_END_M, distM));
}

/** KAN-85: whether to show the avatars, given whether they're shown now and the view's `avatarWeight`.
 *  Hysteresis: swap to avatars past the middle of the band, and back only once fully inside the real-pixel zone,
 *  so walking along the edge doesn't flicker and the two never sit half-blended for long. */
export function showAvatars(showing: boolean, weight: number): boolean {
  return showing ? weight > 0 : weight >= 0.5;
}
