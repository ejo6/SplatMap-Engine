import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './landing.css';
import { youtubeId } from './youtube';
import { waterlineY } from './waterline';

// K-11 landing page (PRD §1, §4.2, FR-03/04). The hero is a mountain lake: the reflection is the flat video,
// the land above the waterline is the world, and the link field sits on the waterline between them.

const PHOTO_CREDIT = {
  photographer: 'Redd Francisco',
  profile: 'https://unsplash.com/@reddfrancisco',
  photo: 'https://unsplash.com/photos/gdQnsMbhkUs',
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const app = document.querySelector('#app')!;
app.innerHTML = `
<svg class="defs" aria-hidden="true" focusable="false">
  <filter id="ripple" x="-4%" y="-4%" width="108%" height="108%">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.09" numOctaves="2" seed="4" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>
<header class="top">
  <a class="brand" href="/">Step Into the Video</a>
  <nav aria-label="Sections"><a href="#worlds">Worlds</a><a href="#how">How it works</a><a href="#extension">Extension</a></nav>
</header>
<main>
  <section class="lake" aria-labelledby="hero-title">
    <div class="photo" aria-hidden="true">
      <img class="land" src="/landing/moraine-2560.webp" srcset="/landing/moraine-1280.webp 1280w, /landing/moraine-2560.webp 2560w" sizes="100vw" alt="" fetchpriority="high">
      <div class="reflection">
        <img src="/landing/moraine-2560.webp" srcset="/landing/moraine-1280.webp 1280w, /landing/moraine-2560.webp 2560w" sizes="100vw" alt="">
        <img class="echo" alt="" hidden>
      </div>
    </div>
    <h1 id="hero-title">Every video is a&nbsp;window.</h1>
    <form class="shore" novalidate>
      <label class="sr" for="video">YouTube link</label>
      <div class="field">
        <input id="video" type="text" inputmode="url" placeholder="Paste a YouTube link" aria-describedby="hint error" autocomplete="off" spellcheck="false">
        <button type="submit">Step inside</button>
      </div>
      <p class="door">We turn it into a door.</p>
      <p id="hint" class="hint">Watch, Shorts or youtu.be links. You walk inside while the original video plays.</p>
      <p id="error" class="error" role="alert"></p>
    </form>
    <p class="credit">Moraine Lake, Banff. Photo by <a href="${PHOTO_CREDIT.profile}">${PHOTO_CREDIT.photographer}</a> on <a href="${PHOTO_CREDIT.photo}">Unsplash</a></p>
  </section>

  <section class="band worlds" id="worlds" aria-labelledby="worlds-title">
    <h2 id="worlds-title">Worlds you can walk into</h2>
    <p class="lede">Each one began as a YouTube video. Open one to ride along with its camera, then step off the path.</p>
    <div id="gallery" class="gallery" aria-live="polite"><p class="empty">Loading worlds…</p></div>
  </section>

  <section class="band how" id="how" aria-labelledby="how-title">
    <h2 id="how-title">From watching to walking</h2>
    <svg class="ridge" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 96 L120 70 L210 84 L330 30 L420 58 L520 40 L600 12 L700 46 L790 34 L900 66 L1010 22 L1100 54 L1200 40" />
    </svg>
    <ol class="trail">
      <li><h3>Find a video</h3><p>Click <strong>Step inside</strong> next to Like on YouTube, or paste the link on the lake above.</p></li>
      <li><h3>We rebuild what the camera saw</h3><p>Camera paths and depth become a splat world you can walk through. The people in it become avatars you can circle, blended with their real pixels.</p></li>
      <li><h3>Walk in</h3><p>The original video keeps playing as the clock. Grab the timeline and you glide back to exactly where the camera stood.</p></li>
    </ol>
  </section>

  <section class="fog" aria-labelledby="fog-title">
    <div class="haze" aria-hidden="true"></div>
    <div class="fog-copy">
      <h2 id="fog-title">Where the camera never looked, there&rsquo;s fog.</h2>
      <p>We don&rsquo;t invent what wasn&rsquo;t filmed. Everything the camera saw is solid ground, and everything it missed fades into mist at the edges. Press <kbd>F</kbd> inside a world to see the difference.</p>
    </div>
  </section>

  <section class="band extension" id="extension" aria-labelledby="ext-title">
    <div>
      <h2 id="ext-title">Step inside from YouTube</h2>
      <p class="lede">The Chrome extension puts a button next to Like on every video.</p>
    </div>
    <div class="ext-demo" aria-hidden="true"><span class="pill">Step inside</span></div>
    <ol class="steps">
      <li>Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>.</li>
      <li>Choose <strong>Load unpacked</strong> and select the project&rsquo;s <code>extension/</code> folder.</li>
      <li>Play any YouTube video and click <strong>Step inside</strong>.</li>
    </ol>
  </section>
</main>
<footer class="foot">
  <p>Built at Hack Western 13.</p>
  <p>Hero photo: <a href="${PHOTO_CREDIT.photo}">Moraine Lake at 6AM</a> by <a href="${PHOTO_CREDIT.profile}">${PHOTO_CREDIT.photographer}</a>, Unsplash License. Demo worlds credit their creators.</p>
</footer>`;

// --- Waterline: keep the form and the reflection split exactly on the photo's lake edge. ---
const lake = document.querySelector<HTMLElement>('.lake')!;
const placeWaterline = () => lake.style.setProperty('--waterline', `${waterlineY(lake.clientWidth, lake.clientHeight)}px`);
placeWaterline();
new ResizeObserver(placeWaterline).observe(lake);

// --- Signature interaction: the pointer stirs the reflection; it settles back to a slow swell. ---
const displacement = document.querySelector('feDisplacementMap')!;
const turbulence = document.querySelector('feTurbulence')!;
let stir = 0;
if (!reduceMotion) {
  lake.addEventListener('pointermove', (e) => {
    if (e.clientY > lake.getBoundingClientRect().top + parseFloat(lake.style.getPropertyValue('--waterline'))) stir = Math.min(stir + 3, 26);
  });
  const swell = (now: number) => {
    stir *= 0.94;
    displacement.setAttribute('scale', (6 + stir).toFixed(2));
    turbulence.setAttribute('baseFrequency', `0.004 ${(0.09 + 0.012 * Math.sin(now / 1400)).toFixed(4)}`);
    requestAnimationFrame(swell);
  };
  requestAnimationFrame(swell);
}

// --- The link field: a valid link floats that video's own thumbnail on the water, as its reflection. ---
const form = document.querySelector<HTMLFormElement>('.shore')!;
const input = document.querySelector<HTMLInputElement>('#video')!;
const error = document.querySelector('#error')!;
const echo = document.querySelector<HTMLImageElement>('.echo')!;
echo.addEventListener('load', () => (echo.hidden = false));
echo.addEventListener('error', () => (echo.hidden = true));

input.addEventListener('input', () => {
  error.textContent = '';
  input.removeAttribute('aria-invalid');
  const id = youtubeId(input.value);
  if (!id) {
    echo.hidden = true;
    return;
  }
  stir = 26; // the water answers
  echo.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = youtubeId(input.value);
  if (!id) {
    error.textContent = 'That isn’t a YouTube video link. Paste a watch, Shorts or youtu.be link.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  if (reduceMotion) return location.assign('/w/' + id);
  lake.classList.add('rising'); // rise through the waterline into the peaks, then open the world
  setTimeout(() => location.assign('/w/' + id), 720);
});

// --- Gallery (gallery.json, PRD §9): title, thumbnail and creator credit for every world. ---
async function loadGallery() {
  const gallery = document.querySelector('#gallery')!;
  const say = (text: string) => {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    gallery.replaceChildren(p);
  };
  try {
    const response = await fetch('/gallery.json');
    if (!response.ok) throw new Error('Gallery unavailable');
    const worlds = await response.json();
    if (!Array.isArray(worlds)) throw new Error('Invalid gallery');
    gallery.replaceChildren();
    for (const world of worlds) {
      if (!world || !/^[\w-]{11}$/.test(world.youtubeId) ||
          ![world.title, world.credit, world.thumb, world.youtubeId].every((v) => typeof v === 'string' && v.trim())) continue;
      const card = document.createElement('a');
      card.className = 'world';
      card.href = '/w/' + world.youtubeId;
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.src = world.thumb;
      const title = document.createElement('strong');
      title.textContent = world.title;
      const credit = document.createElement('small');
      credit.textContent = 'Video by ' + world.credit;
      card.append(img, title, credit);
      gallery.append(card);
    }
    if (!gallery.childElementCount) say('The first two worlds are still being built from their videos. They’ll appear here the moment you can walk into them.');
  } catch {
    say('The worlds couldn’t load. Refresh the page to try again.');
  }
}
void loadGallery();
