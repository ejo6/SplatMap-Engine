// SH-02: master clock and layer sync bus (PRD §10.1, FR-15)

export interface Shot {
  id: string;
  start: number;
  frameCount: number;
}

export interface ClockState {
  t: number;
  frame: number;
  shotId: string;
  playing: boolean;
}

export type ClockListener = (state: ClockState) => void;

/** The shot-relative frame for a media time (PRD §8.1), shared by anything that seeks directly. */
export function shotFrame(t: number, shot: Shot, fps: number): number {
  return Math.min(Math.max(Math.round((t - shot.start) * fps), 0), shot.frameCount - 1);
}

/**
 * Wraps the master `<video>` element. A `requestVideoFrameCallback` loop publishes
 * `{t, frame, shotId, playing}` on a small bus; every other layer reads from it instead
 * of keeping its own timer (PRD §10.1).
 */
export class MasterClock {
  readonly video: HTMLVideoElement;
  private shot: Shot;
  private readonly fps: number;
  private readonly listeners = new Set<ClockListener>();
  private state: ClockState;

  constructor(video: HTMLVideoElement, shot: Shot, fps: number) {
    this.video = video;
    this.shot = shot;
    this.fps = fps;
    this.state = { t: video.currentTime, frame: shotFrame(video.currentTime, shot, fps), shotId: shot.id, playing: false };

    const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      this.publish(metadata.mediaTime);
      this.video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    video.addEventListener('play', () => this.publish(video.currentTime));
    video.addEventListener('pause', () => this.publish(video.currentTime));
    video.addEventListener('seeked', () => this.publish(video.currentTime));
  }

  /** Switches the clock to a different shot (for multi-shot worlds, SH-10). */
  setShot(shot: Shot) {
    this.shot = shot;
    this.publish(this.video.currentTime);
  }

  subscribe(listener: ClockListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  get current(): ClockState {
    return this.state;
  }

  private publish(t: number) {
    this.state = { t, frame: shotFrame(t, this.shot, this.fps), shotId: this.shot.id, playing: !this.video.paused };
    for (const listener of this.listeners) listener(this.state);
  }
}

const FRAME_DRIFT_SECONDS = (fps: number) => 1 / fps;
const PLAYBACK_RATE_NUDGE = 0.05;

/**
 * Keeps a secondary video (e.g. `holo.mp4`) slaved to the master: drift above one frame is
 * corrected by seeking, smaller drift by a ±5% playbackRate nudge (PRD §10.1).
 */
export function slaveVideo(master: HTMLVideoElement, slave: HTMLVideoElement, fps: number): () => void {
  const maxDrift = FRAME_DRIFT_SECONDS(fps);

  const resync = () => {
    slave.currentTime = master.currentTime;
    slave.playbackRate = 1;
  };
  const onPlay = () => {
    resync();
    void slave.play();
  };
  const onPause = () => slave.pause();
  const onSeeked = () => resync();
  const onFrame = (_now: number, _metadata: VideoFrameCallbackMetadata) => {
    const drift = slave.currentTime - master.currentTime;
    slave.playbackRate = Math.abs(drift) <= maxDrift ? 1 : drift > 0 ? 1 - PLAYBACK_RATE_NUDGE : 1 + PLAYBACK_RATE_NUDGE;
    if (Math.abs(drift) > maxDrift * 2) slave.currentTime = master.currentTime;
    slave.requestVideoFrameCallback(onFrame);
  };

  master.addEventListener('play', onPlay);
  master.addEventListener('pause', onPause);
  master.addEventListener('seeked', onSeeked);
  slave.requestVideoFrameCallback(onFrame);
  if (!master.paused) onPlay();

  return () => {
    master.removeEventListener('play', onPlay);
    master.removeEventListener('pause', onPause);
    master.removeEventListener('seeked', onSeeked);
  };
}

/** Audio stays muted until the first user gesture, per browser autoplay policy and PRD §10.1. */
export function unmuteOnFirstGesture(video: HTMLVideoElement, onGesture?: () => void) {
  const unmute = () => {
    onGesture?.();
    video.muted = false;
    window.removeEventListener('pointerdown', unmute);
    window.removeEventListener('keydown', unmute);
  };
  window.addEventListener('pointerdown', unmute, { once: true });
  window.addEventListener('keydown', unmute, { once: true });
}
