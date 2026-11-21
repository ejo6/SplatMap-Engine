import * as THREE from 'three';

// A-10 / KAN-60: people layer (PRD §8.4 holo, §10.5). A ~256x144 grid displaced by holo.mp4's
// inverse depth and placed at the original camera, so from that pose people are exactly the real pixels.
// Encoding comes from pipeline/s8_people_layer.py (docs/people-pipeline.md).

export interface Cameras {
  fps: number;
  width: number;
  height: number;
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  frames: { f: number; c2w: number[] }[];
}

export interface PeopleLayerShot {
  cameras: string;
  peopleLayer?: { video: string; meta: string };
}

const GRID_W = 256;
const GRID_H = 144;
const MAX_STRETCH = 1.08; // PRD §10.5: discard triangles whose depth ratio exceeds this

const vertexShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 nearFar;   // metres, from holo.json for the displayed frame
  uniform vec4 K;         // fx, fy, cx, cy in video pixels
  uniform vec2 size;      // video width, height
  uniform vec2 cell;      // one grid step in uv
  varying vec2 vUv;
  varying float vValid;
  varying float vBad;

  // uv: image coords with v = 1 at the top. Depth lives in the bottom half of the texture.
  float depthAt(vec2 uv) {
    float v = texture2D(map, vec2(uv.x, uv.y * 0.5)).r * 255.0;
    if (v < 8.0) return -1.0;
    float inv = 1.0 / nearFar.y + max(v - 16.0, 0.0) / 239.0 * (1.0 / nearFar.x - 1.0 / nearFar.y);
    return 1.0 / inv;
  }

  void main() {
    vUv = uv;
    float d = depthAt(uv);
    vValid = d > 0.0 ? 1.0 : 0.0;
    // Flag the vertex if any valid neighbour's depth differs by more than the max ratio. The flag is 0/1,
    // so every triangle touching a flagged vertex interpolates > 0 and is discarded whole (no slivers).
    float ratio = 1.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        float n = depthAt(uv + vec2(float(i) * cell.x, float(j) * cell.y));
        if (n > 0.0 && d > 0.0) ratio = max(ratio, max(n, d) / min(n, d));
      }
    }
    vBad = ratio > ${MAX_STRETCH.toFixed(2)} ? 1.0 : 0.0;

    float z = max(d, 0.01);
    float px = uv.x * size.x;
    float py = (1.0 - uv.y) * size.y;
    // Camera space in the three.js convention: +X right, +Y up, looking down -Z.
    vec3 p = vec3((px - K.z) / K.x * z, -(py - K.w) / K.y * z, -z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float opacity;
  varying vec2 vUv;
  varying float vValid;
  varying float vBad;

  void main() {
    if (vValid < 0.999 || vBad > 0.0) discard;
    gl_FragColor = vec4(texture2D(map, vec2(vUv.x, 0.5 + vUv.y * 0.5)).rgb, opacity);
  }
`;

export class PeopleLayer {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Secondary video: slave it to the master clock (SH-02). It drives its own pose and near/far. */
  readonly video: HTMLVideoElement;
  /** Shot frame currently shown by the people layer. */
  frame = 0;

  private readonly cameras: Cameras;
  private readonly nearFar: number[][];

  constructor(video: HTMLVideoElement, cameras: Cameras, nearFar: number[][]) {
    this.video = video;
    this.cameras = cameras;
    this.nearFar = nearFar;
    const { fx, fy, cx, cy } = cameras.intrinsics;
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        map: { value: new THREE.VideoTexture(video) }, // raw values (NoColorSpace): depth must not be gamma-converted
        nearFar: { value: new THREE.Vector2(1, 2) },
        K: { value: new THREE.Vector4(fx, fy, cx, cy) },
        size: { value: new THREE.Vector2(cameras.width, cameras.height) },
        cell: { value: new THREE.Vector2(1 / (GRID_W - 1), 1 / (GRID_H - 1)) },
        opacity: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, GRID_W - 1, GRID_H - 1), material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false; // vertices are placed in the shader
    this.setFrame(0);

    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      this.setFrame(Math.round(meta.mediaTime * cameras.fps));
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  /** Point the layer at shot frame f (clamped, PRD §8.1). Hidden when the frame has no movers. */
  setFrame(f: number) {
    f = Math.min(Math.max(f, 0), this.cameras.frames.length - 1);
    this.frame = f;
    const [near, far] = this.nearFar[Math.min(f, this.nearFar.length - 1)] ?? [0, 0];
    this.mesh.visible = far > 0;
    this.mesh.material.uniforms.nearFar.value.set(near, far);
    this.mesh.matrix.set(...(this.cameras.frames[f].c2w as Parameters<THREE.Matrix4['set']>)); // row-major
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  set opacity(v: number) {
    this.mesh.material.uniforms.opacity.value = v;
  }
}

/** Loads the shot's people layer. Returns null when the shot has none. `base` is the manifest folder URL. */
export async function loadPeopleLayer(base: string, shot: PeopleLayerShot): Promise<PeopleLayer | null> {
  if (!shot.peopleLayer) return null;
  const [cameras, meta] = await Promise.all([
    fetch(base + shot.cameras).then((r) => r.json() as Promise<Cameras>),
    fetch(base + shot.peopleLayer.meta).then((r) => r.json() as Promise<{ frames: number[][] }>),
  ]);
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = base + shot.peopleLayer.video;
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error(`people layer video failed: ${video.src}`)), { once: true });
  });
  return new PeopleLayer(video, cameras, meta.frames);
}
