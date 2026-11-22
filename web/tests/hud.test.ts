import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditText } from '../src/hud.ts';

test('the credit corner always names a source', () => {
  assert.deepEqual(creditText({ creator: 'Chan', license: 'CC BY 4.0', url: 'https://youtube.com/watch?v=abcdefghijk' }, 'abcdefghijk'),
    { text: 'Video by Chan · CC BY 4.0', url: 'https://youtube.com/watch?v=abcdefghijk' });
  assert.equal(creditText({ creator: 'Chan', url: 'javascript:alert(1)' }, 'x').url, undefined); // only http(s) links
  assert.deepEqual(creditText(undefined, '9lY7iZl1KbI'), { text: 'Video from YouTube', url: 'https://www.youtube.com/watch?v=9lY7iZl1KbI' });
  assert.deepEqual(creditText(undefined, 'IMG_6713'), { text: 'Source video', url: undefined });
});
