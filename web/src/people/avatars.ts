import * as THREE from 'three';
import { SplatMesh, SplatSkinning, SplatSkinningMode } from '@sparkjsdev/spark';

// A-09 / KAN-59: animated people in the viewer (PRD §8.4 person.json, §10.5, FR-23).
// motion.bin (pipeline/s6_place.py) holds, per shot frame, 55 SMPL-X joint matrices (3x4 row-major) that map the
// person's rest space to world. Poses are looked up by exact frame, never interpolated, so a seek or a loop can't
// blend toward another pose: the last pose simply holds until the clock moves (PRD §10.3).
// KAN-78: a person with avatar.kind "splat-lbs" (A-07) renders as their LHM Gaussians, skinned by Spark SplatSkinning
// with bone j = motion[frame][j] and per-splat bones from skin.bin. Without an avatar they render as a skeleton.

export interface PersonFile {
  id: string;
  label: string;
  joints: number;
  parents: number[];
  restJoints: number[][];
  motion: { url: string; frameCount: number };
  visible: number[][];
  avatar?: { kind: string; url: string; skin: string; splats: number } | null;
}

/** A splat-lbs avatar: the LHM Gaussians in rest space and their skinning (PRD §8.4). */
export interface SplatAvatar {
  mesh: SplatMesh;
  skin: SplatSkinning;
}

const FLOATS_PER_JOINT = 12;
const SHADOW_RADIUS = 0.35; // metres
const SHADOW_FADE_HEIGHT = 0.5; // the shadow fades out as the feet rise this far
const FOOT_JOINTS = [10, 11]; // SMPL-X left_foot, right_foot

/** True when `frame` falls inside one of the inclusive [start, end] ranges. */
export function inRanges(frame: number, ranges: number[][]): boolean {
  return ranges.some(([a, b]) => frame >= a && frame <= b);
}

const EDGE_FRAMES = 15; // body placement is unreliable while a person enters or leaves the frame

/** The frame to pose from (KAN-78): `frame` while the person is well inside a visible range, else the nearest
 * reliable frame: the last one seen (or, before the first appearance, the first). Off-screen people are assumed not
 * to move. Each range is trimmed by up to EDGE_FRAMES at both ends, where placement flies off as they cross the edge. */
export function heldFrame(frame: number, ranges: number[][]): number {
  if (!ranges.length) return frame;
  const trimmed = ranges.map(([a, b]) => {
    const m = Math.min(EDGE_FRAMES, Math.floor((b - a) / 4));
    return [a + m, b - m];
  });
  if (inRanges(frame, trimmed)) return frame;
  const before = trimmed.filter(([, b]) => b < frame).map(([, b]) => b);
  return before.length ? Math.max(...before) : Math.min(...trimmed.map(([a]) => a));
}

/** World position of joint j at `frame`: motion[frame][j] @ [rest, 1]. */
export function jointWorld(motion: Float32Array, joints: number, frame: number, j: number, rest: number[], out: THREE.Vector3) {
  const o = (frame * joints + j) * FLOATS_PER_JOINT;
  const [x, y, z] = rest;
  return out.set(
    motion[o] * x + motion[o + 1] * y + motion[o + 2] * z + motion[o + 3],
    motion[o + 4] * x + motion[o + 5] * y + motion[o + 6] * z + motion[o + 7],
    motion[o + 8] * x + motion[o + 9] * y + motion[o + 10] * z + motion[o + 11],
  );
}

export class Avatar {
  readonly group = new THREE.Group();
  readonly person: PersonFile;
  readonly motion: Float32Array;
  private readonly bones: THREE.LineSegments;
  private readonly shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly pairs: [number, number][];
  private readonly tmp = new THREE.Vector3();
  private readonly splat?: SplatAvatar;
  private readonly bone = new THREE.Matrix4();
  private fade = 1; // A-11 blend weight
  private shadowBase = 0.35;

