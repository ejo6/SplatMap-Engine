#!/usr/bin/env node
// KAN-21 / S-09 (PRD §8, docs/world-format.md): builds the hand-made worlds/test/v1/
// fixture that unblocks viewer work (gate G1) before the real pipeline exists.
// KAN-52 / SH-09 (PRD §10.6, FR-25): the reconstructed shot now ends before the video does,
// so the last SHOT_DURATION..DURATION seconds land in `unreconstructed` and exercise the
// out-of-shot panel.
// Run: cd web && node scripts/make-test-world.mjs

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { PackedSplats, constructGrid, constructSpherePoints, writeSpz } from '@sparkjsdev/spark';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../worlds/test/v1');
const S0 = path.join(OUT, 's0');

const FPS = 30;
const DURATION = 10; // seconds, the full master video
const SHOT_DURATION = 8; // seconds; the reconstructed shot ends here, leaving a 2s unreconstructed tail (KAN-52)
const FRAME_COUNT = FPS * SHOT_DURATION; // the reconstructed shot's own frame count (cameras, splat, holo)
const WIDTH = 1280;
const HEIGHT = 720;
const WALK_RADIUS = 4; // metres, shared by the walk SDF and the coverage sphere
const EYE_HEIGHT = 1.6;
const HOLO_DEPTH = 2; // metres, constant depth of the synthetic mover
const HOLO_NEAR = 1;
const HOLO_FAR = 5;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${stderr}`))));
  });
}

function runPiped(cmd, args, writeInput) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${stderr}`))));
    writeInput(child.stdin).catch(reject);
  });
}

// ---- s0/world.spz: a small splat (floor grid + a sphere "subject"), encoded with
// Spark's own writeSpz() so the bytes are a real, viewer-loadable SPZ file. ----
async function buildSplat() {
  const packed = new PackedSplats({
    construct: (splats) => {
      constructGrid({
        splats,
        extents: { min: new THREE.Vector3(-WALK_RADIUS, 0, -WALK_RADIUS), max: new THREE.Vector3(WALK_RADIUS, 0, WALK_RADIUS) },
        stepSize: 0.4,
        pointRadius: 0.06,
        color: new THREE.Color(0.5, 0.45, 0.4),
      });
      constructSpherePoints({
        splats,
        origin: new THREE.Vector3(0, 1, 0),
        radius: 0.5,
        maxDepth: 4,
        pointRadius: 0.05,
        color: new THREE.Color(0.9, 0.2, 0.2),
      });
    },
  });
  await packed.initialized;
  const { fileBytes } = await writeSpz(packed, { maxSh: 0 });
  await writeFile(path.join(S0, 'world.spz'), fileBytes);
  return packed.numSplats;
}

// ---- s0/cameras.json: a straight line, 10s @ 30fps, identity rotation (looking down -Z). ----
async function buildCameras() {
  const frames = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const t = f / (FRAME_COUNT - 1);
    const x = -2 + 4 * t; // slide from x=-2 to x=2
    // c2w, three.js convention (+Y up, looks down -Z), row-major 4x4, identity rotation.
    const c2w = [1, 0, 0, x, 0, 1, 0, EYE_HEIGHT, 0, 0, 1, 6, 0, 0, 0, 1];
    frames.push({ f, c2w });
  }
  const keyframes = [];
  for (let f = 0; f < FRAME_COUNT; f += 6) keyframes.push(f); // ~5fps, like the real pipeline's keyframe sampling

  const cameras = {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    intrinsics: { fx: 1000, fy: 1000, cx: WIDTH / 2, cy: HEIGHT / 2 },
    keyframes,
    frames,
  };
  await writeFile(path.join(S0, 'cameras.json'), JSON.stringify(cameras));
}

