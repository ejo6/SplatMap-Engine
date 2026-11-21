import { defineConfig } from 'vite';
import path from 'path';

// The repo keeps one .env at its root (see .env.example); point Vite there
// instead of duplicating env files per package.
export default defineConfig({
  envDir: path.resolve(import.meta.dirname, '..'),
});
