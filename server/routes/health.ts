// Liveness and live numbers. /api/health is public (used by load balancers and the client's connect check).
import type { Api } from '../src/api.ts';

const started = Date.now();
export function register(api: Api) {
  api.get('/api/health', () => ({ ok: true, name: 'hustlelife', version: 1, protocol: 1, uptime: Math.round((Date.now() - started) / 1000), online: api.online.count(), guests: api.cfg.guestAccounts, motd: api.cfg.motd }));
  api.get('/api/stats', () => ({ ...api.online.stats(), mem: process.memoryUsage().rss, cpu: process.cpuUsage() }), { auth: 'mod' });
  api.get('/api/rooms', () => ({ rooms: api.online.rooms() }), { auth: 'mod' });
  api.get('/api/online', () => ({ players: api.online.list() }), { auth: 'mod' });
}
