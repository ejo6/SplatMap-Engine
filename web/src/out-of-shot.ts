import * as THREE from 'three';

// SH-09: out-of-shot panel (PRD §10.6, FR-25). `cameras.json` only has poses for the
// reconstructed shot, so once `t` leaves it there's no world and no original pose to show.
// Instead: fade the splat world and people out, veil the view in the same fog colour, and play
// the master video on a panel that rides along with whichever camera (ride-along or walk) is
// active, since it isn't glued to a pose that doesn't exist out there.

export interface UnreconstructedRange {
  start: number;
  end: number;
}

/** True while `t` falls inside one of the manifest's `unreconstructed` ranges (PRD §8.3). */
export function isUnreconstructed(t: number, ranges: UnreconstructedRange[]): boolean {
  return ranges.some((r) => t >= r.start && t < r.end);
}

const FADE_MS = 300; // PRD §10.6 P1 crossfade duration, reused here for the P0 panel's own fade
const PANEL_DISTANCE = 2.2; // metres in front of the camera
const PANEL_WIDTH = 3.2; // metres
const VEIL_RADIUS = 1.4; // metres; small and depth-test-free, so it reliably fills the view around the camera

/**
 * Rides along with the camera (`update` re-parents it there every frame, PRD §10.1 "every layer
 * reads from the bus"): a solid fog-coloured veil plus the master video on a panel in front of
 * it. `presence` is 1 fully inside the shot and 0 fully faded to the panel; callers drive the
 * world/people opacity and visibility from it so everything fades together.
 */
export class OutOfShotFx {
  readonly group = new THREE.Group();
  presence = 1;

  private readonly veil: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private active = false;

  constructor(video: HTMLVideoElement, aspect: number, fogColor: THREE.Color) {
    const veilMaterial = new THREE.MeshBasicMaterial({
      color: fogColor,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
      toneMapped: false,
    });
    this.veil = new THREE.Mesh(new THREE.SphereGeometry(VEIL_RADIUS, 24, 16), veilMaterial);
    this.veil.renderOrder = 10;

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const panelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthTest: false, toneMapped: false });
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_WIDTH / aspect), panelMaterial);
    this.panel.position.set(0, 0, -PANEL_DISTANCE);
    this.panel.renderOrder = 11; // after the veil, so the video reads on top of the fog colour

    this.group.add(this.veil, this.panel);
    this.group.visible = false;
  }

  /** Call once per clock update with whether `t` is in `unreconstructed` right now. */
  setActive(active: boolean) {
    this.active = active;
  }

  /** Call once per render frame: tweens `presence`, fades the veil/panel, and head-locks the group to `camera`. */
  update(camera: THREE.Camera, dtSeconds: number) {
    const target = this.active ? 0 : 1;
    const step = (dtSeconds * 1000) / FADE_MS;
    this.presence = THREE.MathUtils.clamp(this.presence + Math.sign(target - this.presence) * step, 0, 1);

    const fogged = 1 - this.presence;
    this.group.visible = fogged > 0;
    this.veil.material.opacity = fogged;
    this.panel.material.opacity = fogged;

    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
  }
}
