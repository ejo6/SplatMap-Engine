import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './landing.css';
import { mountCarousel } from './carousel';

// KAN-88: new videos aren't processed for the demo. A link we haven't built lands here, in the fog, with the worlds we have.

document.title = 'GPU cluster unavailable · Step Into the Video';
const app = document.querySelector('#app')!;
app.innerHTML = `
<header class="top">
  <a class="brand" href="/">Step Into the Video</a>
</header>
<main class="unavailable">
  <section class="offline" aria-labelledby="offline-title">
    <h1 id="offline-title">The GPU cluster is unavailable.</h1>
    <p class="lede">We can’t turn a new video into a world right now. These ones are already built, and you can walk into any of them.</p>
  </section>
  <section class="band worlds" aria-label="Worlds you can walk into">
    <div id="gallery" class="carousel"><p class="empty">Loading worlds…</p></div>
    <p class="back"><a href="/">Back to the lake</a></p>
  </section>
</main>`;

void mountCarousel(document.querySelector<HTMLElement>('#gallery')!);
