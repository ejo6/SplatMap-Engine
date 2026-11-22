import * as THREE from 'three';
import { slaveVideo } from '../clock';
import { poseAt, type CameraMode, type CamerasFile } from '../camera';
import { loadPeopleLayer, type PeopleLayer, type PeopleLayerShot } from './holo';
import { loadAvatars, type Avatar } from './avatars';
import { avatarWeight, showAvatars } from './blend';

// People in the viewer (PRD §10.5): the people layer (A-10) near the original camera, avatars (A-09) off-axis,
// crossfaded between 10 and 20 degrees (A-11, blend.ts).
// KAN-85: the swap is a short timed fade with hysteresis, not a position-driven crossfade: the two never line up
// exactly, so a long half-blend showed a doubled, sliding person.

const SWAP_SECONDS = 0.3;

export interface PeopleShot extends PeopleLayerShot {
  people?: { id: string; person: string }[];
}

export class People {
  readonly group = new THREE.Group();
  private readonly layerGroup = new THREE.Group();
  private readonly avatarGroup = new THREE.Group();
  private readonly avatars: Avatar[];
  private readonly layer: PeopleLayer | null;
  private readonly cameras: CamerasFile;
  private frame = 0;
  private readonly forward = new THREE.Vector3();
  private readonly origForward = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private avatarsOn = false; // the swap's target (hysteresis, blend.ts)
  private weight = 0; // avatar weight shown now, easing toward avatarsOn
  private last = performance.now();

  constructor(avatars: Avatar[], layer: PeopleLayer | null, cameras: CamerasFile) {
    this.avatars = avatars;
    this.layer = layer;
    this.cameras = cameras;
    if (layer) this.layerGroup.add(layer.mesh);
    for (const a of avatars) this.avatarGroup.add(a.group);
    this.group.add(this.layerGroup, this.avatarGroup);
  }

  /** Clock bus listener: pose every avatar at the shot frame. The people layer follows its own slaved video. */
  setFrame(frame: number) {
    this.frame = frame;
    for (const a of this.avatars) a.setFrame(frame);
  }

  /** Per render frame. In ride-along / return / scrub the video overlay already shows the real people. */
  update(camera: THREE.Camera, mode: CameraMode) {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (mode !== 'walk') {
      this.layerGroup.visible = this.avatarGroup.visible = false;
      this.avatarsOn = false; // re-entering walk starts from the real pixels
      this.weight = 0;
      return;
    }
    const orig = poseAt(this.cameras, this.frame);
    camera.getWorldDirection(this.forward);
    this.origForward.set(0, 0, -1).applyQuaternion(orig.quaternion);
    const angle = THREE.MathUtils.radToDeg(this.forward.angleTo(this.origForward));
    const dist = camera.getWorldPosition(this.position).distanceTo(orig.position);
    this.avatarsOn = showAvatars(this.avatarsOn, avatarWeight(angle, dist));
    const step = dt / SWAP_SECONDS;
    const w = (this.weight = THREE.MathUtils.clamp(this.weight + (this.avatarsOn ? step : -step), 0, 1));
    this.layerGroup.visible = w < 1;
    this.avatarGroup.visible = w > 0;
    if (this.layer) this.layer.opacity = 1 - w; // movers without an avatar (animals, cars) fade out: known limit
    for (const a of this.avatars) a.opacity = w;
  }
}

/** Loads the shot's people layer and avatars and slaves the people-layer video to the master video. */
export async function loadPeople(base: string, shot: PeopleShot, master: HTMLVideoElement, fps: number, cameras: CamerasFile) {
  const [layer, avatars] = await Promise.all([loadPeopleLayer(base, shot), loadAvatars(base, shot.people ?? [])]);
  if (layer) slaveVideo(master, layer.video, fps);
  return new People(avatars, layer, cameras);
}
