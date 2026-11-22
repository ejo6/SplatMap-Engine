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
import { bindFogToggle, FogVolume } from './fog';
import { isUnreconstructed, OutOfShotFx, type UnreconstructedRange } from './out-of-shot';
import { SpatialSoundtrack, startSpatialSoundtrack } from './spatial-audio';
import { GhostPath } from './ghost-path';
import { gpuRendererString, isDiscreteGPU, lodBudget } from './gpu';
import './style.css';

// SH-01: viewer scaffold + world loader (PRD §7.4, §8, §10.8, FR-05)

const PIPELINE_VERSION = 1;
const DEFAULT_EYE_HEIGHT = 1.6; // PRD §10.2, used if a shot has no walk.json yet
const app = document.getElementById('app')!;

function setStatus(text: string) {
  app.replaceChildren(document.createTextNode(text));
}

interface Manifest {
  video: { url: string; fps: number; width: number; height: number; thumbs: { sprite: string; index: string } };
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
  // SH-09 (PRD §8.3, §10.6): gaps in the processed window with no reconstructed shot at all.
  unreconstructed?: UnreconstructedRange[];
}

// SH-07/SH-08: walk.json's own file spec (docs/world-format.md), beyond the `eyeHeight` SH-01 already read.
interface WalkFile {
  eyeHeight: number;
  fog?: { color: [number, number, number]; radius: number };
  sdf?: { url: string; origin: [number, number]; cellSize: number; width: number; height: number };
}

const DEFAULT_FOG_COLOR: [number, number, number] = [0.85, 0.85, 0.88]; // white mist, not a sky tint (PRD §3 "fog by default")

interface WalkBoundsResult {
  sdf?: WalkSdfGrid;
  colliders?: THREE.Object3D[];
}

