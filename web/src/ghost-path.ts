import * as THREE from 'three';
import { poseAt, type CamerasFile } from './camera.ts';

// SH-11: ghost camera path (PRD FR-30). A faint line tracing the original camera's path
// through the shot, with a small marker at the current frame - visible in walk mode only, so
// it reads as a map of where the footage went rather than clutter during ride-along, where the
// video overlay already shows the original path directly.

// A plain THREE.Line always renders at 1px regardless of its material's linewidth (a long-
// standing WebGL/ANGLE limitation three.js can't work around), which reads as basically
// invisible against a busy splat scene. A thin tube mesh gives it real, perspective-correct
// width instead.
const PATH_COLOR = 0xaab4ff; // pale, slightly cool "ghost" tint - distinct from the white fog
const PATH_OPACITY = 0.35; // faint but visible (acceptance criterion)
const PATH_RADIUS = 0.025; // metres
const PATH_RADIAL_SEGMENTS = 6;
const MAX_TUBULAR_SEGMENTS = 2000; // caps geometry size on very long/high-fps shots
const MARKER_COLOR = 0xaab4ff;
const MARKER_OPACITY = 0.6;
const MARKER_RADIUS = 0.07; // metres
// SH-12: the floor style lays the same path flat on the floor (y = 0 in every world, E-03), the travelled part
// brighter, so it reads as "where the camera has been so far" rather than a line hanging in the air.
const FLOOR_Y = 0.02; // metres, just above the floor so it doesn't z-fight
const FLOOR_RADIUS = 0.04; // metres, a little wider: it's seen at a grazing angle
const DONE_OPACITY = 0.85;

export type PathStyle = 'off' | 'air' | 'floor';

/** Fraction of the path's length travelled by `frame`. TubeGeometry samples its curve by arc length, so this is also
 * the fraction of tube segments to highlight. `cumulative[i]` is the path length up to camera frame i. */
export function pathFraction(cumulative: number[], frame: number): number {
  const total = cumulative[cumulative.length - 1];
  return total > 0 ? cumulative[Math.min(Math.max(frame, 0), cumulative.length - 1)] / total : 0;
}

function tube(points: THREE.Vector3[], radius: number, opacity: number) {
  // 'centripetal' avoids the loops/overshoot 'catmullrom' can introduce when points along a
  // real (non-uniformly spaced) camera path bunch up or double back on themselves.
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const tubularSegments = Math.min(Math.max(points.length - 1, 1), MAX_TUBULAR_SEGMENTS);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, PATH_RADIAL_SEGMENTS, false);
  const material = new THREE.MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1; // nothing in this scene writes real depth (see fog.ts), so draw after the world
  return { mesh, tubularSegments };
}

/** The path tube + marker; `group.visible` defaults to false (ride-along), toggled by `setVisible`. */
export class GhostPath {
  readonly group = new THREE.Group();

  private readonly cameras: CamerasFile;
  private readonly marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly air: THREE.Mesh;
  private readonly floor = new THREE.Group();
  private readonly done: THREE.Mesh;
  private readonly doneSegments: number;
  private readonly cumulative: number[];
  private style: PathStyle = 'air';
  private frame = 0;

  constructor(cameras: CamerasFile) {
    this.cameras = cameras;

    const points = cameras.frames.map((f) => poseAt(cameras, f.f).position);
    this.air = tube(points, PATH_RADIUS, PATH_OPACITY).mesh;
    this.group.add(this.air);

    const flat = points.map((p) => new THREE.Vector3(p.x, FLOOR_Y, p.z));
    this.cumulative = flat.map(() => 0);
    for (let i = 1; i < flat.length; i++) this.cumulative[i] = this.cumulative[i - 1] + flat[i].distanceTo(flat[i - 1]);
    const done = tube(flat, FLOOR_RADIUS * 1.05, DONE_OPACITY);
    this.done = done.mesh;
    this.doneSegments = done.tubularSegments;
    this.floor.add(tube(flat, FLOOR_RADIUS, PATH_OPACITY).mesh, this.done);
    this.floor.visible = false;

    const markerMaterial = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: MARKER_OPACITY, depthWrite: false, toneMapped: false });
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS, 12, 8), markerMaterial);
    this.marker.renderOrder = 1;
    this.group.add(this.marker);

    this.group.add(this.floor); // after the marker: children[0] tube, [1] marker, [2] floor
    this.group.visible = false;
  }

  /** Drives the marker to the original camera's position at this shot frame (clock bus, PRD §10.1), and in the
   * floor style lights up the path travelled so far. */
  setFrame(frame: number) {
    this.frame = frame;
    this.marker.position.copy(poseAt(this.cameras, frame).position);
    if (this.style === 'floor') this.marker.position.y = FLOOR_Y;
    const segments = Math.round(pathFraction(this.cumulative, frame) * this.doneSegments);
    this.done.geometry.setDrawRange(0, segments * PATH_RADIAL_SEGMENTS * 6); // TubeGeometry: 6 indices per quad, segment by segment
  }

  /** SH-12 HUD toggle: off, the path in the air as the camera flew it, or flat on the floor with the travelled part lit. */
  setStyle(style: PathStyle) {
    this.style = style;
    this.air.visible = style === 'air';
    this.floor.visible = style === 'floor';
    this.marker.visible = style !== 'off';
    this.setFrame(this.frame);
  }

  /** FR-30: visible in walk mode only, hidden in ride-along (and scrubbing/returning). */
  setVisible(visible: boolean) {
    this.group.visible = visible;
  }
}
