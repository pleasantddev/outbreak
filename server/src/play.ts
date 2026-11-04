// Entry of the single-file server in the play build (tools/release-play.mjs bundles this into server/server.mjs).
// Same server as src/main.ts; the route plug-ins are imported here because a bundle cannot list a folder of .ts files.
import { log } from './log.ts';
import { startServer } from './main.ts';
import * as admin from '../routes/admin.ts';
import * as ads from '../routes/ads.ts';
import * as auth from '../routes/auth.ts';
import * as content from '../routes/content.ts';
import * as health from '../routes/health.ts';
import * as pay from '../routes/pay.ts';
import * as profile from '../routes/profile.ts';
import * as songs from '../routes/songs.ts';
import * as state from '../routes/state.ts';
import * as world from '../routes/world.ts';

startServer({}, { admin, ads, auth, content, health, pay, profile, songs, state, world } as never).then((s) => {
  const stop = async () => { log.info('shutting down'); await s.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch((e) => { log.error('failed to start', e); process.exit(1); });
