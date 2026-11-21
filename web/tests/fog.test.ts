// Run: cd web && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FogVolume, fogIntensity, smoothstep } from '../src/fog.ts';
import type { WalkSdfGrid } from '../src/walk-bounds.ts';

/** A circular walkable area of `radius` m, centered at the origin (matches the S-09 test fixture's convention). */
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

test('smoothstep is a clamped 0-1 s-curve', () => {
  assert.equal(smoothstep(0, 1, -5), 0);
  assert.equal(smoothstep(0, 1, 5), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
});

test('fog intensity is 0 deep inside the walk boundary and 1 well past it', () => {
  const grid = circleGrid(4);
  assert.equal(fogIntensity(grid, 0, 0.05, 0), 0); // dead center, deep inside
  assert.ok(fogIntensity(grid, 9, 0.05, 0) > 0.95); // near the grid edge, well past the boundary
});

test('fog intensity ramps smoothly through the boundary', () => {
  const grid = circleGrid(4);
  let prev = 0;
  for (let x = 2; x <= 6; x += 0.25) {
    const v = fogIntensity(grid, x, 0.05, 0);
    assert.ok(v >= prev - 1e-9); // monotonically non-decreasing
    prev = v;
  }
  assert.ok(fogIntensity(grid, 4, 0.05, 0) > 0.4 && fogIntensity(grid, 4, 0.05, 0) < 0.6); // ~0.5 right at the boundary
});

test('higher layers are dimmer (height falloff)', () => {
  const grid = circleGrid(4);
  const ground = fogIntensity(grid, 20, 0.05, 0);
  const high = fogIntensity(grid, 20, 3, 0);
  assert.ok(high < ground);
});

test('FogVolume has no geometry when the shot has no SDF yet', () => {
  const volume = new FogVolume(undefined, new THREE.Color(0, 0, 0));
  assert.equal(volume.group.children.length, 0);
});

test('FogVolume builds a layer per configured height, and the F toggle flips group visibility', () => {
  const volume = new FogVolume(circleGrid(4), new THREE.Color(0.1, 0.1, 0.1));
  assert.ok(volume.group.children.length > 1);
  assert.equal(volume.group.visible, true);
  volume.setEnabled(false);
  assert.equal(volume.group.visible, false);
  volume.setEnabled(true);
  assert.equal(volume.group.visible, true);
});
