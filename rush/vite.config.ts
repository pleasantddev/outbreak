import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5174,
    // the room server runs on 8787 in development; the client connects to it directly
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: { output: { manualChunks: { three: ['three', 'postprocessing'] } } },
  },
});
