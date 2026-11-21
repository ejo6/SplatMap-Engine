import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ExtSplats, PackedSplats, SparkRenderer, SplatMesh, SplatSkinning, SplatSkinningMode } from '@sparkjsdev/spark';

// A-07 / KAN-42 spike (dev only): /src/people/avatar-bench.html?mode=lbs|mesh&n=40000&count=3&world=1500000
// Renders `count` animated synthetic humanoids (stand-ins for LHM avatars) over a `world`-splat background and
// measures fps. lbs = Spark SplatSkinning (avatar.kind "splat-lbs"), mesh = three SkinnedMesh ("mesh-glb").
// Skin matrices are built exactly like motion.bin: boneWorld * inverse(boneRest), mapping rest space to world.

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'lbs';
const N = Number(q.get('n') ?? 40000);
const COUNT = Number(q.get('count') ?? 3);
const WORLD = Number(q.get('world') ?? 1_500_000);
const hud = document.getElementById('hud')!;

// Rest T-pose joints (metres, y up), parent, child end used for the segment and limb radius.
const JOINTS: [number[], number, number[], number][] = [
  [[0, 0.95, 0], -1, [0, 1.2, 0], 0.15], // 0 pelvis
  [[0, 1.2, 0], 0, [0, 1.4, 0], 0.14], // 1 spine
  [[0, 1.4, 0], 1, [0, 1.58, 0], 0.15], // 2 chest
  [[0, 1.58, 0], 2, [0, 1.8, 0], 0.1], // 3 head
  [[0.18, 1.45, 0], 2, [0.45, 1.45, 0], 0.05], // 4 l shoulder
  [[0.45, 1.45, 0], 4, [0.7, 1.45, 0], 0.04], // 5 l elbow
  [[0.7, 1.45, 0], 5, [0.85, 1.45, 0], 0.04], // 6 l wrist
  [[-0.18, 1.45, 0], 2, [-0.45, 1.45, 0], 0.05], // 7 r shoulder
  [[-0.45, 1.45, 0], 7, [-0.7, 1.45, 0], 0.04], // 8 r elbow
  [[-0.7, 1.45, 0], 8, [-0.85, 1.45, 0], 0.04], // 9 r wrist
  [[0.1, 0.9, 0], 0, [0.1, 0.5, 0], 0.08], // 10 l hip
  [[0.1, 0.5, 0], 10, [0.1, 0.08, 0], 0.06], // 11 l knee
  [[0.1, 0.08, 0], 11, [0.1, 0.03, 0.15], 0.04], // 12 l ankle
  [[-0.1, 0.9, 0], 0, [-0.1, 0.5, 0], 0.08], // 13 r hip
  [[-0.1, 0.5, 0], 13, [-0.1, 0.08, 0], 0.06], // 14 r knee
  [[-0.1, 0.08, 0], 14, [-0.1, 0.03, 0.15], 0.04], // 15 r ankle
];

function makeSkeleton() {
  const bones = JOINTS.map(() => new THREE.Bone());
  JOINTS.forEach(([pos, parent], j) => {
    const p = parent >= 0 ? JOINTS[parent][0] : [0, 0, 0];
    bones[j].position.set(pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]);
    if (parent >= 0) bones[parent].add(bones[j]);
  });
  bones[0].updateMatrixWorld(true);
  return new THREE.Skeleton(bones); // computes boneInverses from the rest pose
}

/** Walk cycle on a circle; phase offsets each avatar. */
function animate(skel: THREE.Skeleton, t: number, phase: number) {
  const b = skel.bones;
  const a = t * 0.5 + phase;
  b[0].position.set(Math.cos(a) * 1.5, 0.95 + 0.03 * Math.sin(t * 8), Math.sin(a) * 1.5 - 1);
  b[0].rotation.y = -a;
  const s = Math.sin(t * 4 + phase);
  b[10].rotation.x = 0.5 * s;
  b[13].rotation.x = -0.5 * s;
  b[11].rotation.x = Math.max(0, -0.9 * s);
  b[14].rotation.x = Math.max(0, 0.9 * s);
  b[4].rotation.z = -1.2;
  b[7].rotation.z = 1.2;
  b[4].rotation.x = -0.4 * s;
  b[7].rotation.x = 0.4 * s;
  b[5].rotation.x = b[8].rotation.x = -0.3;
  b[0].updateMatrixWorld(true);
}

/** Surface points of each limb capsule, owned by its bone with a blend to the parent near the joint. */
function samplePoints(n: number) {
  const lengths = JOINTS.map(([a, , b, r]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * r);
  const total = lengths.reduce((x, y) => x + y, 0);
  const pts: { p: THREE.Vector3; bones: number[]; w: number[] }[] = [];
  const dir = new THREE.Vector3(), perp = new THREE.Vector3(), tmp = new THREE.Vector3();
  JOINTS.forEach(([a, parent, b, r], j) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    dir.subVectors(B, A).normalize();
    for (let i = 0; i < Math.round((n * lengths[j]) / total); i++) {
      const t = Math.random();
      perp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      perp.sub(tmp.copy(dir).multiplyScalar(perp.dot(dir))).normalize().multiplyScalar(r);
      const wp = parent >= 0 && t < 0.15 ? ((0.15 - t) / 0.15) * 0.5 : 0;
      pts.push({ p: A.clone().lerp(B, t).add(perp), bones: [j, Math.max(parent, 0)], w: [1 - wp, wp] });
    }
  });
  return pts;
}

