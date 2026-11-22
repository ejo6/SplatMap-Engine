// SH-12: HUD (PRD FR-26, §12). Title and Gemini scene card top-left, the creator credit always visible top-right,
// a dismissible controls hint on load, and the ghost-path style toggle (air / floor, Sharib's SH-11 follow-up).

import type { PathStyle } from './ghost-path';

export interface Credit {
  creator: string;
  license?: string;
  url?: string;
}

const SCENE_CARD_MS = 12_000; // the scene card introduces the world, then gets out of the way; the title stays
const CONTROLS: [string, string][] = [
  ['Click', 'Look around'],
  ['W A S D', 'Walk'],
  ['Shift', 'Run'],
  ['Space', 'Play / pause'],
  ['← / →', '−5 s / +5 s'],
  ['C', 'Rejoin the camera where it is now'],
  ['R', 'Restart from the beginning'],
  ['F', 'Fog on / off'],
  ['Esc', 'Release the mouse'],
];

const safeUrl = (url?: string) => (url && /^https?:\/\//.test(url) ? url : undefined);

/** Credit line for the corner. Manifests without `credit` still name their source, so the corner is never empty. */
export function creditText(credit: Credit | undefined, youtubeId: string): { text: string; url?: string } {
  if (credit?.creator) {
    return { text: `Video by ${credit.creator}${credit.license ? ` · ${credit.license}` : ''}`, url: safeUrl(credit.url) };
  }
  const isYouTube = /^[\w-]{11}$/.test(youtubeId);
  return { text: isYouTube ? 'Video from YouTube' : 'Source video', url: isYouTube ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createHud(opts: {
  title?: string;
  sceneCard?: string;
  credit?: Credit;
  youtubeId: string;
  onPathStyle: (style: PathStyle) => void;
}): HTMLElement {
  const root = el('div', 'hud');

  // Top-left: title, plus the scene card for its first seconds.
  const intro = el('div', 'hud-intro');
  if (opts.title) intro.append(el('h1', 'hud-title', opts.title));
  if (opts.sceneCard) {
    const card = el('p', 'hud-card', opts.sceneCard);
    intro.append(card);
    setTimeout(() => card.classList.add('hud-faded'), SCENE_CARD_MS);
  }

  // Top-right: credit (always), then the path toggle and the hint button.
  const corner = el('div', 'hud-corner');
  const { text, url } = creditText(opts.credit, opts.youtubeId);
  let credit: HTMLElement = el('span', 'hud-credit', text);
  if (url) {
    const link = el('a', 'hud-credit', text);
    Object.assign(link, { href: url, target: '_blank', rel: 'noopener' });
    credit = link;
  }

  const tools = el('div', 'hud-tools');
  const pathGroup = el('div', 'hud-segmented');
  pathGroup.setAttribute('role', 'group');
  pathGroup.setAttribute('aria-label', 'Camera path (walk mode)');
  pathGroup.append(el('span', 'hud-label', 'Path'));
  const styles: [PathStyle, string][] = [['off', 'Off'], ['air', 'Air'], ['floor', 'Floor']];
  const pathButtons = styles.map(([style, label]) => {
    const b = el('button', 'hud-button', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(style === 'air'));
    b.addEventListener('click', () => {
      for (const other of pathButtons) other.setAttribute('aria-pressed', String(other === b));
      opts.onPathStyle(style);
      b.blur(); // keep Space for play/pause, not for re-clicking the button
    });
    return b;
  });
  pathGroup.append(...pathButtons);
  const hintButton = el('button', 'hud-button hud-help', '?');
  hintButton.type = 'button';
  hintButton.setAttribute('aria-label', 'Show controls');
  tools.append(pathGroup, hintButton);
  corner.append(credit, tools);

  // Centre: controls hint, shown on every load until dismissed (button, or clicking into the world).
  const hint = el('div', 'hud-hint');
  hint.setAttribute('role', 'dialog');
  hint.setAttribute('aria-label', 'Controls');
  const list = el('dl', 'hud-keys');
  for (const [key, action] of CONTROLS) list.append(el('dt', '', key), el('dd', '', action));
  const close = el('button', 'hud-button hud-close', 'Got it');
  close.type = 'button';
  hint.append(el('h2', 'hud-hint-title', 'Controls'), list, close);
  const showHint = (show: boolean) => (hint.hidden = !show);
  close.addEventListener('click', () => showHint(false));
  hintButton.addEventListener('click', () => {
    showHint(Boolean(hint.hidden));
    hintButton.blur();
  });
  document.addEventListener('pointerlockchange', () => document.pointerLockElement && showHint(false));

  root.append(intro, corner, hint);
  return root;
}
