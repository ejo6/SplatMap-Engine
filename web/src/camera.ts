import * as THREE from 'three';
import { clampMoveForColliders, resolveWalkMove, type WalkSdfGrid } from './walk-bounds';

// SH-03: camera modes - ride-along, walk, return (PRD §10.2, FR-16-18)
// SH-07: walk boundary - SDF damping/push/slide, plus colliders (PRD §10.4, FR-22)

export interface CamerasFile {
  fps: number;
  width: number;
  height: number;
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  frames: { f: number; c2w: number[] }[];
}

export type CameraMode = 'ride-along' | 'walk' | 'returning' | 'scrubbing';

/** Optional walk-area bounds (PRD §10.4); a shot with no E-06 output yet omits both and walking is unbounded. */
export interface WalkBounds {
  sdf?: WalkSdfGrid;
  colliders?: THREE.Object3D[];
}

const WALK_SPEED = 1.4; // m/s, PRD §10.2
const RUN_SPEED = 3;
const RETURN_MS = 400;
const SCRUB_SMOOTH_TAU = 0.12; // seconds; PRD §10.3 says tween 300-500ms, this settles in about that window
const LOOK_SPEED = 0.0025; // radians per pixel of mouse movement
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const WASD_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const RUN_CODES = new Set(['ShiftLeft', 'ShiftRight']);

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** The original recorded camera's pose at a shot frame (PRD §8.1), shared by every layer that tracks it. */
export function poseAt(cameras: CamerasFile, frame: number): Pose {
  const f = cameras.frames[Math.min(Math.max(frame, 0), cameras.frames.length - 1)];
  const matrix = new THREE.Matrix4().set(...(f.c2w as THREE.Matrix4Tuple));
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());
  return { position, quaternion };
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Owns the viewer's single camera across its three modes. Ride-along reads `cameras.json`
 * per clock frame; walk is pointer-lock WASD at a fixed eye height; return (R) tweens back
 * to the current ride-along pose without seeking the video.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'ride-along';

  private readonly canvas: HTMLElement;
  private readonly cameras: CamerasFile;
  private readonly eyeHeight: number;
  private readonly bounds: WalkBounds;
  private frame = 0;

  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private readonly walkPos = new THREE.Vector3();

  private readonly returnFrom: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private returnElapsedMs = 0;
  private scrubFrame = 0;

  constructor(canvas: HTMLElement, aspect: number, cameras: CamerasFile, eyeHeight: number, bounds: WalkBounds = {}) {
    this.canvas = canvas;
    this.cameras = cameras;
    this.eyeHeight = eyeHeight;
    this.bounds = bounds;

    const fovY = THREE.MathUtils.radToDeg(2 * Math.atan(cameras.height / 2 / cameras.intrinsics.fy));
    this.camera = new THREE.PerspectiveCamera(fovY, aspect, 0.01, 1000);
    this.applyPose(poseAt(cameras, 0));

    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** Called from the clock bus (PRD §10.1). Drives the camera only in ride-along. */
  setFrame(frame: number) {
    this.frame = frame;
    if (this.mode === 'ride-along') this.applyPose(poseAt(this.cameras, frame));
  }

  /** Advance walk movement / the return tween. Ride-along needs no per-tick work. */
  update(dtSeconds: number) {
    if (this.mode === 'returning') this.updateReturn(dtSeconds);
    else if (this.mode === 'walk') this.updateWalk(dtSeconds);
    else if (this.mode === 'scrubbing') this.updateScrub(dtSeconds);
  }

  /** SCRUBBING (PRD §10.3): pointerdown on the seek bar, from any mode. Tweens to the drag pose. */
  startScrub(frame: number) {
    this.scrubFrame = frame;
    this.mode = 'scrubbing';
  }

  /** Called on every drag move; the camera eases toward this pose (updateScrub), "locked" to it once caught up. */
  setScrubFrame(frame: number) {
    this.scrubFrame = frame;
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.code === 'KeyR') return this.startReturn();
    if (e.code === 'KeyC') return this.toggleRideAlong();
    if (document.pointerLockElement !== this.canvas) return;
    if (WASD_CODES.has(e.code)) {
      this.enterWalk();
      this.keys.add(e.code);
    } else if (RUN_CODES.has(e.code)) {
      this.keys.add(e.code);
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (document.pointerLockElement !== this.canvas) return;
    this.enterWalk();
    this.yaw -= e.movementX * LOOK_SPEED;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Any movement input leaves ride-along (FR-18), seeding the walk pose from where the camera is now. */
  private enterWalk() {
    if (this.mode === 'walk' || this.mode === 'scrubbing') return;
    this.walkPos.copy(this.camera.position).setY(this.eyeHeight);
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
    this.mode = 'walk';
  }

  /** C: an instant switch, unlike R's 400ms tween (PRD §10.7). */
  private toggleRideAlong() {
    if (this.mode === 'scrubbing') return;
    if (this.mode === 'ride-along') this.enterWalk();
    else this.mode = 'ride-along';
  }

  /** R: tween to the current original pose over 400ms, without seeking (PRD §10.2). */
  private startReturn() {
    if (this.mode === 'ride-along' || this.mode === 'scrubbing') return;
    this.returnFrom.position.copy(this.camera.position);
    this.returnFrom.quaternion.copy(this.camera.quaternion);
    this.returnElapsedMs = 0;
    this.mode = 'returning';
  }

  private updateReturn(dtSeconds: number) {
    this.returnElapsedMs += dtSeconds * 1000;
    const t = Math.min(this.returnElapsedMs / RETURN_MS, 1);
    const target = poseAt(this.cameras, this.frame);
    const eased = easeOutCubic(t);

    this.camera.position.lerpVectors(this.returnFrom.position, target.position, eased);
    this.camera.quaternion.copy(this.returnFrom.quaternion).slerp(target.quaternion, eased);

    if (t >= 1) this.mode = 'ride-along';
  }

  private updateWalk(dtSeconds: number) {
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (running ? RUN_SPEED : WALK_SPEED) * dtSeconds;
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const forward = new THREE.Vector3(-sinYaw, 0, -cosYaw);
    const right = new THREE.Vector3(cosYaw, 0, -sinYaw);

    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);

    if (move.lengthSq() > 0) {
      const delta = move.normalize().multiplyScalar(speed);
      const bounded = resolveWalkMove(this.bounds.sdf, { x: this.walkPos.x, z: this.walkPos.z }, { x: delta.x, z: delta.z }, dtSeconds);
      delta.set(bounded.x, 0, bounded.z);
      const clamped = this.bounds.colliders?.length ? clampMoveForColliders(this.bounds.colliders, this.walkPos, delta) : delta;
      this.walkPos.add(clamped); // eye height is fixed on entering walk mode (PRD §10.4), so y never moves here
    }

    this.camera.position.copy(this.walkPos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  /** "Camera locked to pose at the drag time" (PRD §10.3): eases toward the scrub target each tick. */
  private updateScrub(dtSeconds: number) {
    const target = poseAt(this.cameras, this.scrubFrame);
    const amount = 1 - Math.exp(-dtSeconds / SCRUB_SMOOTH_TAU);
    this.camera.position.lerp(target.position, amount);
    this.camera.quaternion.slerp(target.quaternion, amount);
  }

  private applyPose(pose: Pose) {
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
  }
}
