import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { loadPeopleLayer, type PeopleLayerShot } from './holo';

// Dev-only page for A-10: /src/people/debug.html?world=test&yaw=20&dx=0.5
// Views the people layer from the original camera (yaw=0, dx=0 should match the video exactly)
// or off-axis. The real viewer wires PeopleLayer into the master clock (SH-02) instead.

const q = new URLSearchParams(location.search);
const world = q.get('world') ?? 'test';
const yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? 0));
const dx = Number(q.get('dx') ?? 0);
const hud = document.getElementById('hud')!;

const base = `/worlds/${world}/v1/`;
const manifest = await fetch(base + 'manifest.json').then((r) => r.json());
const shot: PeopleLayerShot & { world?: { spz?: string } } = manifest.shots[0];
const people = await loadPeopleLayer(base, shot);
if (!people) throw new Error('shot has no peopleLayer');

const { width, height, intrinsics } = await fetch(base + shot.cameras).then((r) => r.json());
const scale = Math.min(innerWidth / width, innerHeight / height);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width * scale, height * scale);
document.body.append(renderer.domElement);

const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / intrinsics.fy)), width / height, 0.01, 100);
camera.matrixAutoUpdate = false;
const scene = new THREE.Scene();
scene.add(people.mesh);
if (shot.world?.spz) {
  scene.add(new SparkRenderer({ renderer }));
  scene.add(new SplatMesh({ url: base + shot.world.spz }));
}

// Offset from the original pose: turn around the camera's up axis, then slide along its right axis.
const offset = new THREE.Matrix4().makeTranslation(dx, 0, 0).multiply(new THREE.Matrix4().makeRotationY(yaw));
people.video.loop = true;
await people.video.play();
renderer.setAnimationLoop(() => {
  camera.matrix.copy(people.mesh.matrix).multiply(offset);
  renderer.render(scene, camera);
  hud.textContent = `frame ${people.frame}  yaw ${q.get('yaw') ?? 0}°  dx ${dx} m`;
});
