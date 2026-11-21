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

const EDGE_SOFTNESS = 1.5; // metres either side of the sdf=0 boundary over which fog ramps in
const HEIGHT_FALLOFF = 1 / 3; // 1/metre; each higher layer is dimmer, so fog reads as ground mist, not sky tint
const LAYER_HEIGHTS = [0.05, 0.3, 0.6, 1.0, 1.5, 2.2, 3.2]; // metres above the floor; more, closer-spaced layers read as a softer gradient than a few widely-spaced ones
const SEGMENTS = 48; // per layer plane; fine enough for EDGE_SOFTNESS to read as a soft gradient

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
  const width = sdf.width * sdf.cellSize;
  const depth = sdf.height * sdf.cellSize;
  const geometry = new THREE.PlaneGeometry(width, depth, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(sdf.origin[0] + width / 2, y, sdf.origin[1] + depth / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const intensity = fogIntensity(sdf, position.getX(i), y, position.getZ(i));
    colors[i * 3] = color.r * intensity;
    colors[i * 3 + 1] = color.g * intensity;
    colors[i * 3 + 2] = color.b * intensity;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** The fog volume (PRD §10.4 "Fog volume"): stacked ground-fog layers; `group` is empty if the shot has no SDF yet. */
export class FogVolume {
  readonly group = new THREE.Group();

  constructor(sdf: WalkSdfGrid | undefined, fogColor: THREE.Color) {
    if (!sdf) return;
    for (const y of LAYER_HEIGHTS) {
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      this.group.add(new THREE.Mesh(buildLayerGeometry(sdf, y, fogColor), material));
    }
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
