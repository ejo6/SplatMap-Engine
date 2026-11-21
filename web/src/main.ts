import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { MasterClock, unmuteOnFirstGesture } from './clock';
import './style.css';

// SH-01: viewer scaffold + world loader (PRD §7.4, §8, §10.8, FR-05)

const PIPELINE_VERSION = 1;
const app = document.getElementById('app')!;

function setStatus(text: string) {
  app.replaceChildren(document.createTextNode(text));
}

interface Manifest {
  video: { url: string; fps: number };
  shots: { id: string; start: number; frameCount: number; world: { rad?: string; spz?: string } }[];
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

// Default LoD budget is 1.5M splats, 2.5M on a discrete GPU (PRD §10.8), detected
// from the WebGL renderer string.
function lodBudget(): number {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = (info && gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) || '';
  const discrete = /nvidia|amd|radeon/i.test(renderer) && !/apple|intel/i.test(renderer);
  return discrete ? 2_500_000 : 1_500_000;
}

async function loadWorld(manifest: Manifest, base: string) {
  const shot = manifest.shots[0];
  const worldPath = shot?.world.rad ?? shot?.world.spz;
  if (!worldPath) {
    setStatus('World has no reconstructed shot.');
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // NFR DPR cap, PRD §10.8
  renderer.setSize(innerWidth, innerHeight);
  app.replaceChildren(renderer.domElement);

  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const world = new SplatMesh({ url: base + worldPath, maxSplats: lodBudget() });
  scene.add(world);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop(() => renderer.render(scene, camera));

  // SH-02: the master video is the only clock; every other layer reads its bus (PRD §10.1, FR-15).
  const video = document.createElement('video');
  video.src = base + manifest.video.url;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  unmuteOnFirstGesture(video);
  new MasterClock(video, shot, manifest.video.fps);
  void video.play();
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
