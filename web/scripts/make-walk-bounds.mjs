#!/usr/bin/env node
// KAN-50 / SH-07 (PRD §8.4, §10.4): derives a real world's walk.json + walk_sdf.bin from its
// own cameras.json, so the walk boundary can be exercised on a baked world before E-06's full
// voxel-carved coverage/SDF/colliders pipeline lands. Walkable = within `radius` metres of the
// recorded camera path (PRD §10.4 "Reach"), which is a reasonable stand-in for "seen and free"
// on a world whose camera walks or orbits its subject.
//
// Run: cd web && node scripts/make-walk-bounds.mjs <youtubeId> [--radius 4] [--version 1]
//
// Does NOT write coverage.bin or colliders.glb - those need real per-frame depth/occupancy and
// obstacle geometry (E-06), which this script doesn't have. walk.json's `bounds.colliders` is
// left unset for worlds built this way.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLDS = path.resolve(HERE, '../../worlds');

const CELL_SIZE = 0.1; // metres, matches the S-09 test fixture
const PADDING = 1; // metres of extra grid beyond radius, so the SDF doesn't clamp at the path's ends

function parseArgs(argv) {
  const [youtubeId, ...rest] = argv;
  if (!youtubeId) {
    console.error('Usage: make-walk-bounds.mjs <youtubeId> [--radius 4] [--version 1]');
    process.exit(1);
  }
  let radius = 4;
  let version = 1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--radius') radius = Number(rest[++i]);
    else if (rest[i] === '--version') version = Number(rest[++i]);
  }
  return { youtubeId, radius, version };
}

/** Shortest distance from (x, z) to the segment (ax, az)-(bx, bz). */
function pointSegmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lenSq)) : 0;
  const px = ax + t * dx;
  const pz = az + t * dz;
  return Math.hypot(x - px, z - pz);
}

async function main() {
  const { youtubeId, radius, version } = parseArgs(process.argv.slice(2));
  const shotDir = path.join(WORLDS, youtubeId, `v${version}`, 's0');
  const manifestPath = path.join(WORLDS, youtubeId, `v${version}`, 'manifest.json');

  const cameras = JSON.parse(await readFile(path.join(shotDir, 'cameras.json'), 'utf8'));
  const path2d = cameras.frames.map((f) => ({ x: f.c2w[3], z: f.c2w[11] }));
  const eyeHeight = cameras.frames.reduce((sum, f) => sum + f.c2w[7], 0) / cameras.frames.length;

  const xs = path2d.map((p) => p.x);
  const zs = path2d.map((p) => p.z);
  const origin = [Math.min(...xs) - radius - PADDING, Math.min(...zs) - radius - PADDING];
  const maxX = Math.max(...xs) + radius + PADDING;
  const maxZ = Math.max(...zs) + radius + PADDING;
  const width = Math.ceil((maxX - origin[0]) / CELL_SIZE);
  const height = Math.ceil((maxZ - origin[1]) / CELL_SIZE);

  const sdf = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const z = origin[1] + (row + 0.5) * CELL_SIZE;
    for (let col = 0; col < width; col++) {
      const x = origin[0] + (col + 0.5) * CELL_SIZE;
      let minDist = Infinity;
      for (let i = 1; i < path2d.length; i++) {
        const d = pointSegmentDistance(x, z, path2d[i - 1].x, path2d[i - 1].z, path2d[i].x, path2d[i].z);
        if (d < minDist) minDist = d;
      }
      sdf[row * width + col] = minDist - radius; // negative = walkable (PRD §8.4)
    }
  }
  await writeFile(path.join(shotDir, 'walk_sdf.bin'), Buffer.from(sdf.buffer));

  const walk = {
    eyeHeight,
    startFrame: 0,
    fog: { color: [0.06, 0.09, 0.07], radius },
    sdf: { url: 'walk_sdf.bin', origin, cellSize: CELL_SIZE, width, height },
  };
  await writeFile(path.join(shotDir, 'walk.json'), JSON.stringify(walk));

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.shots[0].bounds = { ...manifest.shots[0].bounds, walk: 's0/walk.json' };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Wrote ${shotDir}/walk.json + walk_sdf.bin (${width}x${height} cells, radius ${radius}m, eyeHeight ${eyeHeight.toFixed(2)}m)`);
  console.log(`Patched ${manifestPath} with shots[0].bounds.walk`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
