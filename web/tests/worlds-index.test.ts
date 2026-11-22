import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { worldsIndex } from '../vite.config.ts';

test('world index: folders with a manifest, no test fixture, no alternate build of an existing id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-'));
  const world = (folder: string, manifest: object) => {
    fs.mkdirSync(path.join(dir, folder, 'v1'), { recursive: true });
    fs.writeFileSync(path.join(dir, folder, 'v1', 'manifest.json'), JSON.stringify(manifest));
  };
  world('IMG_6713', { youtubeId: 'IMG_6713', title: 'Study room 360', video: { url: 'video.mp4' } });
  world('2PBXchYQdao', { youtubeId: '2PBXchYQdao' });
  world('2PBXchYQdao-atlas', { youtubeId: '2PBXchYQdao' });
  world('IMG_6719000', { youtubeId: 'IMG_6719' }); // renamed folder, no clash: kept under its folder name
  world('test', { youtubeId: 'test' });
  fs.mkdirSync(path.join(dir, 'half-copied'));
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');

  assert.deepEqual(worldsIndex(dir).map((w) => w.id), ['2PBXchYQdao', 'IMG_6713', 'IMG_6719000']);
});