/** Loads the SDF binary and colliders a shot's walk.json points to (both optional until E-06 runs). */
async function loadWalkBounds(base: string, walkPath: string, walk: WalkFile, colliderPath?: string): Promise<WalkBoundsResult> {
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

/** SH-13: `?perf` overlays fps (last second), p95 frame time, DPR, splat budget and GPU, for the KAN-56 measurements. */
function perfHud(gpu: string, dpr: number, budget: number): () => void {
  if (!new URLSearchParams(location.search).has('perf')) return () => {};
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;top:8px;left:8px;margin:0;padding:6px 8px;z-index:10;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 ui-monospace,monospace;pointer-events:none';
  document.body.append(el);
  let times: number[] = [];
  let last = performance.now(), shown = last;
  return () => {
    const now = performance.now();
    times.push(now - last);
    last = now;
    if (now - shown < 1000) return;
    const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
    el.textContent = `${((1000 * times.length) / (now - shown)).toFixed(1)} fps · p95 ${p95.toFixed(1)} ms\nDPR ${dpr} · LoD ${budget / 1e6}M splats\n${gpu || 'GPU hidden'}`;
    times = [];
    shown = now;
  };
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
  // M1/M2 Macs (the PRD §3 baseline) fall in the integrated bucket: lower DPR cap and splat budget.
  const gpu = gpuRendererString();
  const discreteGPU = isDiscreteGPU(gpu);
  const budget = lodBudget(discreteGPU);
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, discreteGPU ? 1.5 : 1)); // NFR DPR cap, PRD §10.8
  renderer.setSize(innerWidth, innerHeight);
  app.replaceChildren(renderer.domElement);

  // The LoD budget is the renderer's lodSplatCount; Spark's own default is 2.5M on every desktop, Macs included.
  const spark = new SparkRenderer({ renderer, lodSplatCount: budget });
  scene.add(spark);

  const world = new SplatMesh({ url: base + worldPath });
  if (shot.world.rotation) world.rotation.set(...(shot.world.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]));
  scene.add(world);

  // SH-03: camera modes - ride-along, walk, return (PRD §10.2, FR-16-18)
  const [cameras, walk, thumbs] = await Promise.all([
    fetch(base + shot.cameras).then((r) => r.json() as Promise<CamerasFile>),
    shot.bounds?.walk ? fetch(base + shot.bounds.walk).then((r) => r.json() as Promise<WalkFile>) : Promise.resolve(undefined),
    fetch(base + manifest.video.thumbs.index).then((r) => r.json() as Promise<ThumbsSprite>),
  ]);
  // SH-07: walk boundary - SDF damping/push/slide plus colliders (PRD §10.4, FR-22)
  const bounds: WalkBoundsResult = walk && shot.bounds?.walk ? await loadWalkBounds(base, shot.bounds.walk, walk, shot.bounds.colliders) : {};
  const rig = new CameraRig(renderer.domElement, innerWidth / innerHeight, cameras, walk?.eyeHeight ?? DEFAULT_EYE_HEIGHT, bounds);

  // SH-08: fog rendering + F toggle (PRD §10.4, FR-21)
  const fogColor = new THREE.Color().fromArray(walk?.fog?.color ?? DEFAULT_FOG_COLOR);
  const fog = new FogVolume(bounds.sdf, fogColor);
  scene.add(fog.group);
  bindFogToggle(fog);

  addEventListener('resize', () => {
    rig.camera.aspect = innerWidth / innerHeight;
    rig.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // SH-02: the master video is the only clock; every other layer reads its bus (PRD §10.1, FR-15).
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = base + manifest.video.url;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  let soundtrack: SpatialSoundtrack | undefined;
  unmuteOnFirstGesture(video, () => {
    void startSpatialSoundtrack(video).then(track => { soundtrack = track; });
  });

  // SH-04: video overlay at the original pose (PRD §10.2, §10.5)
  const overlay = new VideoOverlay(video, cameras);
  scene.add(overlay.mesh);

  // SH-11: ghost camera path, walk mode only (PRD FR-30)
  const ghostPath = new GhostPath(cameras);
  scene.add(ghostPath.group);

  // A-09/A-10: people layer + avatars (PRD §10.5); empty if the shot has neither.
  const people = await loadPeople(base, shot, video, manifest.video.fps, cameras);
  scene.add(people.group);

  // SH-09: out-of-shot panel (PRD §10.6, FR-25)
  const unreconstructed = manifest.unreconstructed ?? [];
  const outOfShotFx = new OutOfShotFx(video, manifest.video.width / manifest.video.height, fogColor);
  scene.add(outOfShotFx.group);
  let outOfShot = false;

  const recordedPosition = new THREE.Vector3();
  new MasterClock(video, shot, manifest.video.fps).subscribe((state) => {
    rig.setFrame(state.frame);
    const pose = poseAt(cameras, state.frame);
    recordedPosition.copy(pose.position);
    overlay.setFrame(pose);
    people.setFrame(state.frame);
    ghostPath.setFrame(state.frame);
    outOfShot = isUnreconstructed(state.t, unreconstructed);
    outOfShotFx.setActive(outOfShot);
  });
  void video.play();

  // SH-06: scrub state machine (PRD §10.3, FR-20, NFR-04)
  const scrub = await ScrubController.create(video, shot, manifest.video.fps, cameras, rig, overlay, base, thumbs);

  // SH-05: transport UI (PRD §10.7, FR-19)
  const shotStarts = manifest.shots.map((s) => s.start);
  app.appendChild(createTransportUI(video, base, thumbs, shotStarts, scrub));

  const tickPerf = perfHud(gpu, renderer.getPixelRatio(), budget);
  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = timer.getDelta();
    rig.update(dt);
    soundtrack?.update(rig.camera, recordedPosition, !outOfShot && (rig.mode === 'walk' || rig.mode === 'returning'));
    outOfShotFx.update(rig.camera, dt);
    world.opacity = outOfShotFx.presence;
    people.group.visible = outOfShotFx.presence > 0;
    // Out of shot there's no pose for the overlay to glue to, so fade it like the walk mode does.
    overlay.setMode(outOfShot ? 'walk' : rig.mode);
    overlay.update(dt);
    people.update(rig.camera, rig.mode);
    renderer.render(scene, rig.camera);
    tickPerf();
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
