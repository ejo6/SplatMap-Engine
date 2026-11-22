import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slaveRate } from '../src/clock.ts';

test('slaved video runs at the master speed, nudged 5% while more than a frame off', () => {
  const frame = 1 / 30;
  for (const rate of [0.5, 1, 1.5, 2]) {
    assert.equal(slaveRate(0, frame, rate), rate); // in sync: exactly the master's speed
    assert.equal(slaveRate(frame / 2, frame, rate), rate);
    assert.ok(Math.abs(slaveRate(2 * frame, frame, rate) - rate * 0.95) < 1e-12); // ahead: slow down
    assert.ok(Math.abs(slaveRate(-2 * frame, frame, rate) - rate * 1.05) < 1e-12); // behind: speed up
  }
});
