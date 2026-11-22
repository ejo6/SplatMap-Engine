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

/** The path tube + marker; `group.visible` defaults to false (ride-along), toggled by `setVisible`. */
export class GhostPath {
  readonly group = new THREE.Group();

  private readonly cameras: CamerasFile;
  private readonly marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;

  constructor(cameras: CamerasFile) {
    this.cameras = cameras;

    const points = cameras.frames.map((f) => poseAt(cameras, f.f).position);
    // 'centripetal' avoids the loops/overshoot 'catmullrom' can introduce when points along a
    // real (non-uniformly spaced) camera path bunch up or double back on themselves.
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const tubularSegments = Math.min(Math.max(points.length - 1, 1), MAX_TUBULAR_SEGMENTS);
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, PATH_RADIUS, PATH_RADIAL_SEGMENTS, false);
    const material = new THREE.MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: PATH_OPACITY, depthWrite: false, toneMapped: false });
    const path = new THREE.Mesh(geometry, material);
    path.renderOrder = 1; // nothing in this scene writes real depth (see fog.ts), so draw after the world
    this.group.add(path);

    const markerMaterial = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: MARKER_OPACITY, depthWrite: false, toneMapped: false });
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS, 12, 8), markerMaterial);
    this.marker.renderOrder = 1;
    this.group.add(this.marker);

    this.group.visible = false;
  }

  /** Drives the marker to the original camera's position at this shot frame (clock bus, PRD §10.1). */
  setFrame(frame: number) {
    this.marker.position.copy(poseAt(this.cameras, frame).position);
  }

  /** FR-30: visible in walk mode only, hidden in ride-along (and scrubbing/returning). */
  setVisible(visible: boolean) {
    this.group.visible = visible;
  }
}
