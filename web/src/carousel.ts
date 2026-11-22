// KAN-88: the built worlds (gallery.json, PRD §9) as a rotating carousel, on the landing page and on /unavailable.

export interface World {
  youtubeId: string;
  title: string;
  thumb: string;
  credit: string;
}

const ROTATE_MS = 6000;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let worlds: Promise<World[]> | undefined;
/** Valid gallery entries only; rejects if gallery.json can't be read. */
export function loadWorlds(): Promise<World[]> {
  worlds ??= fetch('/gallery.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Gallery unavailable'))))
    .then((list) => (Array.isArray(list) ? list : []).filter((w): w is World =>
      Boolean(w) && /^[\w-]{11}$/.test(w.youtubeId) &&
      [w.title, w.credit, w.thumb].every((v) => typeof v === 'string' && v.trim() !== '')));
  return worlds;
}

/** YouTube's 1280x720 cover, else the world's own 640x360 thumb.jpg. A missing maxres answers 404 or a 120x90 placeholder. */
function hiResThumb(world: World, eager: boolean) {
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  if (!eager) img.loading = 'lazy';
  const fallback = () => img.src !== new URL(world.thumb, location.href).href && (img.src = world.thumb);
  img.addEventListener('error', fallback);
  img.addEventListener('load', () => img.naturalWidth <= 120 && fallback());
  img.src = `https://i.ytimg.com/vi/${world.youtubeId}/maxresdefault.jpg`;
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
    slide.href = '/w/' + world.youtubeId;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${list.length}: ${world.title}`);
    const title = document.createElement('strong');
    title.textContent = world.title;
    const credit = document.createElement('small');
    credit.textContent = 'Video by ' + world.credit;
    slide.append(hiResThumb(world, i === 0), title, credit);
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
