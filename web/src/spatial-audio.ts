import { Quaternion, Vector3, type Camera } from 'three';

/** The context listener stays at the origin facing -Z. Express the emitter in that space. */
export class SpatialSoundtrack {
  private readonly panner: PannerNode;
  private readonly stereo: GainNode;
  private readonly spatial: GainNode;
  private readonly relative = new Vector3();
  private readonly inverseRotation = new Quaternion();
  private lastMix = 0;

  constructor(context: BaseAudioContext, source: AudioNode) {
    this.panner = new PannerNode(context, {
      panningModel: 'equalpower', rolloffFactor: 0, channelCount: 1, channelCountMode: 'explicit',
    });
    this.stereo = context.createGain();
    this.spatial = context.createGain();
    this.spatial.gain.value = 0;
    source.connect(this.stereo).connect(context.destination);
    source.connect(this.panner).connect(this.spatial).connect(context.destination);
  }

  update(camera: Camera, recordedPosition: Vector3, walking: boolean) {
    this.relative.subVectors(recordedPosition, camera.position)
      .applyQuaternion(this.inverseRotation.copy(camera.quaternion).invert());
    const time = this.panner.context.currentTime;
    const { x, y, z } = this.relative;
    this.panner.positionX.value = x;
    this.panner.positionY.value = y;
    this.panner.positionZ.value = z;
    // At the recorded camera there is no bearing. Ease from original stereo to a point source.
    const mix = walking ? Math.min(1, this.relative.length() / 0.5) : 0;
    if (mix !== this.lastMix) {
      this.stereo.gain.setTargetAtTime(1 - mix, time, 0.02);
      this.spatial.gain.setTargetAtTime(mix, time, 0.02);
      this.lastMix = mix;
    }
  }
}

/** Call during the unmute gesture. Leave native playback intact if audio cannot initialize. */
export async function startSpatialSoundtrack(video: HTMLVideoElement) {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    await context.resume();
    const input = context.createGain();
    const track = new SpatialSoundtrack(context, input);
    context.createMediaElementSource(video).connect(input);
    return track;
  } catch {
    if (context) void context.close();
    return undefined;
  }
}
