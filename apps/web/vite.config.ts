import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

export default defineConfig(({ mode }) => {
  // The whole monorepo shares one .env at the repository root.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const port = Number(env.WEB_PORT ?? 5173);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid WEB_PORT "${env.WEB_PORT}"`);
  const apiTarget = env.API_PROXY_TARGET ?? 'http://localhost:8080';
  const proxy = { '/api': { target: apiTarget } };

  return {
    base: env.BASE_PATH ?? '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 900,
    },
    server: { port, strictPort: true, host: true, proxy },
    preview: { port, host: true, proxy },
  };
});
