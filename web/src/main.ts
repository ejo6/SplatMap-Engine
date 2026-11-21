import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { MasterClock, unmuteOnFirstGesture } from './clock';
import { CameraRig, poseAt, type CamerasFile } from './camera';
import { VideoOverlay } from './overlay';
import { createTransportUI, type ThumbsSprite } from './transport';
import { ScrubController } from './scrub';
import { loadPeople } from './people';
import type { WalkSdfGrid } from './walk-bounds';
import './style.css';

// SH-01: viewer scaffold + world loader (PRD §7.4, §8, §10.8, FR-05)

const PIPELINE_VERSION = 1;
const DEFAULT_EYE_HEIGHT = 1.6; // PRD §10.2, used if a shot has no walk.json yet
const app = document.getElementById('app')!;

function setStatus(text: string) {
  app.replaceChildren(document.createTextNode(text));
}

interface Manifest {
  video: { url: string; fps: number; thumbs: { sprite: string; index: string } };
  shots: {
    id: string;
    start: number;
    frameCount: number;
    // `rotation` (degrees, XYZ) fixes up-axis mismatches on assets not produced by our own
    // pipeline (E-03 already normalizes our captures to +Y up; third-party ones may not be).
    world: { rad?: string; spz?: string; rotation?: [number, number, number] };
    cameras: string;
    bounds?: { walk?: string; colliders?: string };
  }[];
}

// SH-07: walk.json's own file spec (docs/world-format.md), beyond the `eyeHeight` SH-01 already read.
interface WalkFile {
  eyeHeight: number;
  sdf?: { url: string; origin: [number, number]; cellSize: number; width: number; height: number };
}

/** Loads the SDF binary and colliders a shot's walk.json points to (both optional until E-06 runs). */
async function loadWalkBounds(base: string, walkPath: string, walk: WalkFile, colliderPath?: string) {
  const walkDir = base + walkPath.slice(0, walkPath.lastIndexOf('/') + 1);

  const sdf: WalkSdfGrid | undefined = walk.sdf
    ? await fetch(walkDir + walk.sdf.url)
        .then((r) => r.arrayBuffer())
        .then((buf) => ({ data: new Float32Array(buf), origin: walk.sdf!.origin, cellSize: walk.sdf!.cellSize, width: walk.sdf!.width, height: walk.sdf!.height }))
    : undefined;

  const colliders = colliderPath ? await new GLTFLoader().loadAsync(base + colliderPath).then((gltf) => [gltf.scene]) : undefined;

  return { sdf, colliders };
}

async function resolveManifest(youtubeId: string): Promise<{ manifest: Manifest; base: string } | null> {
  const cdnBase = import.meta.env.VITE_CDN_BASE_URL as string | undefined;
  const path = `worlds/${youtubeId}/v${PIPELINE_VERSION}/`;
  const candidates = [cdnBase && `${cdnBase}/${path}`, `/${path}`].filter(Boolean) as string[];

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}manifest.json`);
      if (res.ok) return { manifest: await res.json(), base };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Detects a discrete GPU from the WebGL renderer string, used to scale both the splat
// budget and the DPR cap (PRD §10.8) - M1/M2 Macs (the PRD §3 baseline) fall in the
// integrated bucket, which is where a heavier scene is most likely to feel laggy.
function hasDiscreteGPU(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = (info && gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) || '';
  return /nvidia|amd|radeon/i.test(renderer) && !/apple|intel/i.test(renderer);
}

function lodBudget(discrete: boolean): number {
  return discrete ? 2_500_000 : 1_500_000;
}

async function loadWorld(manifest: Manifest, base: string) {
  const shot = manifest.shots[0];
  const worldPath = shot?.world.rad ?? shot?.world.spz;
  if (!worldPath) {
    setStatus('World has no reconstructed shot.');
    return;
  }

  // Antialiasing costs real fill-rate on heavily alpha-blended splats for little visible
  // gain (splats are already soft-edged), so it's off rather than the three.js default.
  const discreteGPU = hasDiscreteGPU();
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, discreteGPU ? 1.5 : 1)); // NFR DPR cap, PRD §10.8
  renderer.setSize(innerWidth, innerHeight);
  app.replaceChildren(renderer.domElement);

  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const world = new SplatMesh({ url: base + worldPath, maxSplats: lodBudget(discreteGPU) });
  if (shot.world.rotation) world.rotation.set(...(shot.world.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]));
  scene.add(world);

  // SH-03: camera modes - ride-along, walk, return (PRD §10.2, FR-16-18)
  const [cameras, walk, thumbs] = await Promise.all([
    fetch(base + shot.cameras).then((r) => r.json() as Promise<CamerasFile>),
    shot.bounds?.walk ? fetch(base + shot.bounds.walk).then((r) => r.json() as Promise<WalkFile>) : Promise.resolve(undefined),
    fetch(base + manifest.video.thumbs.index).then((r) => r.json() as Promise<ThumbsSprite>),
  ]);
  // SH-07: walk boundary - SDF damping/push/slide plus colliders (PRD §10.4, FR-22)
  const bounds = walk && shot.bounds?.walk ? await loadWalkBounds(base, shot.bounds.walk, walk, shot.bounds.colliders) : {};
  const rig = new CameraRig(renderer.domElement, innerWidth / innerHeight, cameras, walk?.eyeHeight ?? DEFAULT_EYE_HEIGHT, bounds);

  addEventListener('resize', () => {
    rig.camera.aspect = innerWidth / innerHeight;
    rig.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // SH-02: the master video is the only clock; every other layer reads its bus (PRD §10.1, FR-15).
  const video = document.createElement('video');
  video.src = base + manifest.video.url;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  unmuteOnFirstGesture(video);

  // SH-04: video overlay at the original pose (PRD §10.2, §10.5)
  const overlay = new VideoOverlay(video, cameras);
  scene.add(overlay.mesh);

  // A-09/A-10: people layer + avatars (PRD §10.5); empty if the shot has neither.
  const people = await loadPeople(base, shot, video, manifest.video.fps, cameras);
  scene.add(people.group);

  new MasterClock(video, shot, manifest.video.fps).subscribe((state) => {
    rig.setFrame(state.frame);
    overlay.setFrame(poseAt(cameras, state.frame));
    people.setFrame(state.frame);
  });
  void video.play();

  // SH-06: scrub state machine (PRD §10.3, FR-20, NFR-04)
  const scrub = await ScrubController.create(video, shot, manifest.video.fps, cameras, rig, overlay, base, thumbs);

  // SH-05: transport UI (PRD §10.7, FR-19)
  const shotStarts = manifest.shots.map((s) => s.start);
  app.appendChild(createTransportUI(video, base, thumbs, shotStarts, scrub));

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = timer.getDelta();
    rig.update(dt);
    overlay.setMode(rig.mode);
    overlay.update(dt);
    people.update(rig.camera, rig.mode);
    renderer.render(scene, rig.camera);
  });
}

async function main() {
  const youtubeId = location.pathname.match(/^\/w\/([^/]+)/)?.[1];
  if (!youtubeId) {
    setStatus('Paste a YouTube link on the landing page to step inside a video.');
    return;
  }

  setStatus('Loading world…');
  const resolved = await resolveManifest(youtubeId);
  if (!resolved) {
    setStatus('Not processed yet');
    return;
  }

  await loadWorld(resolved.manifest, resolved.base);
}

main();
