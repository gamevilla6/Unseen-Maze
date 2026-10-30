import path from 'path';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);

export default defineConfig(async ({ command, isPreview }) => {
  const development = command === 'serve' && !isPreview;
  const port = Number(process.env.PORT ?? 5173);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return {
  // Relative production URLs work at both a domain root and /Unseen-Maze/.
  base: development ? (process.env.BASE_PATH ?? '/') : './',
  plugins: [
    react(),
    tailwindcss(),
    ...(development && process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-runtime-error-modal').then((m) => m.default()),
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
      { find: '@assets', replacement: path.resolve(import.meta.dirname, '..', '..', 'attached_assets') },
      // The HTML is at the workspace root; React belongs to this app's package.
      { find: /^react(?=\/|$)/, replacement: path.dirname(require.resolve('react/package.json')) },
      { find: /^react-dom(?=\/|$)/, replacement: path.dirname(require.resolve('react-dom/package.json')) },
    ],
    dedupe: ['react', 'react-dom'],
  },
  // The repository's root index.html is the one canonical Vite entry.
  root: path.resolve(import.meta.dirname, '..', '..'),
  publicDir: path.resolve(import.meta.dirname, 'public'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  };
});
