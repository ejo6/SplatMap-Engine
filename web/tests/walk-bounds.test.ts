// Run: cd web && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clampMoveForColliders, resolveWalkMove, sampleSdf, sdfGradient, WALK_MARGIN, type WalkSdfGrid } from '../src/walk-bounds.ts';

/** A circular walkable area of `radius` m, centered at the origin, matching the S-09 test fixture's convention. */
function circleGrid(radius: number): WalkSdfGrid {
  const origin: [number, number] = [-10, -10];
  const cellSize = 0.1;
  const width = 200;
  const height = 200;
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = origin[0] + (col + 0.5) * cellSize;
      const z = origin[1] + (row + 0.5) * cellSize;
      data[row * width + col] = Math.hypot(x, z) - radius;
    }
  }
  return { data, origin, cellSize, width, height };
}

test('sampleSdf is negative inside the circle and positive outside it', () => {
  const grid = circleGrid(4);
  assert.ok(sampleSdf(grid, 0, 0) < -3.9);
  assert.ok(Math.abs(sampleSdf(grid, 4, 0)) < 0.05);
  assert.ok(sampleSdf(grid, 6, 0) > 1.9);
});

test('sdfGradient points outward (away from the walkable center)', () => {
  const grid = circleGrid(4);
  const g = sdfGradient(grid, 3, 0);
  assert.ok(g.x > 0.9); // pointing in +x, away from the center
  assert.ok(Math.abs(g.z) < 0.1);
});

test('deep inside the margin, movement is unaffected', () => {
  const grid = circleGrid(4);
  const desired = { x: 0.05, z: 0 };
  const result = resolveWalkMove(grid, { x: 0, z: 0 }, desired, 1 / 60);
  assert.ok(Math.abs(result.x - desired.x) < 1e-6);
  assert.equal(result.z, 0);
});

test('inside the margin, velocity damps toward the edge and gets a gentle inward push', () => {
  const grid = circleGrid(4);
  // At x = 3.6, sdf = -0.4, inside the 0.75m margin -> damped below full speed.
  const desired = { x: 0.1, z: 0 };
  const result = resolveWalkMove(grid, { x: 3.6, z: 0 }, desired, 1 / 60);
  assert.ok(result.x > 0 && result.x < desired.x); // damped, not stopped
});

test("can't cross the boundary: repeated outward steps never leave the walkable region", () => {
  const grid = circleGrid(4);
  let pos = { x: 0, z: 0 };
  for (let i = 0; i < 100_000; i++) {
    const step = resolveWalkMove(grid, pos, { x: 0.05, z: 0 }, 1 / 60);
    pos = { x: pos.x + step.x, z: pos.z + step.z };
  }
  assert.ok(sampleSdf(grid, pos.x, pos.z) < 0.01); // stays walkable (allow float slop)
});

test('at or beyond the boundary, velocity slides along the tangent instead of hard-stopping', () => {
  const grid = circleGrid(4);
  // Sitting exactly on the boundary, moving along +x and +z: the +x component (the outward
  // normal here) should be removed, leaving a non-zero tangential (z) slide.
  const result = resolveWalkMove(grid, { x: 4, z: 0 }, { x: 0.05, z: 0.05 }, 1 / 60);
  assert.ok(Math.abs(result.x) < 0.01); // outward motion stripped
  assert.ok(Math.abs(result.z - 0.05) < 0.01); // tangential motion kept
});

test('no jitter along the edge: a sustained outward push settles instead of oscillating', () => {
  const grid = circleGrid(4);
  let pos = { x: 3.9, z: 0 };
  const radii: number[] = [];
  for (let i = 0; i < 300; i++) {
    const step = resolveWalkMove(grid, pos, { x: 0.02, z: 0 }, 1 / 60);
    pos = { x: pos.x + step.x, z: pos.z + step.z };
    radii.push(Math.hypot(pos.x, pos.z));
  }
  const last50 = radii.slice(-50);
  const spread = Math.max(...last50) - Math.min(...last50);
  assert.ok(spread < 0.01); // settles to a steady radius, no back-and-forth bouncing
});

test('an undefined grid leaves movement unbounded (no E-06 output yet)', () => {
  const desired = { x: 5, z: -3 };
  assert.deepEqual(resolveWalkMove(undefined, { x: 100, z: 100 }, desired, 1 / 60), desired);
});

test('colliders block movement: a move is clamped short of a wall', () => {
  // PlaneGeometry lies in the XY plane by default (normal along +Z), so this is already a
  // vertical wall perpendicular to Z - no rotation needed. DoubleSide so the test ray (which
  // approaches the back face) still raycasts; real colliders.glb geometry is E-06's concern.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  wall.position.set(0, 0, 2); // a vertical wall at z=2 facing the origin
  wall.updateMatrixWorld();

  const origin = new THREE.Vector3(0, 0, 0);
  const move = new THREE.Vector3(0, 0, 5); // tries to walk straight through the wall
  const clamped = clampMoveForColliders([wall], origin, move);
  assert.ok(clamped.length() < move.length());
  assert.ok(clamped.length() < 2); // stopped short of z=2, not past it
});

test('colliders do not affect a move that stays clear of them', () => {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10));
  wall.position.set(0, 0, 2);
  wall.updateMatrixWorld();

  const move = new THREE.Vector3(1, 0, 0); // parallel to the wall, never reaches it
  const clamped = clampMoveForColliders([wall], new THREE.Vector3(0, 0, 0), move);
  assert.ok(Math.abs(clamped.length() - move.length()) < 1e-6);
});

test(`WALK_MARGIN matches the PRD's 0.75 m`, () => {
  assert.equal(WALK_MARGIN, 0.75);
});
