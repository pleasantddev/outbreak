import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WORLD = resolve(here, '../v2/public/world');
// In dev the game's world packs are served straight from the game folder. In a production build they are NOT copied
// (67 MB): point worldUrl in config.json at the game's /world/ folder.
const worldDev = (): Plugin => ({
  name: 'hl-world-dev', apply: 'serve',
  configureServer(s) {
    s.middlewares.use('/world', (req, res, next) => {
      const f = join(WORLD, decodeURIComponent((req.url ?? '/').split('?')[0]));
      if (!f.startsWith(WORLD) || !existsSync(f) || !statSync(f).isFile()) return next();
      res.setHeader('content-type', extname(f) === '.json' ? 'application/json' : 'application/octet-stream'); createReadStream(f).pipe(res);
    });
  },
});
export default defineConfig({
  base: './',
  plugins: [preact(), worldDev()],
  resolve: { alias: { '@world': resolve(here, '../v2/src/world'), '@srv': resolve(here, '../server/admin') } },
  server: { host: true, port: 5225, strictPort: true, fs: { allow: [resolve(here, '..')] }, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, assetsInlineLimit: 0, outDir: 'dist', rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
