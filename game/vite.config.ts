import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { manualChunks: { rapier: ['@dimforge/rapier3d-compat'], three: ['three', 'postprocessing'] } } },
  },
});