async function lbsAvatar(hue: number) {
  const pts = samplePoints(N);
  const color = new THREE.Color().setHSL(hue, 0.6, 0.55);
  // Linear-blend skinning needs covSplats, which needs the extended encoding (Spark 2.4 throws otherwise).
  const ext = new ExtSplats({
    construct: (s) => {
      const scale = new THREE.Vector3(0.012, 0.012, 0.012), quat = new THREE.Quaternion();
      for (const { p } of pts) s.pushSplat(p, scale, quat, 0.9, color);
    },
  });
  await ext.initialized;
  const mesh = new SplatMesh({ extSplats: ext, covSplats: true });
  await mesh.initialized;
  const skin = new SplatSkinning({ mesh, numBones: JOINTS.length, mode: SplatSkinningMode.LINEAR_BLEND });
  const bi = new THREE.Vector4(), bw = new THREE.Vector4();
  pts.forEach(({ bones, w }, i) => skin.setSplatBones(i, bi.set(bones[0], bones[1], 0, 0), bw.set(w[0], w[1], 0, 0)));
  mesh.skinning = skin;
  mesh.updateGenerator();
  const skel = makeSkeleton();
  const m = new THREE.Matrix4();
  return {
    object: mesh as THREE.Object3D,
    update(t: number, phase: number) {
      animate(skel, t, phase);
      skel.bones.forEach((bone, j) => skin.setBoneMatrix(j, m.multiplyMatrices(bone.matrixWorld, skel.boneInverses[j])));
      skin.updateBones();
    },
  };
}

function meshAvatar(hue: number) {
  const radial = Number(q.get('radial') ?? 24); // ~triangle budget knob
  const parts = JOINTS.map(([a, , b, r], j) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CapsuleGeometry(r, len, 8, radial);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    const count = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? j : 0)), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    return g;
  });
  const geom = mergeGeometries(parts)!;
  const mesh = new THREE.SkinnedMesh(geom, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.6, 0.55) }));
  const skel = makeSkeleton();
  mesh.add(skel.bones[0]);
  mesh.bind(skel);
  mesh.frustumCulled = false;
  return { object: mesh as THREE.Object3D, tris: geom.index!.count / 3, update: (t: number, phase: number) => animate(skel, t, phase) };
}

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // PRD §10.8
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 2.5));
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.6, 4);
camera.lookAt(0, 1, -1);
// covSplats meshes (needed for LBS skinning) only render through a covSplats renderer in Spark 2.4.
const spark = new SparkRenderer({ renderer, covSplats: mode === 'lbs' });
scene.add(spark);

// Background load standing in for the world splat at the PRD LoD budget.
if (WORLD > 0) {
  const world = new PackedSplats({
    construct: (s) => {
      const c = new THREE.Vector3(), sc = new THREE.Vector3(0.03, 0.03, 0.03), quat = new THREE.Quaternion(), col = new THREE.Color();
      for (let i = 0; i < WORLD; i++) {
        c.set((Math.random() - 0.5) * 20, Math.random() * 4, -Math.random() * 15 + 3);
        s.pushSplat(c, sc, quat, 0.8, col.setHSL(0.1 + Math.random() * 0.1, 0.3, 0.3 + Math.random() * 0.3));
      }
    },
  });
  await world.initialized;
  scene.add(new SplatMesh({ packedSplats: world }));
}

const avatars = await Promise.all(
  Array.from({ length: COUNT }, (_, i) => (mode === 'mesh' ? meshAvatar(i / COUNT) : lbsAvatar(i / COUNT))),
);
for (const a of avatars) scene.add(a.object);
const tris = mode === 'mesh' ? (avatars[0] as ReturnType<typeof meshAvatar>).tris : 0;

const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
const WARMUP_MS = 2000, MEASURE_MS = 6000;
const times: number[] = [];
let start = 0, last = 0;
renderer.setAnimationLoop((now: number) => {
  const t = now / 1000;
  avatars.forEach((a, i) => a.update(t, (i * 2 * Math.PI) / COUNT));
  renderer.render(scene, camera);
  if (!start) start = now;
  const elapsed = now - start;
  if (elapsed > WARMUP_MS && elapsed < WARMUP_MS + MEASURE_MS && last) times.push(now - last);
  last = now;
  if (elapsed >= WARMUP_MS + MEASURE_MS && !(window as { benchResult?: unknown }).benchResult) {
    const sorted = [...times].sort((x, y) => x - y);
    const result = {
      mode, splatsPerAvatar: mode === 'mesh' ? 0 : N, trisPerAvatar: tris, avatars: COUNT, worldSplats: WORLD, gpu,
      size: `${renderer.domElement.width}x${renderer.domElement.height}`,
      fps: Math.round((1000 * times.length) / times.reduce((x, y) => x + y, 0) * 10) / 10,
      p95ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
    };
    (window as { benchResult?: unknown }).benchResult = result;
    hud.textContent = JSON.stringify(result, null, 1);
  } else if (!(window as { benchResult?: unknown }).benchResult) {
    hud.textContent = `${mode} · measuring… ${Math.round(elapsed / 100) / 10}s`;
  }
});
