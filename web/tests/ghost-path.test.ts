// Run: cd web && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GhostPath, pathFraction } from '../src/ghost-path.ts';
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

test('pathFraction: share of the path length travelled by a frame', () => {
  const cumulative = [0, 1, 1, 3, 4]; // a pause at frame 2 adds no length
  assert.equal(pathFraction(cumulative, 0), 0);
  assert.equal(pathFraction(cumulative, 2), 0.25);
  assert.equal(pathFraction(cumulative, 4), 1);
  assert.equal(pathFraction(cumulative, 99), 1); // clamped like poseAt
  assert.equal(pathFraction([0, 0], 1), 0); // a camera that never moved
});

test('floor style: flat path on the floor, marker on the floor, travelled part grows with the frame', () => {
  const cameras = straightLineCameras(11);
  const path = new GhostPath(cameras);
  const [air, marker, floor] = path.group.children as [THREE.Mesh, THREE.Mesh, THREE.Group];
  const done = floor.children[1] as THREE.Mesh;

  path.setStyle('floor');
  assert.equal(air.visible, false);
  assert.equal(floor.visible, true);
  path.setFrame(5);
  assert.ok(Math.abs(marker.position.y - 0.02) < 1e-9 && Math.abs(marker.position.x) < 1e-9);
  const half = done.geometry.drawRange.count;
  path.setFrame(10);
  assert.equal(done.geometry.drawRange.count, done.geometry.index!.count); // whole path lit at the end
  assert.equal(half * 2, done.geometry.drawRange.count); // straight line at constant speed: half way = half lit

  path.setStyle('air');
  assert.equal(air.visible, true);
  assert.equal(floor.visible, false);
  assert.ok(marker.position.equals(poseAt(cameras, 10).position)); // back in the air
});
