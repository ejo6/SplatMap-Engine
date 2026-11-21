import * as THREE from 'three';

// A-09 / KAN-59: animated people in the viewer (PRD §8.4 person.json, §10.5, FR-23).
// motion.bin (pipeline/s6_place.py) holds, per shot frame, 55 SMPL-X joint matrices (3x4 row-major) that map the
// person's rest space to world. Poses are looked up by exact frame, never interpolated, so a seek or a loop can't
// blend toward another pose: the last pose simply holds until the clock moves (PRD §10.3).
// Until A-07 picks avatar.kind, each person renders as a skeleton driven by those same matrices.

export interface PersonFile {
  id: string;
  label: string;
  joints: number;
  parents: number[];
  restJoints: number[][];
  motion: { url: string; frameCount: number };
  visible: number[][];
}

const FLOATS_PER_JOINT = 12;
const SHADOW_RADIUS = 0.35; // metres
const SHADOW_FADE_HEIGHT = 0.5; // the shadow fades out as the feet rise this far
const FOOT_JOINTS = [10, 11]; // SMPL-X left_foot, right_foot

/** True when `frame` falls inside one of the inclusive [start, end] ranges. */
export function inRanges(frame: number, ranges: number[][]): boolean {
  return ranges.some(([a, b]) => frame >= a && frame <= b);
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

  constructor(person: PersonFile, motion: Float32Array) {
    this.person = person;
    this.motion = motion;
    this.pairs = person.parents.flatMap((p, j) => (p >= 0 ? [[j, p] as [number, number]] : []));
    const positions = new Float32Array(this.pairs.length * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.bones = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffd27a }));
    this.bones.frustumCulled = false;

    // Blob contact shadow on the y = 0 floor (FR-23).
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(SHADOW_RADIUS, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.position.y = 0.005;
    this.group.add(this.bones, this.shadow);
  }

  /** Pose the avatar at shot frame `frame`; hidden outside its visible ranges. */
  setFrame(frame: number) {
    const { joints, restJoints, motion: m, visible } = this.person;
    const f = Math.min(Math.max(frame, 0), m.frameCount - 1);
    this.group.visible = inRanges(f, visible);
    if (!this.group.visible) return;

    const pos = this.bones.geometry.attributes.position as THREE.BufferAttribute;
    this.pairs.forEach(([a, b], i) => {
      jointWorld(this.motion, joints, f, a, restJoints[a], this.tmp);
      pos.setXYZ(i * 2, this.tmp.x, this.tmp.y, this.tmp.z);
      jointWorld(this.motion, joints, f, b, restJoints[b], this.tmp);
      pos.setXYZ(i * 2 + 1, this.tmp.x, this.tmp.y, this.tmp.z);
    });
    pos.needsUpdate = true;

    let x = 0, z = 0, low = Infinity;
    for (const j of FOOT_JOINTS) {
      jointWorld(this.motion, joints, f, j, restJoints[j], this.tmp);
      x += this.tmp.x / FOOT_JOINTS.length;
      z += this.tmp.z / FOOT_JOINTS.length;
      low = Math.min(low, this.tmp.y);
    }
    this.shadow.position.set(x, 0.005, z);
    this.shadow.material.opacity = 0.35 * (1 - Math.min(Math.max(low / SHADOW_FADE_HEIGHT, 0), 1));
  }
}

/** Loads every person of a shot (PRD §8.3 `shots[].people`). `base` is the manifest folder URL. */
export async function loadAvatars(base: string, people: { person: string }[]): Promise<Avatar[]> {
  return Promise.all(
    people.map(async ({ person: path }) => {
      const person = (await fetch(base + path).then((r) => r.json())) as PersonFile;
      const dir = path.slice(0, path.lastIndexOf('/') + 1);
      const buf = await fetch(base + dir + person.motion.url).then((r) => r.arrayBuffer());
      return new Avatar(person, new Float32Array(buf)); // little-endian float32 (PRD §8.1), native on every target
    }),
  );
}