// ---- s0/walk.json + walk_sdf.bin + coverage.bin: a circular walk area and a matching coverage sphere. ----
async function buildWalkBounds() {
  const sdfOrigin = [-5, -5];
  const sdfCellSize = 0.1;
  const sdfW = 100;
  const sdfH = 100;
  const sdf = new Float32Array(sdfW * sdfH);
  for (let row = 0; row < sdfH; row++) {
    for (let col = 0; col < sdfW; col++) {
      const x = sdfOrigin[0] + (col + 0.5) * sdfCellSize;
      const z = sdfOrigin[1] + (row + 0.5) * sdfCellSize;
      sdf[row * sdfW + col] = Math.sqrt(x * x + z * z) - WALK_RADIUS; // negative = walkable
    }
  }
  await writeFile(path.join(S0, 'walk_sdf.bin'), Buffer.from(sdf.buffer));

  const covOrigin = [-5, -1, -5];
  const covCellSize = 0.2;
  const dims = [50, 20, 50];
  const coverage = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const FALLOFF = 1; // metres of fade at the sphere's edge
  for (let iz = 0; iz < dims[2]; iz++) {
    for (let iy = 0; iy < dims[1]; iy++) {
      for (let ix = 0; ix < dims[0]; ix++) {
        const wx = covOrigin[0] + (ix + 0.5) * covCellSize;
        const wy = covOrigin[1] + (iy + 0.5) * covCellSize;
        const wz = covOrigin[2] + (iz + 0.5) * covCellSize;
        const dist = Math.hypot(wx, wy - 1, wz); // sphere centered at (0, 1, 0), matching the walk circle's radius
        const t = (dist - (WALK_RADIUS - FALLOFF)) / FALLOFF;
        const value = Math.round(255 * Math.min(1, Math.max(0, 1 - t)));
        coverage[ix + iy * dims[0] + iz * dims[0] * dims[1]] = value;
      }
    }
  }
  await writeFile(path.join(S0, 'coverage.bin'), Buffer.from(coverage.buffer));

  const walk = {
    eyeHeight: EYE_HEIGHT,
    startFrame: 0,
    fog: { color: [0.85, 0.85, 0.88], radius: WALK_RADIUS },
    sdf: { url: 'walk_sdf.bin', origin: sdfOrigin, cellSize: sdfCellSize, width: sdfW, height: sdfH },
    coverage: { url: 'coverage.bin', origin: covOrigin, cellSize: covCellSize, dims },
  };
  await writeFile(path.join(S0, 'walk.json'), JSON.stringify(walk));
}

