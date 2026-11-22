// Run: cd web && npm test   (node --test; Node 22.6+ strips the TypeScript types itself, no test framework needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Avatar, heldFrame, inRanges, jointWorld, type PersonFile } from '../src/people/avatars.ts';

const J = 12; // enough joints to include the SMPL-X feet (10, 11)

/** motion.bin for `frames` frames where every joint is a pure translation by (tx(f), ty(f), 0). */
function motion(frames: number, ty: (f: number) => number, tx = (_f: number) => 0) {
  const m = new Float32Array(frames * J * 12);
  for (let f = 0; f < frames; f++) {
    for (let j = 0; j < J; j++) {
      m.set([1, 0, 0, tx(f), 0, 1, 0, ty(f), 0, 0, 1, 0], (f * J + j) * 12);
    }
  }
  return m;
}

function person(frames: number, visible: number[][]): PersonFile {
  return {
    id: 'p0',
    label: 'person',
    joints: J,
    parents: [-1, ...Array.from({ length: J - 1 }, (_, j) => j)],
    restJoints: Array.from({ length: J }, (_, j) => [0, j * 0.1, 0]),
    motion: { url: 'motion.bin', frameCount: frames },
    visible,
  };
}

test('inRanges is inclusive and handles gaps', () => {
  assert.equal(inRanges(5, [[0, 5], [10, 12]]), true);
  assert.equal(inRanges(7, [[0, 5], [10, 12]]), false);
  assert.equal(inRanges(10, [[0, 5], [10, 12]]), true);
});

test('jointWorld applies the row-major 3x4 matrix to the rest joint', () => {
  const m = new Float32Array(2 * 12);
  m.set([0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3], 12); // joint 1: rotate 90deg about Z, then translate (1, 2, 3)
  const p = jointWorld(m, 2, 0, 1, [1, 0, 0], new THREE.Vector3());
  assert.deepEqual(p.toArray(), [1, 3, 3]);
});

test('avatar hides outside visible ranges and holds exact frames (no interpolation)', () => {
  const a = new Avatar(person(10, [[2, 5]]), motion(10, (f) => f));
  a.setFrame(0);
  assert.equal(a.group.visible, false);
  a.setFrame(3);
  assert.equal(a.group.visible, true);
  const pos = (a.group.children[0] as THREE.LineSegments).geometry.attributes.position;
  assert.ok(Math.abs(pos.getY(0) - (3 + 0.1)) < 1e-6); // joint 1 rest y 0.1 + frame 3 lift
  a.setFrame(99); // past the end: clamps to the last frame instead of wrapping or blending
  assert.equal(a.group.visible, false); // frame 9 isn't in [2, 5]
});

test('contact shadow sits under the feet and fades as they rise', () => {
  const grounded = new Avatar(person(2, [[0, 1]]), motion(2, () => -1.05, () => 2)); // foot joints at y ~ 0
  grounded.setFrame(0);
  const shadow = grounded.group.children[1] as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  assert.equal(shadow.position.x, 2);
  assert.ok(shadow.material.opacity > 0.3);
  const jumping = new Avatar(person(2, [[0, 1]]), motion(2, () => 1));
  jumping.setFrame(0);
  assert.equal((jumping.group.children[1] as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>).material.opacity, 0);
});

test('opacity fades the skeleton and scales the contact shadow (A-11 blend)', () => {
  const a = new Avatar(person(2, [[0, 1]]), motion(2, () => -1.05));
  a.setFrame(0);
  const shadow = a.group.children[1] as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  const full = shadow.material.opacity;
  a.opacity = 0.5;
  assert.ok(Math.abs(shadow.material.opacity - full / 2) < 1e-9);
  a.setFrame(1); // stays faded on the next frame
  assert.ok(Math.abs(shadow.material.opacity - full / 2) < 1e-9);
  assert.equal(((a.group.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial).opacity, 0.5);
});

test('heldFrame holds the last reliable frame, or the first before any', () => {
  const r = [[10, 110], [200, 300]]; // trimmed by 15 frames: [25, 95], [215, 285]
  assert.equal(heldFrame(50, r), 50);
  assert.equal(heldFrame(105, r), 95); // leaving the frame
  assert.equal(heldFrame(150, r), 95); // off-screen: hold
  assert.equal(heldFrame(400, r), 285);
  assert.equal(heldFrame(3, r), 25);
  assert.equal(heldFrame(3, []), 3);
  assert.equal(heldFrame(11, [[10, 14]]), 11); // short range: trimmed by a quarter, [11, 13]
});
