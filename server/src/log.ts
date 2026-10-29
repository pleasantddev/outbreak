const lvl = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const rank: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const on = (l: string) => rank[l] >= (rank[lvl] ?? 1);
const stamp = () => new Date().toISOString();
export const log = {
  debug: (...a: unknown[]) => on('debug') && console.debug(stamp(), 'DEBUG', ...a),
  info: (...a: unknown[]) => on('info') && console.info(stamp(), 'INFO ', ...a),
  warn: (...a: unknown[]) => on('warn') && console.warn(stamp(), 'WARN ', ...a),
  error: (...a: unknown[]) => on('error') && console.error(stamp(), 'ERROR', ...a),
};
export type Logger = typeof log;
