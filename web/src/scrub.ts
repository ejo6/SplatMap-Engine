import * as THREE from 'three';
import { shotFrame, type Shot } from './clock';
import { CameraRig, poseAt, type CamerasFile } from './camera';
import { VideoOverlay } from './overlay';
import type { ThumbsSprite } from './transport';

// SH-06: scrub state machine (PRD §10.3, FR-20, NFR-04)

function loadTexture(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url);
}

/**
 * The PRD §10.3 table, driven by the transport seek bar's pointer events: pointerdown tweens
 * the camera to the drag pose and fades the overlay to 80% (any mode -> SCRUBBING); dragging
 * keeps the camera locked to the pose at the drag time and shows a cheap sprite thumbnail
 * instead of the (not-yet-seeked) video frame; pointerup commits the real seek and, once it
 * lands, re-syncs every layer, fades the overlay back and resumes playback if it was playing.
 */
export class ScrubController {
  private readonly thumbTexture: THREE.Texture;
  private wasPlaying = false;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly shot: Shot,
    private readonly fps: number,
    private readonly cameras: CamerasFile,
    private readonly rig: CameraRig,
    private readonly overlay: VideoOverlay,
    private readonly thumbs: ThumbsSprite,
    thumbTexture: THREE.Texture,
  ) {
    this.thumbTexture = thumbTexture;
    this.thumbTexture.colorSpace = THREE.SRGBColorSpace;
  }

  static async create(
    video: HTMLVideoElement,
    shot: Shot,
    fps: number,
    cameras: CamerasFile,
    rig: CameraRig,
    overlay: VideoOverlay,
    thumbsBase: string,
    thumbs: ThumbsSprite,
  ): Promise<ScrubController> {
    const texture = await loadTexture(thumbsBase + thumbs.sprite);
    return new ScrubController(video, shot, fps, cameras, rig, overlay, thumbs, texture);
  }

  get scrubbing(): boolean {
    return this.rig.mode === 'scrubbing';
  }

  /** pointerdown on the seek bar: any mode -> SCRUBBING. */
  start(t: number) {
    this.wasPlaying = !this.video.paused;
    this.video.pause();
    this.rig.startScrub(shotFrame(t, this.shot, this.fps));
    this.showThumbnailAt(t);
  }

  /** Continued dragging: camera keeps tracking the drag time, thumbnail keeps updating. */
  drag(t: number) {
    if (!this.scrubbing) return;
    this.rig.setScrubFrame(shotFrame(t, this.shot, this.fps));
    this.showThumbnailAt(t);
  }

  /** pointerup: commit the real seek, then re-sync every layer and resume on `seeked`. */
  end(t: number) {
    if (!this.scrubbing) return;
    const onSeeked = () => {
      this.video.removeEventListener('seeked', onSeeked);
      const frame = shotFrame(this.video.currentTime, this.shot, this.fps);
      this.rig.mode = 'ride-along';
      this.rig.setFrame(frame);
      this.overlay.setFrame(poseAt(this.cameras, frame));
      this.overlay.setTexture(null);
      if (this.wasPlaying) void this.video.play();
    };
    this.video.addEventListener('seeked', onSeeked);
    this.video.currentTime = t;
  }

  private showThumbnailAt(t: number) {
    const index = Math.min(Math.max(Math.floor(t * this.thumbs.fps), 0), this.thumbs.count - 1);
    const col = index % this.thumbs.cols;
    const row = Math.floor(index / this.thumbs.cols);
    this.thumbTexture.repeat.set(1 / this.thumbs.cols, 1 / this.thumbs.rows);
    this.thumbTexture.offset.set(col / this.thumbs.cols, 1 - (row + 1) / this.thumbs.rows);
    this.overlay.setTexture(this.thumbTexture);
  }
}
