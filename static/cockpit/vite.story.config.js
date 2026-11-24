import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Separate, tiny build for the Planungs-Check panel on the work item (resource "story" in the manifest).
// No React; the bridge is loaded module by module, so no AI-assistant code is shipped (company policy).
export default defineConfig({
  root: 'story',
  base: './',
  resolve: { alias: [{ find: /^@bridge-part\/(invoke|view|router)$/, replacement: fileURLToPath(new URL('./node_modules/@forge/bridge/out/$1/index.js', import.meta.url)) }] },
  build: { outDir: '../dist-story', emptyOutDir: true, assetsInlineLimit: 0 },
});
