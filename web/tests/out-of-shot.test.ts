// Run: cd web && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnreconstructed } from '../src/out-of-shot.ts';

test('isUnreconstructed is false with no ranges', () => {
  assert.equal(isUnreconstructed(5, []), false);
});

test('isUnreconstructed is true inside a range, false just outside it', () => {
  const ranges = [{ start: 8, end: 10 }];
  assert.equal(isUnreconstructed(7.999, ranges), false);
  assert.equal(isUnreconstructed(8, ranges), true);
  assert.equal(isUnreconstructed(9, ranges), true);
  assert.equal(isUnreconstructed(10, ranges), false); // end is exclusive, matches shotFrame's clamp
});

test('isUnreconstructed checks every range', () => {
  const ranges = [
    { start: 0, end: 2 },
    { start: 8, end: 10 },
  ];
  assert.equal(isUnreconstructed(1, ranges), true);
  assert.equal(isUnreconstructed(5, ranges), false);
  assert.equal(isUnreconstructed(9, ranges), true);
});
