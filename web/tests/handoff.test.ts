import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handoffPosition } from '../src/handoff.ts';

test('maps an absolute YouTube time onto the packaged video clock', () => {
  assert.deepEqual(handoffPosition('17.375', 0, 30, 30), { time: 17.375, play: true });
  assert.deepEqual(handoffPosition('17.375', 12, 30, 30), { time: 5.375, play: true });
  assert.deepEqual(handoffPosition('2', 12, 30, 30), { time: 0, play: true });
});

test('gallery and invalid links open normally; late handoffs hold the last frame', () => {
  for (const value of [null, '', '-1', 'NaN', 'Infinity', 'abc']) {
    assert.deepEqual(handoffPosition(value, 0, 30, 30), { time: 0, play: true });
  }
  for (const value of ['42', '58']) {
    assert.deepEqual(handoffPosition(value, 12, 30, 30), { time: 30 - 1 / 30, play: false });
  }
});
