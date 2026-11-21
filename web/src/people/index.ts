import * as THREE from 'three';
import { slaveVideo } from '../clock';
import { poseAt, type CameraMode, type CamerasFile } from '../camera';
import { loadPeopleLayer, type PeopleLayerShot } from './holo';
import { loadAvatars, type Avatar } from './avatars';

// People in the viewer (PRD §10.5): the people layer (A-10) near the original camera, avatars (A-09) off-axis.
// P0 rule: hard switch at 15 degrees or 0.5 m from the original pose. A-11 replaces it with a 10-20 degree crossfade.

const SWITCH_ANGLE_DEG = 15;
const SWITCH_DIST_M = 0.5;

export interface PeopleShot extends PeopleLayerShot {
  people?: { id: string; person: string }[];
}

/** Which representation to show for a viewer this far (angle between view directions, distance) from the original camera. */
export function viewChoice(angleDeg: number, distM: number): 'layer' | 'avatars' {
  return angleDeg <= SWITCH_ANGLE_DEG && distM <= SWITCH_DIST_M ? 'layer' : 'avatars';
}

export class People {
  readonly group = new THREE.Group();
  private readonly layerGroup = new THREE.Group();
  private readonly avatarGroup = new THREE.Group();
  private readonly avatars: Avatar[];
  private readonly cameras: CamerasFile;
  private frame = 0;
  private readonly forward = new THREE.Vector3();
  private readonly origForward = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  constructor(avatars: Avatar[], layerMesh: THREE.Object3D | null, cameras: CamerasFile) {
    this.avatars = avatars;
    this.cameras = cameras;
    if (layerMesh) this.layerGroup.add(layerMesh);
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
    if (mode !== 'walk') {
      this.layerGroup.visible = this.avatarGroup.visible = false;
      return;
    }
    const orig = poseAt(this.cameras, this.frame);
    camera.getWorldDirection(this.forward);
    this.origForward.set(0, 0, -1).applyQuaternion(orig.quaternion);
    const angle = THREE.MathUtils.radToDeg(this.forward.angleTo(this.origForward));
    const choice = viewChoice(angle, camera.getWorldPosition(this.position).distanceTo(orig.position));
    this.layerGroup.visible = choice === 'layer';
    this.avatarGroup.visible = choice === 'avatars'; // movers without an avatar (animals, cars) fade out here: known limit
  }
}

/** Loads the shot's people layer and avatars and slaves the people-layer video to the master video. */
export async function loadPeople(base: string, shot: PeopleShot, master: HTMLVideoElement, fps: number, cameras: CamerasFile) {
  const [layer, avatars] = await Promise.all([loadPeopleLayer(base, shot), loadAvatars(base, shot.people ?? [])]);
  if (layer) slaveVideo(master, layer.video, fps);
  return new People(avatars, layer?.mesh ?? null, cameras);
}
