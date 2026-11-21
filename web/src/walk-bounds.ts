import * as THREE from 'three';

// SH-07: walk boundary (PRD §10.4, FR-22). Sample the walk SDF: damp velocity inside the
// 0.75 m margin, push along the gradient, slide on the tangent at the edge, block on colliders.

export const WALK_MARGIN = 0.75; // metres, PRD §10.4
const PUSH_SPEED = 0.6; // m/s, a gentle inward nudge while inside the margin
const COLLIDER_RADIUS = 0.3; // metres, stop this far short of a collider mesh

export interface WalkSdfGrid {
  /** Float32, row-major (rows along z, columns along x). Negative = walkable (PRD §8.4). */
  data: Float32Array;
  origin: [number, number]; // world (x, z) of cell (0, 0)
  cellSize: number;
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinear-sampled signed distance (metres) at a world (x, z); clamped to the grid edge beyond its bounds. */
export function sampleSdf(grid: WalkSdfGrid, x: number, z: number): number {
  const gx = (x - grid.origin[0]) / grid.cellSize - 0.5;
  const gz = (z - grid.origin[1]) / grid.cellSize - 0.5;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = gx - x0;
  const tz = gz - z0;
  const at = (ix: number, iz: number) => {
    const cx = clamp(ix, 0, grid.width - 1);
    const cz = clamp(iz, 0, grid.height - 1);
    return grid.data[cz * grid.width + cx];
  };
  const v0 = lerp(at(x0, z0), at(x0 + 1, z0), tx);
  const v1 = lerp(at(x0, z0 + 1), at(x0 + 1, z0 + 1), tx);
  return lerp(v0, v1, tz);
}

/** Normalized gradient of the SDF at (x, z), via central differences. Points outward (toward higher sdf). */
export function sdfGradient(grid: WalkSdfGrid, x: number, z: number): Vec2 {
  const h = grid.cellSize;
  const dx = (sampleSdf(grid, x + h, z) - sampleSdf(grid, x - h, z)) / (2 * h);
  const dz = (sampleSdf(grid, x, z + h) - sampleSdf(grid, x, z - h)) / (2 * h);
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

/**
 * PRD §10.4 Movement: sample the SDF at the proposed position.
 * - Inside the 0.75 m margin: scale velocity by clamp(-sdf / 0.75, 0, 1) and push along the gradient.
 * - At sdf >= 0: project the velocity onto the boundary tangent (slide, never a hard stop).
 * Returns the adjusted (x, z) displacement for this tick; `desired` is unchanged if there's no grid.
 */
export function resolveWalkMove(grid: WalkSdfGrid | undefined, pos: Vec2, desired: Vec2, dtSeconds: number): Vec2 {
  if (!grid || (desired.x === 0 && desired.z === 0)) return desired;

  const proposed = { x: pos.x + desired.x, z: pos.z + desired.z };
  const s = sampleSdf(grid, proposed.x, proposed.z);
  const grad = sdfGradient(grid, proposed.x, proposed.z);

  if (s >= 0) {
    const along = desired.x * grad.x + desired.z * grad.z;
    return { x: desired.x - along * grad.x, z: desired.z - along * grad.z };
  }

  const factor = clamp(-s / WALK_MARGIN, 0, 1);
  const push = PUSH_SPEED * dtSeconds * (1 - factor);
  return {
    x: desired.x * factor - grad.x * push,
    z: desired.z * factor - grad.z * push,
  };
}

/** Colliders block movement (PRD §10.4): clamps a horizontal move to stop short of any collider mesh. */
export function clampMoveForColliders(colliders: THREE.Object3D[], origin: THREE.Vector3, move: THREE.Vector3): THREE.Vector3 {
  const distance = move.length();
  if (distance < 1e-9 || colliders.length === 0) return move;

  const direction = move.clone().normalize();
  const raycaster = new THREE.Raycaster(origin, direction, 0, distance + COLLIDER_RADIUS);
  const hits = raycaster.intersectObjects(colliders, true);
  if (hits.length === 0) return move;

  const clearDistance = Math.max(hits[0].distance - COLLIDER_RADIUS, 0);
  if (clearDistance >= distance) return move;
  return direction.multiplyScalar(clearDistance);
}
