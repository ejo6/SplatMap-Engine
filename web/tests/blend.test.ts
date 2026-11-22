import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarWeight, showAvatars, smoothstep } from '../src/people/blend.ts';

test('people layer only near the original camera, avatars only far off-axis', () => {
  assert.equal(avatarWeight(0, 0), 0);
  assert.equal(avatarWeight(10, 0.2), 0); // PRD §10.5: <= 10 deg and <= 0.5 m -> real pixels
  assert.equal(avatarWeight(20, 0), 1); // > 20 deg -> avatars only
  assert.equal(avatarWeight(5, 0.6), 1); // too far from the original pose -> avatars only
});

test('crossfade is continuous and monotonic between 10 and 20 degrees', () => {
  assert.equal(avatarWeight(15, 0), 0.5);
  let prev = 0;
  for (let a = 10; a <= 20; a += 0.5) {
    const w = avatarWeight(a, 0);
    assert.ok(w >= prev && w - prev < 0.08); // no pops
    prev = w;
  }
});

test('distance band fades instead of popping at 0.5 m', () => {
  assert.equal(avatarWeight(0, 0.4), 0);
  assert.ok(avatarWeight(0, 0.45) > 0 && avatarWeight(0, 0.45) < 1);
  assert.equal(avatarWeight(0, 0.5), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
});

test('swap has hysteresis: on past mid-band, off only back in the real-pixel zone (KAN-85)', () => {
  assert.equal(showAvatars(false, 0.3), false);
  assert.equal(showAvatars(false, 0.5), true);
  assert.equal(showAvatars(true, 0.3), true); // still in the band: no flicker back
  assert.equal(showAvatars(true, 0), false);
});
