import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 6000, assetsInlineLimit: 0,
    rollupOptions: { input: 'index.html', output: { manualChunks: { rapier: ['@dimforge/rapier3d-compat'], three: ['three', 'postprocessing'] } } },
  },
});