// ---- s0/colliders.glb: a minimal flat quad spanning the walk circle. ----
async function buildColliders() {
  const r = WALK_RADIUS + 1; // slightly larger than the walkable circle
  const positions = new Float32Array([-r, 0, -r, r, 0, -r, r, 0, r, -r, 0, r]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);

  const json = {
    asset: { version: '2.0', generator: 'make-test-world.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-r, 0, -r], max: [r, 0, r] },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  const glb = Buffer.concat([header, jsonChunkHeader, jsonPadded, binChunkHeader, binPadded]);
  await writeFile(path.join(S0, 'colliders.glb'), glb);
}

// ---- s0/holo.mp4 + holo.json: a coloured rectangle moving sideways at a constant depth. ----
async function buildHoloLayer() {
  const w = WIDTH;
  const h = HEIGHT * 2; // top: RGB, bottom: depth
  const rectW = 120;
  const rectH = 220;
  const rectY = (HEIGHT - rectH) / 2;

  // Constant depth -> constant normalized inverse-depth value, mapped into the
  // people-layer's 16-255 "mover" range (PRD §8.4).
  const invDepthNorm = (1 / HOLO_DEPTH - 1 / HOLO_FAR) / (1 / HOLO_NEAR - 1 / HOLO_FAR);
  const depthValue = Math.round(16 + invDepthNorm * (255 - 16));

  const frame = Buffer.alloc(w * h * 3);
  await runPiped(
    'ffmpeg',
    [
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', String(FPS), '-i', '-',
      '-frames:v', String(FRAME_COUNT),
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '20', '-bf', '0', '-movflags', '+faststart',
      '-y', path.join(S0, 'holo.mp4'),
    ],
    async (stdin) => {
      for (let f = 0; f < FRAME_COUNT; f++) {
        frame.fill(0);
        const x = Math.round((w - rectW) * (f / (FRAME_COUNT - 1)));
        for (let row = 0; row < rectH; row++) {
          const topRowStart = ((rectY + row) * w + x) * 3;
          for (let col = 0; col < rectW; col++) {
            const o = topRowStart + col * 3;
            frame[o] = 230;
            frame[o + 1] = 80;
            frame[o + 2] = 60;
          }
          const bottomRowStart = ((HEIGHT + rectY + row) * w + x) * 3;
          for (let col = 0; col < rectW; col++) {
            const o = bottomRowStart + col * 3;
            frame[o] = depthValue;
            frame[o + 1] = depthValue;
            frame[o + 2] = depthValue;
          }
        }
        const ok = stdin.write(frame);
        if (!ok) await new Promise((r) => stdin.once('drain', r));
      }
      stdin.end();
    }
  );

  const holoMeta = { frames: Array.from({ length: FRAME_COUNT }, () => [HOLO_NEAR, HOLO_FAR]) };
  await writeFile(path.join(S0, 'holo.json'), JSON.stringify(holoMeta));
}

// ---- video.mp4 + thumbs.jpg/thumbs.json: a real, properly encoded clip + seek-bar sprite. ----
async function buildVideoAndThumbs() {
  const videoPath = path.join(OUT, 'video.mp4');
  await run('ffmpeg', [
    '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${DURATION}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURATION}`,
    '-c:v', 'libx264', '-g', '20', '-bf', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart',
    '-y', videoPath,
  ]);

  const cols = 5;
  const rows = 4;
  const count = cols * rows; // 2fps * 10s
  const tileWidth = 160;
  const tileHeight = 90;
  await run('ffmpeg', [
    '-i', videoPath,
    '-vf', `fps=2,scale=${tileWidth}:${tileHeight},tile=${cols}x${rows}`,
    '-frames:v', '1',
    '-y', path.join(OUT, 'thumbs.jpg'),
  ]);
  const thumbs = { sprite: 'thumbs.jpg', fps: 2, cols, rows, count, tileWidth, tileHeight };
  await writeFile(path.join(OUT, 'thumbs.json'), JSON.stringify(thumbs));
}

async function buildManifest(splatCount) {
  const manifest = {
    schema: 1,
    pipelineVersion: '1',
    youtubeId: 'test',
    title: 'Hand-made test world (gate G1)',
    credit: { creator: 'Hack Western 13 team', license: 'N/A - synthetic test fixture', url: '' },
    sceneCard: 'A synthetic scene for testing the viewer before the real pipeline exists: a camera glides sideways past a small red sphere on a tan floor.',
    video: {
      url: 'video.mp4',
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      duration: DURATION,
      sourceStart: 0,
      thumbs: { sprite: 'thumbs.jpg', index: 'thumbs.json' },
    },
    shots: [
      {
        id: 's0',
        start: 0,
        end: SHOT_DURATION,
        frameCount: FRAME_COUNT,
        world: { spz: 's0/world.spz', splatCount },
        cameras: 's0/cameras.json',
        bounds: { walk: 's0/walk.json', colliders: 's0/colliders.glb' },
        peopleLayer: { video: 's0/holo.mp4', meta: 's0/holo.json' },
        people: [],
      },
    ],
    unreconstructed: [{ start: SHOT_DURATION, end: DURATION }],
    qa: { verdict: 'unchecked', notes: 'Hand-made fixture; no Gemini QA run.', fogRadius: WALK_RADIUS },
    createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function main() {
  await mkdir(S0, { recursive: true });
  const splatCount = await buildSplat();
  await buildCameras();
  await buildWalkBounds();
  await buildColliders();
  await buildHoloLayer();
  await buildVideoAndThumbs();
  await buildManifest(splatCount);
  console.log(`Built ${OUT} (${splatCount} splats)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
