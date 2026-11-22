import { defineConfig, type Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

const WORLDS = path.resolve(import.meta.dirname, '../worlds');

/** KAN-93: /worlds-index.json lists the world folders on this machine (worlds/ is git-ignored, so every clone differs).
 * Read on every request in dev, so a copied-in world shows up on refresh; written once into the build. */
export function worldsIndex(dir = WORLDS) {
  const found = fs.readdirSync(dir).sort().flatMap((id) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'v1', 'manifest.json'), 'utf8'));
      return id === 'test' ? [] : [{ id, youtubeId: m.youtubeId ?? id, title: m.title, credit: m.credit, video: m.video?.url ?? 'video.mp4' }];
    } catch {
      return []; // not a packaged world (no v1/manifest.json)
    }
  });
  // One card per video: an alternate build (e.g. 2PBXchYQdao-atlas) is dropped when the folder named for its id exists.
  return found.filter((w) => w.id === w.youtubeId || !found.some((o) => o.id === w.youtubeId));
}

const worldsIndexPlugin = (): Plugin => ({
  name: 'worlds-index',
  configureServer(server) {
    server.middlewares.use('/worlds-index.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(worldsIndex()));
    });
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'worlds-index.json', source: JSON.stringify(worldsIndex()) });
  },
});

// The repo keeps one .env at its root (see .env.example); point Vite there
// instead of duplicating env files per package.
export default defineConfig({
  envDir: path.resolve(import.meta.dirname, '..'),
  plugins: [worldsIndexPlugin()],
});
