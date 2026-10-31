// Runtime configuration from environment variables. Everything has a safe development default.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** server/ directory, whether running from src (tsx) or dist/server/src (compiled) */
export const SERVER_DIR = resolve(here, existsSync(resolve(here, '../routes')) ? '..' : '../../../../server');
export const REPO_DIR = resolve(SERVER_DIR, '..');

const env = process.env;
const num = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && env[k] !== undefined && env[k] !== '' ? v : d; };
const bool = (k: string, d: boolean) => (env[k] === undefined ? d : /^(1|true|yes|on)$/i.test(env[k]!));

export interface Config {
  port: number; host: string;
  dataDir: string; dbFile: string; contentDir: string; seedContentDir: string; plotsFile: string;
  jwtSecret: string; tokenDays: number;
  tickHz: number; maxPlayers: number; interestRings: number; nearChatRadius: number;
  startCash: number; adminEmail: string; adminPassword: string;
  allowOrigins: string; staticDir: string; adminDir: string;
  guestAccounts: boolean; trustClientPlotPrice: boolean; /** shortest match the server settles (ms); unset = 90% of the sport's length */ matchMinMs?: number;
  mapBounds: [number, number, number, number];
  motd: string; trustProxy: boolean;
  /** enforce: correct and kick; log: only record; off: no checks (load tests) */
  antiCheat: 'enforce' | 'log' | 'off';
  /** multiplies every rate limit (tests and load tests raise it; leave at 1 in production) */
  rateScale: number;
  /** Paystack keys (env PAYSTACK_SECRET_KEY / PAYSTACK_PUBLIC_KEY). No secret key: payments run in test mode or are off. */
  paystackSecret: string; paystackPublic: string;
  /** test mode fakes the card step (dev and staging only). Default: on when there is no secret key and NODE_ENV is not production */
  payTest: boolean;
  /** where Paystack sends the player back after paying (the game URL); it adds ?reference=... */
  payCallbackUrl: string;
}

function secret(dataDir: string): string {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 16) return env.JWT_SECRET;
  const f = resolve(dataDir, 'secret.key');
  try { if (existsSync(f)) return readFileSync(f, 'utf8').trim(); } catch { /* regenerate */ }
  const s = randomBytes(32).toString('hex');
  try { writeFileSync(f, s, { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* windows */ } } catch { /* read only fs: tokens die with the process */ }
  return s;
}

export function loadConfig(over: Partial<Config> = {}): Config {
  const dataDir = resolve(env.DATA_DIR ?? resolve(SERVER_DIR, 'data'));
  mkdirSync(dataDir, { recursive: true });
  const c: Config = {
    port: num('PORT', 8787), host: env.HOST ?? '0.0.0.0',
    dataDir, dbFile: env.DB_FILE ?? resolve(dataDir, 'hustlelife.db'),
    contentDir: env.CONTENT_DIR ?? resolve(dataDir, 'content'),
    seedContentDir: env.SEED_CONTENT_DIR ?? resolve(REPO_DIR, 'v2/public/content'),
    plotsFile: env.PLOTS_FILE ?? resolve(dataDir, 'plots.bin'),
    jwtSecret: '', tokenDays: num('TOKEN_DAYS', 30),
    tickHz: Math.max(5, Math.min(30, num('TICK_HZ', 15))), maxPlayers: num('MAX_PLAYERS', 500), interestRings: num('INTEREST_RINGS', 3), nearChatRadius: num('NEAR_CHAT_RADIUS', 60),
    startCash: num('START_CASH', 1850), adminEmail: (env.ADMIN_EMAIL ?? '').toLowerCase(), adminPassword: env.ADMIN_PASSWORD ?? '',
    allowOrigins: env.ALLOW_ORIGINS ?? '*', staticDir: env.STATIC_DIR ?? '', adminDir: env.ADMIN_DIR ?? '',
    guestAccounts: bool('GUEST_ACCOUNTS', true), trustClientPlotPrice: bool('TRUST_CLIENT_PLOT_PRICE', true),
    mapBounds: [-22000, -20500, 12000, 12500], motd: env.MOTD ?? 'Welcome to Lagos. Shine your eye.', trustProxy: bool('TRUST_PROXY', false),
    antiCheat: (env.ANTI_CHEAT as Config['antiCheat']) ?? 'enforce', rateScale: num('RATE_SCALE', 1),
    paystackSecret: env.PAYSTACK_SECRET_KEY ?? '', paystackPublic: env.PAYSTACK_PUBLIC_KEY ?? '',
    payTest: bool('PAY_TEST', !env.PAYSTACK_SECRET_KEY && env.NODE_ENV !== 'production'), payCallbackUrl: env.PAY_CALLBACK_URL ?? '',
    ...over,
  };
  c.jwtSecret = over.jwtSecret ?? secret(dataDir);
  return c;
}
