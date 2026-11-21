// SH-05: transport UI (PRD §10.7, FR-19)

export interface ThumbsSprite {
  sprite: string;
  fps: number;
  cols: number;
  rows: number;
  count: number;
  tileWidth: number;
  tileHeight: number;
}

const SEEK_STEP = 5; // seconds, PRD §10.7 arrow keys

function formatTime(seconds: number): string {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A YouTube-style bottom bar: play/pause, a seek bar with hover thumbnails and shot-boundary
 * ticks, a time display, and Space/←/→ shortcuts that work globally (including pointer-locked).
 * Loops the video at the end. The master `<video>`'s own `seeked`/`play`/`pause` events already
 * drive the clock bus (SH-02), so this never touches the camera or overlay directly.
 */
export function createTransportUI(
  video: HTMLVideoElement,
  thumbsBase: string,
  thumbs: ThumbsSprite,
  shotStarts: number[],
): HTMLElement {
  video.loop = true; // FR-19: loop at the end

  const root = document.createElement('div');
  root.className = 'transport';

  const playButton = document.createElement('button');
  playButton.className = 'transport-play';
  playButton.type = 'button';
  playButton.setAttribute('aria-label', 'Play/pause');

  const time = document.createElement('span');
  time.className = 'transport-time';

  const bar = document.createElement('div');
  bar.className = 'transport-bar';
  const progress = document.createElement('div');
  progress.className = 'transport-progress';
  const scrubber = document.createElement('div');
  scrubber.className = 'transport-scrubber';
  bar.append(progress, scrubber);

  const ticks = shotStarts.slice(1).map((start) => {
    const tick = document.createElement('div');
    tick.className = 'transport-tick';
    bar.appendChild(tick);
    return { el: tick, start };
  });

  const preview = document.createElement('div');
  preview.className = 'transport-preview';
  preview.style.backgroundImage = `url(${thumbsBase}${thumbs.sprite})`;
  preview.style.width = `${thumbs.tileWidth}px`;
  preview.style.height = `${thumbs.tileHeight}px`;
  preview.hidden = true;
  const previewTime = document.createElement('span');
  previewTime.className = 'transport-preview-time';
  preview.appendChild(previewTime);

  root.append(playButton, time, bar, preview);

  function setPlaying(playing: boolean) {
    playButton.textContent = playing ? '⏸' : '▶';
    playButton.setAttribute('aria-pressed', String(playing));
  }
  setPlaying(!video.paused);
  playButton.addEventListener('click', () => (video.paused ? void video.play() : video.pause()));
  video.addEventListener('play', () => setPlaying(true));
  video.addEventListener('pause', () => setPlaying(false));

  function layout() {
    const duration = video.duration || 0;
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
    const pct = duration ? (video.currentTime / duration) * 100 : 0;
    progress.style.width = `${pct}%`;
    scrubber.style.left = `${pct}%`;
    if (duration) for (const tick of ticks) tick.el.style.left = `${(tick.start / duration) * 100}%`;
  }
  video.addEventListener('timeupdate', layout);
  video.addEventListener('loadedmetadata', layout);
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) layout();

  function timeAtClientX(clientX: number): number {
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return frac * (video.duration || 0);
  }

  function showPreviewAt(clientX: number) {
    const t = timeAtClientX(clientX);
    const index = Math.min(Math.floor(t * thumbs.fps), thumbs.count - 1);
    const col = index % thumbs.cols;
    const row = Math.floor(index / thumbs.cols);
    preview.style.backgroundPosition = `-${col * thumbs.tileWidth}px -${row * thumbs.tileHeight}px`;
    // preview is a sibling of bar inside root, so its offset is relative to root, not the bar.
    preview.style.left = `${clientX - root.getBoundingClientRect().left}px`;
    previewTime.textContent = formatTime(t);
    preview.hidden = false;
  }

  let dragging = false;
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    video.currentTime = timeAtClientX(e.clientX);
    showPreviewAt(e.clientX);
  });
  bar.addEventListener('pointermove', (e) => {
    if (dragging) video.currentTime = timeAtClientX(e.clientX);
    showPreviewAt(e.clientX);
  });
  bar.addEventListener('pointerup', (e) => {
    dragging = false;
    bar.releasePointerCapture(e.pointerId);
  });
  bar.addEventListener('pointerleave', () => {
    if (!dragging) preview.hidden = true;
  });

  // Global so Space/←/→ work even while the viewer canvas holds pointer lock (FR-19 acceptance).
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      video.paused ? void video.play() : video.pause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - SEEK_STEP);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SEEK_STEP);
    }
  });

  return root;
}
