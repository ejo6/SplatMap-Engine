import './landing.css';
import { youtubeId } from './youtube';
import { drawLandscape } from './landscape';

const app = document.querySelector('#app')!;
app.innerHTML = `
<header><a class="brand" href="/"><i class="mark" aria-hidden="true"></i>Step Into the Video</a><nav><a href="#worlds">Demo worlds</a><a href="#guide">How it works</a></nav></header>
<main>
<section class="hero">
  <div class="scene" aria-hidden="true"><canvas></canvas></div>
  <div class="intro"><h1>Every video<br>is a window.<br><em>We turn it into a door.</em></h1>
  <p>Step inside a filmed scene and walk beyond the camera while the original video plays.</p>
  <form novalidate><label for="video">YouTube link</label><div class="field"><input id="video" type="text" inputmode="url" placeholder="Paste a YouTube link" aria-describedby="error" autocomplete="off"><button>Step inside</button></div><span id="error" role="alert"></span></form></div>
</section>
<section class="section" id="worlds"><h2>Demo worlds</h2><div id="gallery" aria-live="polite">Loading gallery…</div></section>
<section class="section guide" id="guide"><div><h2>How it works</h2><p>Open a processed video to ride along with its camera. Use WASD and your mouse to explore. Where the camera never looked, the scene fades into fog.</p></div><div><h2>Open from YouTube</h2><p>In Chrome, enable Developer mode at <code>chrome://extensions</code>, choose <strong>Load unpacked</strong>, and select the project’s <code>extension/</code> folder. Then choose <strong>Step inside</strong> beside Like on a video.</p></div></section>
</main>`;

drawLandscape(document.querySelector('canvas')!);
const input = document.querySelector('input')!;
const error = document.querySelector('#error')!;
document.querySelector('form')!.addEventListener('submit', event => {
  event.preventDefault();
  const id = youtubeId(input.value);
  if (id) location.assign('/w/' + id);
  else {
    error.textContent = 'Enter a YouTube watch, Shorts, or youtu.be link.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
});
input.addEventListener('input', () => {
  error.textContent = '';
  input.removeAttribute('aria-invalid');
});

async function loadGallery() {
  const gallery = document.querySelector('#gallery')!;
  try {
    const response = await fetch('/gallery.json');
    if (!response.ok) throw new Error('Gallery unavailable');
    const worlds = await response.json();
    if (!Array.isArray(worlds)) throw new Error('Invalid gallery');
    gallery.replaceChildren();
    for (const world of worlds) {
      if (!world || !/^[\w-]{11}$/.test(world.youtubeId) ||
          ![world.title, world.credit, world.thumb, world.youtubeId].every(v => typeof v === 'string' && v.trim())) continue;
      const card = document.createElement('a');
      card.href = '/w/' + world.youtubeId;
      const img = new Image();
      img.alt = '';
      img.loading = 'lazy';
      img.src = world.thumb;
      const title = document.createElement('strong');
      title.textContent = world.title;
      const credit = document.createElement('small');
      credit.textContent = world.credit;
      card.append(img, title, credit);
      gallery.append(card);
    }
    if (!gallery.childElementCount) gallery.textContent = 'Our first two worlds are in preparation. They’ll appear here when they’re ready to explore.';
  } catch {
    gallery.textContent = 'The gallery couldn’t load. Refresh the page to try again.';
  }
}
void loadGallery();
