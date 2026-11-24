import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  // '@bridge-part/<name>': one module of Atlassian's browser bridge, by file – the package only exports its full index,
  // which would also ship the AI-assistant opener the company does not allow (see src/lib/bridge.js).
  resolve: { alias: [
    { find: '@shared', replacement: fileURLToPath(new URL('../../shared', import.meta.url)) },
    { find: /^@bridge-part\/(invoke|fetch|router|view)$/, replacement: fileURLToPath(new URL('./node_modules/@forge/bridge/out/$1/index.js', import.meta.url)) },
  ] },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
  server: { fs: { allow: ['../..'] } },
});
