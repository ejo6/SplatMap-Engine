// KAN-88: the built worlds as a rotating carousel, on the landing page and on /unavailable.
// KAN-93: the list is the world folders actually on this machine (/worlds-index.json, served by vite.config.ts),
// so every card routes to a world that exists here. gallery.json only adds curated titles, credits and order.

import { creditText, type Credit } from './hud';

export interface World {
  id: string; // the worlds/ folder name, routed as /w/<id>
  title: string;
  credit: string;
  video: string;
}

interface DiskWorld {
  id: string;
  youtubeId: string;
  title?: string;
  credit?: Credit;
  video: string;
}

const ROTATE_MS = 6000;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

let worlds: Promise<World[]> | undefined;
/** The worlds on disk, curated ones first; rejects if the index can't be read. */
export function loadWorlds(): Promise<World[]> {
  worlds ??= Promise.all([
    fetch('/worlds-index.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('World index unavailable')))),
    fetch('/gallery.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]).then(([disk, gallery]: [DiskWorld[], { youtubeId?: string; title?: string; credit?: string }[]]) => {
    const curated = Array.isArray(gallery) ? gallery : [];
    const rank = (w: DiskWorld) => {
      const i = curated.findIndex((g) => g?.youtubeId === w.id || g?.youtubeId === w.youtubeId);
      return i < 0 ? curated.length : i;
    };
    return (Array.isArray(disk) ? disk : [])
      .filter((w) => /^[\w-]+$/.test(w?.id))
      .sort((a, b) => rank(a) - rank(b))
      .map((w) => {
        const g = curated[rank(w)];
        return {
          id: w.id,
          title: text(g?.title) || text(w.title) || w.id,
          credit: text(g?.credit) ? 'Video by ' + text(g?.credit) : creditText(w.credit, w.id).text,
          video: `/worlds/${w.id}/v1/${w.video}`,
        };
      });
  });
  return worlds;
}

/** YouTube's 1280x720 cover for YouTube ids, else (or if YouTube has none) a frame of the world's own video. */
function cover(world: World, eager: boolean): HTMLElement {
  const frame = () => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = world.video + '#t=0.5'; // media fragment: the decoder shows the frame at 0.5 s without playing
    v.setAttribute('aria-hidden', 'true');
    return v;
  };
  if (!/^[\w-]{11}$/.test(world.id)) return frame();
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  if (!eager) img.loading = 'lazy';
  const fallback = () => img.replaceWith(frame());
  img.addEventListener('error', fallback, { once: true });
  img.addEventListener('load', () => img.naturalWidth <= 120 && fallback()); // a missing maxres can answer a 120x90 placeholder
  img.src = `https://i.ytimg.com/vi/${world.id}/maxresdefault.jpg`;
  return img;
}

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" /></svg>`;

function emptyState(): Node[] {
  // Mist where a world isn't ready yet, the same fog the worlds use where nothing was filmed.
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.setAttribute('aria-hidden', 'true');
  const note = document.createElement('p');
  note.className = 'slot-note';
  note.textContent = 'The first worlds are still being built from their videos. They’ll appear here the moment you can walk into them.';
  return [slot, note];
}

export async function mountCarousel(root: HTMLElement) {
  let list: World[];
  try {
    list = await loadWorlds();
  } catch {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'The worlds couldn’t load. Refresh the page to try again.';
    return root.replaceChildren(p);
  }
  if (!list.length) return root.replaceChildren(...emptyState());

  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', 'Worlds you can walk into');

  const track = document.createElement('div');
  track.className = 'track';
  const slides = list.map((world, i) => {
    const slide = document.createElement('a');
    slide.className = 'world';
    slide.href = '/w/' + world.id;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${list.length}: ${world.title}`);
    const title = document.createElement('strong');
    title.textContent = world.title;
    const credit = document.createElement('small');
    credit.textContent = world.credit;
    slide.append(cover(world, i === 0), title, credit);
    return slide;
  });
  track.append(...slides);
  root.replaceChildren(track);
  if (slides.length < 2) return root.classList.add('single');

  // Controls: back / forward, and a waypoint per world.
  const controls = document.createElement('div');
  controls.className = 'controls';
  const button = (label: string, html: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = html;
    return b;
  };
  const prev = button('Previous world', icon('M15 5l-7 7 7 7'));
  const next = button('Next world', icon('M9 5l7 7-7 7'));
  prev.className = next.className = 'step';
  const dots = list.map((world) => {
    const d = button('Show ' + world.title, '');
    d.className = 'dot';
    return d;
  });
  controls.append(prev, ...dots, next);
  root.append(controls);

  let current = 0;
  const show = (i: number, smooth = !reduceMotion) => {
    const s = slides[(i + slides.length) % slides.length];
    track.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - track.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  const mark = () => {
    const centre = track.scrollLeft + track.clientWidth / 2;
    current = slides.reduce((best, s, i) =>
      Math.abs(s.offsetLeft + s.offsetWidth / 2 - centre) < Math.abs(slides[best].offsetLeft + slides[best].offsetWidth / 2 - centre) ? i : best, 0);
    slides.forEach((s, i) => s.classList.toggle('current', i === current));
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === current)));
  };
  track.addEventListener('scroll', mark, { passive: true });
  mark();

  // Rotation: stops for good once the visitor takes the controls, and waits while they point at or focus it.
  let rotating = !reduceMotion;
  let held = false;
  const take = (go: () => void) => () => ((rotating = false), go());
  prev.addEventListener('click', take(() => show(current - 1)));
  next.addEventListener('click', take(() => show(current + 1)));
  dots.forEach((d, i) => d.addEventListener('click', take(() => show(i))));
  for (const [type, hold] of [['pointerenter', true], ['pointerleave', false], ['focusin', true], ['focusout', false]] as const) {
    root.addEventListener(type, () => (held = hold));
  }
  track.addEventListener('pointerdown', () => (rotating = false)); // a swipe or drag means they're browsing
  setInterval(() => rotating && !held && !document.hidden && show(current + 1), ROTATE_MS);
}