  constructor(person: PersonFile, motion: Float32Array, splat?: SplatAvatar) {
    this.person = person;
    this.motion = motion;
    this.splat = splat;
    this.pairs = person.parents.flatMap((p, j) => (p >= 0 ? [[j, p] as [number, number]] : []));
    const positions = new Float32Array(this.pairs.length * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.bones = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true }));
    this.bones.frustumCulled = false;

    // Blob contact shadow on the y = 0 floor (FR-23).
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(SHADOW_RADIUS, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.position.y = 0.005;
    this.group.add(splat ? splat.mesh : this.bones, this.shadow);
  }

  /** Pose the avatar at shot frame `frame`. A splat avatar holds its last seen pose while off-screen; a skeleton hides. */
  setFrame(frame: number) {
    const { joints, restJoints, motion: m, visible } = this.person;
    let f = Math.min(Math.max(frame, 0), m.frameCount - 1);
    if (this.splat) f = heldFrame(f, visible);
    this.group.visible = inRanges(f, visible);
    if (!this.group.visible) return;

    if (this.splat) {
      const m = this.motion;
      for (let j = 0; j < joints; j++) {
        const o = (f * joints + j) * FLOATS_PER_JOINT;
        this.bone.set(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5], m[o + 6], m[o + 7],
          m[o + 8], m[o + 9], m[o + 10], m[o + 11], 0, 0, 0, 1);
        this.splat.skin.setBoneMatrix(j, this.bone);
      }
      this.splat.skin.updateBones();
    } else {
      const pos = this.bones.geometry.attributes.position as THREE.BufferAttribute;
      this.pairs.forEach(([a, b], i) => {
        jointWorld(this.motion, joints, f, a, restJoints[a], this.tmp);
        pos.setXYZ(i * 2, this.tmp.x, this.tmp.y, this.tmp.z);
        jointWorld(this.motion, joints, f, b, restJoints[b], this.tmp);
        pos.setXYZ(i * 2 + 1, this.tmp.x, this.tmp.y, this.tmp.z);
      });
      pos.needsUpdate = true;
    }

    let x = 0, z = 0, low = Infinity;
    for (const j of FOOT_JOINTS) {
      jointWorld(this.motion, joints, f, j, restJoints[j], this.tmp);
      x += this.tmp.x / FOOT_JOINTS.length;
      z += this.tmp.z / FOOT_JOINTS.length;
      low = Math.min(low, this.tmp.y);
    }
    this.shadow.position.set(x, 0.005, z);
    this.shadowBase = 0.35 * (1 - Math.min(Math.max(low / SHADOW_FADE_HEIGHT, 0), 1));
    this.shadow.material.opacity = this.shadowBase * this.fade;
  }

  /** Overall opacity in [0, 1], for the view-dependent blend with the people layer (A-11). */
  set opacity(v: number) {
    this.fade = v;
    (this.bones.material as THREE.LineBasicMaterial).opacity = v;
    if (this.splat) this.splat.mesh.opacity = v;
    this.shadow.material.opacity = this.shadowBase * v;
  }
}

/** Loads every person of a shot (PRD §8.3 `shots[].people`). `base` is the manifest folder URL. */
export async function loadAvatars(base: string, people: { person: string }[]): Promise<Avatar[]> {
  return Promise.all(
    people.map(async ({ person: path }) => {
      const person = (await fetch(base + path).then((r) => r.json())) as PersonFile;
      const dir = path.slice(0, path.lastIndexOf('/') + 1);
      const buf = await fetch(base + dir + person.motion.url).then((r) => r.arrayBuffer());
      const splat = person.avatar?.kind === 'splat-lbs' ? await loadSplatAvatar(base + dir, person) : undefined;
      return new Avatar(person, new Float32Array(buf), splat); // little-endian float32 (PRD §8.1), native on every target
    }),
  );
}

/** avatar.ply as an ExtSplats mesh (LBS needs covSplats) skinned from skin.bin: N x [4 joint indices, 4 weights]. */
async function loadSplatAvatar(dir: string, person: PersonFile): Promise<SplatAvatar> {
  const avatar = person.avatar!;
  const [mesh, skinBuf] = await Promise.all([
    new SplatMesh({ url: dir + avatar.url, extSplats: true, covSplats: true }).initialized,
    fetch(dir + avatar.skin).then((r) => r.arrayBuffer()),
  ]);
  const w = new Float32Array(skinBuf);
  const skin = new SplatSkinning({ mesh, numBones: person.joints, mode: SplatSkinningMode.LINEAR_BLEND });
  const bi = new THREE.Vector4(), bw = new THREE.Vector4();
  for (let i = 0; i < w.length / 8; i++) {
    const o = i * 8;
    skin.setSplatBones(i, bi.set(w[o], w[o + 1], w[o + 2], w[o + 3]), bw.set(w[o + 4], w[o + 5], w[o + 6], w[o + 7]));
  }
  mesh.skinning = skin;
  mesh.updateGenerator();
  mesh.frustumCulled = false; // skinned splats move far from the rest-space bounds
  return { mesh, skin };
}
