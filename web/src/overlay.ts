import * as THREE from 'three';
import { type CamerasFile, type CameraMode, type Pose } from './camera';

// SH-04: video overlay at the original pose (PRD §10.2, §10.5)

const DISTANCE = 2; // metres in front of the original camera
const FADE_MS = 250; // PRD §10.2 walk row
const SCRUB_OPACITY = 0.8; // PRD §10.3

/** The plane's size at `DISTANCE` so its edges exactly match the original camera's frustum. */
function frustumSizeAt(cameras: CamerasFile, distance: number) {
  const { width, height, intrinsics } = cameras;
  return { width: (width * distance) / intrinsics.fx, height: (height * distance) / intrinsics.fy };
}

/**
 * A plane textured with the master video, glued to the original recorded pose (not wherever
 * the viewer's camera currently is) so ride-along shows real pixels and the splat is visible
 * only past the frame edges. Fades by mode: 100% in ride-along, 0% in walk (PRD §10.2).
 */
export class VideoOverlay {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly videoTexture: THREE.VideoTexture;
  private opacity = 1;
  private targetOpacity = 1;
  private mode: CameraMode = 'ride-along';

  constructor(video: HTMLVideoElement, cameras: CamerasFile) {
    const { width, height } = frustumSizeAt(cameras, DISTANCE);
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: this.videoTexture, transparent: true, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  /** SCRUBBING swaps in a cheap sprite-thumbnail texture; `null` reverts to the live video (PRD §10.3). */
  setTexture(texture: THREE.Texture | null) {
    this.mesh.material.map = texture ?? this.videoTexture;
    this.mesh.material.needsUpdate = true;
  }

  /** Drives the plane to the original pose for this shot frame, from the clock bus (PRD §10.1). */
  setFrame(pose: Pose) {
    const forward = new THREE.Vector3(0, 0, -DISTANCE).applyQuaternion(pose.quaternion);
    this.mesh.position.copy(pose.position).add(forward);
    this.mesh.quaternion.copy(pose.quaternion);
  }

  /** 100% in ride-along/returning, fades out in walk, 80% while scrubbing (PRD §10.2, §10.3). */
  setMode(mode: CameraMode) {
    this.targetOpacity = mode === 'walk' ? 0 : mode === 'scrubbing' ? SCRUB_OPACITY : 1;
    // NFR-04: the overlay must appear within 100ms of starting a drag, faster than the normal fade.
    if (mode === 'scrubbing' && this.mode !== 'scrubbing') this.opacity = SCRUB_OPACITY;
    this.mode = mode;
  }

  update(dtSeconds: number) {
    const step = (dtSeconds * 1000) / FADE_MS;
    this.opacity = THREE.MathUtils.clamp(this.opacity + Math.sign(this.targetOpacity - this.opacity) * step, 0, 1);
    this.mesh.material.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0;
  }
}
