// Run: cd web && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GhostPath } from '../src/ghost-path.ts';
import { poseAt, type CamerasFile } from '../src/camera.ts';

/** A straight line along X, like the S-09 test fixture's own camera path. */
function straightLineCameras(frameCount: number): CamerasFile {
  const frames = Array.from({ length: frameCount }, (_, f) => {
    const x = -2 + (4 * f) / (frameCount - 1);
    return { f, c2w: [1, 0, 0, x, 0, 1, 0, 1.6, 0, 0, 1, 0, 0, 0, 0, 1] };
  });
  return { fps: 30, width: 1280, height: 720, intrinsics: { fx: 1000, fy: 1000, cx: 640, cy: 360 }, keyframes: [], frames };
}

test('GhostPath starts hidden (ride-along default)', () => {
  const path = new GhostPath(straightLineCameras(10));
  assert.equal(path.group.visible, false);
});

test('setVisible toggles the group', () => {
  const path = new GhostPath(straightLineCameras(10));
  path.setVisible(true);
  assert.equal(path.group.visible, true);
  path.setVisible(false);
  assert.equal(path.group.visible, false);
});

test('the path mesh spans the camera positions (tube wraps the whole curve)', () => {
  const cameras = straightLineCameras(10);
  const path = new GhostPath(cameras);
  const tube = path.group.children[0] as THREE.Mesh;
  tube.geometry.computeBoundingBox();
  const box = tube.geometry.boundingBox!;
  assert.ok(box.min.x < -1.9 && box.max.x > 1.9); // the fixture's path runs from x=-2 to x=2
});

test('setFrame moves the marker to that frame\'s original position', () => {
  const cameras = straightLineCameras(10);
  const path = new GhostPath(cameras);
  const marker = path.group.children[1] as THREE.Mesh;

  path.setFrame(5);
  assert.ok(marker.position.equals(poseAt(cameras, 5).position));

  path.setFrame(0);
  assert.ok(marker.position.equals(poseAt(cameras, 0).position));
});
