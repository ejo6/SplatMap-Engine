import * as THREE from 'three';
import { sampleSdf, type WalkSdfGrid } from './walk-bounds.ts';

// SH-08: fog rendering + F toggle (PRD §10.4, FR-21): a few stacked, CPU-baked ground-fog
// layers that fade in near/past the walk boundary (reusing the walk SDF as a coverage proxy
// until E-06 ships real coverage.bin for baked worlds), with height falloff so it reads as
// ground mist rather than a sky tint.
//
// The PRD describes this as a per-splat shader fade (Spark's worldModifier hook) plus a
// screen-space depth-reconstructed volumetric pass. Both were tried and dropped: this
// project's pinned Spark build (2.4.0) throws "No next accumulator" from inside its own
// renderer whenever ANY extra custom-shader GPU program shares the WebGL context in the same
// frame - verified across every combination tried: a world-space ThreeJS mesh with a plain
// THREE.ShaderMaterial, a Spark worldModifier set post-construction via updateGenerator(), and
// a worldModifier passed at SplatMesh construction time. All three reproduce the exact same
// error on both a LOD-streamed (.rad) and a non-LOD (.spz) world, with nothing in the modifier
// graph beyond an identity passthrough - so this isn't a bug in the fog math, it's a hard
// constraint on this Spark version. Flagged to the team (see the KAN-51 ticket comment); a real
// per-splat fade needs either a Spark upgrade or a different technique once that's verified.
//
// What ships instead: a handful of large, fully CPU pre-computed (no custom shader - see
// below), additively-blended planes using only THREE.MeshBasicMaterial with vertex colors,
// which IS safe alongside SparkRenderer (also verified). Each vertex's colour is baked once
// from the SDF at that world position, ramping from black (additive blending: contributes
// nothing) to the fog colour across `EDGE_SOFTNESS` metres either side of the sdf=0 boundary.
// Stacking a few layers at increasing height, each dimmed further by HEIGHT_FALLOFF, gives a
// crude but real sense of depth without any per-pixel shader work at all.
//
// Even padded by OUTER_PAD, those layers are still flat rectangles: past their far edge -
// wherever the reconstruction has no splats at all (sky, the far background) - the view fell
// through to raw black. A `FogDome` closes that off: one big inverted sphere, same
// MeshBasicMaterial/vertex-color technique, sitting just past the layers in every direction
// (not only outward along the ground). Because every point on a sphere is by definition the
// same distance from its own center, there's no SDF gradient to bake across its surface -
// it's already well past the walk radius everywhere, so it's one near-uniform fog colour, only
// broken up by a small per-vertex hash so it reads as soft mist rather than a flat colour card.

const EDGE_SOFTNESS = 2; // metres either side of the sdf=0 boundary over which fog ramps in
const HEIGHT_FALLOFF = 1 / 3; // 1/metre; each higher layer is dimmer, so fog reads as ground mist, not sky tint
const LAYER_HEIGHTS = [0.05, 0.2, 0.4, 0.65, 0.95, 1.3, 1.75, 2.3, 3.0, 4.0]; // metres above the floor; more, closer-spaced layers read as a softer gradient than a few widely-spaced ones
const SEGMENTS = 48; // per layer plane; fine enough for EDGE_SOFTNESS to read as a soft gradient
// Additive blending sums every overlapping layer, so each layer's own colour is divided by the
// layer count - the worst case (looking straight down a fully-fogged stack) then caps out at
// roughly `fogColor`, instead of several times brighter.
const LAYER_COLOR_SCALE = 1 / LAYER_HEIGHTS.length;
// How far past the walk SDF's own grid the fog plane extends, in metres. Splats aren't
// reconstructed anywhere near this far out, so the plane's own rectangular edge - which would
// otherwise show up as a hard-edged slab against the sky or distant trees (see KAN-51 review
// feedback) - ends up past where the world itself already fades to black, and inside the
// FogDome besides (see below).
const OUTER_PAD = 60;

