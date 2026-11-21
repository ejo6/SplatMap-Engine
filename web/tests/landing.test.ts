import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterlineY, PHOTO } from '../src/waterline.ts';
import { youtubeId } from '../src/youtube.ts';

test('waterline follows the cover-fit photo', () => {
  // Same aspect as the photo: no crop, the waterline sits at its own fraction.
  assert.ok(Math.abs(waterlineY(PHOTO.width / 2, PHOTO.height / 2) - (PHOTO.height / 2) * PHOTO.waterline) < 1e-6);
  // Wide desktop (1440x900): the photo is scaled to the width and cropped top and bottom.
  const drawn = (PHOTO.height * 1440) / PHOTO.width;
  assert.ok(Math.abs(waterlineY(1440, 900) - ((900 - drawn) / 2 + PHOTO.waterline * drawn)) < 1e-6);
  // Tall phone (390x844): scaled to the height, so the waterline is its fraction of the viewport.
  assert.ok(Math.abs(waterlineY(390, 844) - 844 * PHOTO.waterline) < 1e-6);
});

test('YouTube links route to an 11-character id; anything else is rejected', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://vimeo.com/123'), null);
  assert.equal(youtubeId('not a link'), null);
  assert.equal(youtubeId('https://www.youtube.com/watch?v=short'), null);
});
