// Game content documents: { version, items: [{ id, ... }] } stored as files in the data directory, seeded from
// v2/public/content on first boot, edited through PUT /api/content/:kind (admin), read by everyone.
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { HttpError } from './auth.ts';

/** Every content file the game knows about (see docs/ARCHITECTURE.md). New kinds are added here by their owner. */
export const CONTENT_KINDS = ['missions', 'events', 'skills', 'routes', 'npcs', 'economy', 'iap', 'shops'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export interface ContentDoc { version: number; items: Array<{ id: string; [k: string]: unknown }>; [k: string]: unknown }

const MAX_BYTES = 8 * 1024 * 1024;
const HISTORY_KEEP = 30;

export class ContentStore extends EventEmitter {
  private cache = new Map<string, { doc: ContentDoc; etag: string; raw: string; mtime: number }>();
  extraKinds = new Set<string>();
  constructor(private cfg: Config, private log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }) {
    super();
    mkdirSync(cfg.contentDir, { recursive: true });
    this.seed();
  }

  kinds(): string[] { return [...CONTENT_KINDS, ...this.extraKinds]; }
  isKind(k: string): boolean { return (CONTENT_KINDS as readonly string[]).includes(k) || this.extraKinds.has(k); }
  /** let another workstream register a new content file without editing this module */
  registerKind(k: string) { if (/^[a-z][a-z0-9_-]{1,30}$/.test(k)) this.extraKinds.add(k); }
  private file(kind: string) { return join(this.cfg.contentDir, `${kind}.json`); }

  /** Copy shipped defaults into the data directory for any file that does not exist yet. */
  seed() {
    let n = 0;
    for (const kind of CONTENT_KINDS) {
      const dst = this.file(kind); if (existsSync(dst)) continue;
      const src = join(this.cfg.seedContentDir, `${kind}.json`);
      if (existsSync(src)) { try { copyFileSync(src, dst); n++; } catch (e) { this.log.warn(`could not seed ${kind}: ${e}`); } }
    }
    if (n) this.log.info(`content seeded: ${n} file(s) from ${this.cfg.seedContentDir}`);
  }
  /** Pull in new shipped files / reset one kind to the shipped version (admin "revert to default"). */
  resetToSeed(kind: string, by = 'admin'): ContentDoc {
    const src = join(this.cfg.seedContentDir, `${kind}.json`);
    const doc: ContentDoc = existsSync(src) ? JSON.parse(readFileSync(src, 'utf8')) : { version: 1, items: [] };
    return this.write(kind, doc, { by });
  }

  has(kind: string) { return existsSync(this.file(kind)); }
  /** The document, or an empty one when the file has not been created. Cached by modification time. */
  read(kind: string): ContentDoc | null {
    if (!this.isKind(kind)) return null;
    return this.load(kind).doc;
  }
  private load(kind: string) {
    const f = this.file(kind);
    if (!existsSync(f)) { const doc: ContentDoc = { version: 1, items: [] }; const raw = JSON.stringify(doc); return { doc, raw, etag: etagOf(raw), mtime: 0 }; }
    const m = statSync(f).mtimeMs; const c = this.cache.get(kind);
    if (c && c.mtime === m) return c;
    const raw = readFileSync(f, 'utf8');
    let doc: ContentDoc; try { doc = JSON.parse(raw); } catch { throw new HttpError(500, `content/${kind}.json is not valid JSON`); }
    const e = { doc, raw, etag: etagOf(raw), mtime: m }; this.cache.set(kind, e); return e;
  }
  etag(kind: string) { return this.load(kind).etag; }
  rawText(kind: string) { return this.load(kind).raw; }
  summary() { return this.kinds().map((k) => { const l = this.load(k); return { kind: k, items: l.doc.items?.length ?? 0, etag: l.etag, version: l.doc.version, updated: l.mtime || null }; }); }

  static validate(kind: string, doc: unknown): ContentDoc {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new HttpError(400, 'Content must be an object { version, items }.');
    const d = doc as ContentDoc;
    if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) throw new HttpError(400, '"version" must be a positive integer.');
    if (!Array.isArray(d.items)) throw new HttpError(400, '"items" must be an array.');
    const seen = new Set<string>();
    d.items.forEach((it, i) => {
      if (!it || typeof it !== 'object' || Array.isArray(it)) throw new HttpError(400, `items[${i}] must be an object.`);
      const id = (it as { id?: unknown }).id;
      if (typeof id !== 'string' || !id || id.length > 80) throw new HttpError(400, `items[${i}] needs a string "id" (max 80 chars).`);
      if (seen.has(id)) throw new HttpError(400, `Duplicate id "${id}" at items[${i}].`);
      seen.add(id);
    });
    void kind; return d;
  }

  /** Atomic write (temp file + rename) with a rolling backup of what it replaced. `ifMatch` gives optimistic locking. */
  write(kind: string, doc: unknown, o: { ifMatch?: string; by?: string } = {}): ContentDoc {
    if (!this.isKind(kind)) throw new HttpError(404, `Unknown content kind "${kind}".`);
    const d = ContentStore.validate(kind, doc);
    const raw = JSON.stringify(d, null, 2) + '\n';
    if (raw.length > MAX_BYTES) throw new HttpError(413, 'Content file is too large.');
    const cur = this.load(kind);
    if (o.ifMatch && o.ifMatch.replace(/"/g, '') !== cur.etag) throw new HttpError(412, 'Someone else changed this file. Reload and merge.', { etag: cur.etag });
    const f = this.file(kind);
    if (existsSync(f)) this.backup(kind, f);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, raw); renameSync(tmp, f);
    this.cache.delete(kind);
    const now = this.load(kind);
    this.emit('changed', { kind, etag: now.etag, by: o.by ?? null });
    return now.doc;
  }
  private histDir(kind: string) { return join(this.cfg.contentDir, '.history', kind); }
  private backup(kind: string, f: string) {
    const dir = this.histDir(kind); mkdirSync(dir, { recursive: true });
    copyFileSync(f, join(dir, `${Date.now()}.json`));
    const files = readdirSync(dir).filter((x) => x.endsWith('.json')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) { try { unlinkSync(join(dir, old)); } catch { /* ignore */ } }
  }
  history(kind: string): { rev: string; at: number; bytes: number }[] {
    const dir = this.histDir(kind); if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((x) => x.endsWith('.json')).sort().reverse().map((x) => ({ rev: x.slice(0, -5), at: Number(x.slice(0, -5)), bytes: statSync(join(dir, x)).size }));
  }
  restore(kind: string, rev: string, by?: string) {
    if (!/^\d+$/.test(rev)) throw new HttpError(400, 'Bad revision.');
    const f = join(this.histDir(kind), `${rev}.json`); if (!existsSync(f)) throw new HttpError(404, 'No such revision.');
    return this.write(kind, JSON.parse(readFileSync(f, 'utf8')), { by });
  }
}

export const etagOf = (raw: string) => createHash('sha1').update(raw).digest('hex').slice(0, 16);