const DOME_RADIUS = 160; // metres; clears OUTER_PAD's own far corners on every committed world, so the layers' edges never show
const DOME_SEGMENTS = 32;
const DOME_NOISE = 0.12; // +/- fraction of brightness jitter per vertex, so the dome reads as soft mist rather than a flat color

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Fog intensity in [0, 1] at a world (x, y, z): 0 deep inside the walk boundary, 1 well past it, ramping across `EDGE_SOFTNESS`, dimmed by height. */
export function fogIntensity(sdf: WalkSdfGrid, x: number, y: number, z: number): number {
  const heightFactor = Math.exp(-Math.max(y, 0) * HEIGHT_FALLOFF);
  return smoothstep(-EDGE_SOFTNESS, EDGE_SOFTNESS, sampleSdf(sdf, x, z)) * heightFactor;
}

/** A single horizontal fog layer, its vertex colours baked once from the SDF (PRD §10.4 "Splat fade" thresholds, adapted). */
function buildLayerGeometry(sdf: WalkSdfGrid, y: number, color: THREE.Color): THREE.BufferGeometry {
  const width = sdf.width * sdf.cellSize + 2 * OUTER_PAD;
  const depth = sdf.height * sdf.cellSize + 2 * OUTER_PAD;
  const centerX = sdf.origin[0] + (sdf.width * sdf.cellSize) / 2;
  const centerZ = sdf.origin[1] + (sdf.height * sdf.cellSize) / 2;
  const geometry = new THREE.PlaneGeometry(width, depth, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(centerX, y, centerZ);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const intensity = fogIntensity(sdf, position.getX(i), y, position.getZ(i)) * LAYER_COLOR_SCALE;
    colors[i * 3] = color.r * intensity;
    colors[i * 3 + 1] = color.g * intensity;
    colors[i * 3 + 2] = color.b * intensity;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Deterministic pseudo-random value in [0, 1) from a position, so the dome's jitter needs no runtime noise library. */
function hashNoise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** The outer fog dome: one big inverted sphere past the ground layers, so unreconstructed sky and distance read as soft mist instead of black (see module comment). */
function buildDomeGeometry(centerX: number, centerZ: number, color: THREE.Color): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(DOME_RADIUS, DOME_SEGMENTS, DOME_SEGMENTS / 2);
  geometry.translate(centerX, 0, centerZ);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const jitter = 1 - DOME_NOISE + 2 * DOME_NOISE * hashNoise(position.getX(i), position.getY(i), position.getZ(i));
    colors[i * 3] = color.r * jitter;
    colors[i * 3 + 1] = color.g * jitter;
    colors[i * 3 + 2] = color.b * jitter;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** The fog volume (PRD §10.4 "Fog volume"): stacked ground-fog layers plus the outer dome; `group` is empty if the shot has no SDF yet. */
export class FogVolume {
  readonly group = new THREE.Group();

  constructor(sdf: WalkSdfGrid | undefined, fogColor: THREE.Color) {
    if (!sdf) return;
    const material = () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    for (const y of LAYER_HEIGHTS) this.group.add(new THREE.Mesh(buildLayerGeometry(sdf, y, fogColor), material()));

    const centerX = sdf.origin[0] + (sdf.width * sdf.cellSize) / 2;
    const centerZ = sdf.origin[1] + (sdf.height * sdf.cellSize) / 2;
    const dome = new THREE.Mesh(buildDomeGeometry(centerX, centerZ, fogColor), material());
    // Nothing in this scene writes real depth (splats don't; these fog materials don't either -
    // see the module comment), so the transparent render queue's own distance sort is all that's
    // left, and it's wrong for a sphere this big: it ranks the dome by its *center* (near the
    // player, so "close"), not its surface (always far away), and would draw it last - on top of
    // everything. A render order below the scene default (0) pins it to draw first instead, like
    // any other background, so the world and the ground layers always composite over it.
    dome.renderOrder = -1;
    this.group.add(dome);
  }

  setEnabled(enabled: boolean) {
    this.group.visible = enabled;
  }
}

/** Wires the F key to the fog volume, per PRD §10.7 ("the boundary stays active"). */
export function bindFogToggle(volume: FogVolume) {
  let enabled = true;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.repeat) return;
    enabled = !enabled;
    volume.setEnabled(enabled);
  });
}
