import { MasterClock, slaveVideo, unmuteOnFirstGesture } from './clock';

// Dev-only page for SH-02: /src/clock-debug.html?world=test
// Scrub the master video's native controls (repeated seeks) and watch the holo rectangle
// stay within 1 frame of it. The real viewer wires the bus into avatars/people-layer/camera
// instead of a plain <video> tag.

const q = new URLSearchParams(location.search);
const base = `/worlds/${q.get('world') ?? 'test'}/v1/`;
const master = document.getElementById('master') as HTMLVideoElement;
const holo = document.getElementById('holo') as HTMLVideoElement;
const driftStat = document.getElementById('drift-stat')!;
const field = (name: string) => document.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
const fields = { t: field('t'), frame: field('frame'), shot: field('shot'), playing: field('playing'), drift: field('drift') };

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
const frameMs = 1000 / manifest.video.fps;
new MasterClock(master, shot, manifest.video.fps).subscribe((state) => {
  const driftMs = Math.round((holo.currentTime - master.currentTime) * 1000);
  fields.t.textContent = `${state.t.toFixed(3)}s`;
  fields.frame.textContent = String(state.frame);
  fields.shot.textContent = state.shotId;
  fields.playing.textContent = String(state.playing);
  fields.drift.textContent = `${driftMs}ms`;
  driftStat.classList.remove('ok', 'warn', 'bad');
  driftStat.classList.add(Math.abs(driftMs) <= frameMs ? 'ok' : Math.abs(driftMs) <= frameMs * 2 ? 'warn' : 'bad');
});

void master.play();
