import { MasterClock, slaveVideo, unmuteOnFirstGesture } from './clock';

// Dev-only page for SH-02: /src/clock-debug.html?world=test
// Scrub the master video's native controls (repeated seeks) and watch the holo rectangle
// stay within 1 frame of it. The real viewer wires the bus into avatars/people-layer/camera
// instead of a plain <video> tag.

const q = new URLSearchParams(location.search);
const base = `/worlds/${q.get('world') ?? 'test'}/v1/`;
const hud = document.getElementById('hud')!;
const master = document.getElementById('master') as HTMLVideoElement;
const holo = document.getElementById('holo') as HTMLVideoElement;

const manifest = await fetch(base + 'manifest.json').then((r) => r.json());
const shot = manifest.shots[0];

master.src = base + manifest.video.url;
master.loop = true;
unmuteOnFirstGesture(master);

holo.src = base + shot.peopleLayer.video;
holo.muted = true;
holo.loop = true;

await Promise.all(
  [master, holo].map((v) => new Promise((resolve) => v.addEventListener('loadedmetadata', resolve, { once: true }))),
);

slaveVideo(master, holo, manifest.video.fps);
new MasterClock(master, shot, manifest.video.fps).subscribe((state) => {
  const driftMs = Math.round((holo.currentTime - master.currentTime) * 1000);
  hud.textContent = `t=${state.t.toFixed(3)}s  frame=${state.frame}  shot=${state.shotId}  playing=${state.playing}  holo drift=${driftMs}ms`;
});

void master.play();
