import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Separate, tiny build for the work-item field editor (resource "field" in the manifest).
// The bridge is loaded module by module (as in vite.config.js), so no AI-assistant code is shipped.
export default defineConfig({
  root: 'field',
  base: './',
  resolve: { alias: [{ find: /^@bridge-part\/(invoke|view)$/, replacement: fileURLToPath(new URL('./node_modules/@forge/bridge/out/$1/index.js', import.meta.url)) }] },
  build: { outDir: '../dist-field', emptyOutDir: true, assetsInlineLimit: 0 },
});
