import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { SqlDb } from './db';
import type { ContentVersion, Issue } from './types';
import { CONTENT_KINDS, hasErrors, validateContent, type ContentDoc } from './validate';

export const KIND_RE = /^[a-z][a-z0-9_-]{1,40}$/;
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** File-backed content (server/data/content/<kind>.json) with a version history in SQLite. The game reads the same files through GET /api/content/:kind. */
export class ContentStore {
  constructor(private db: SqlDb, public dir: string, private seedDirs: string[]) { mkdirSync(dir, { recursive: true }); }
  private file(kind: string) { return join(this.dir, kind + '.json'); }
  kinds(): string[] {
    const s = new Set<string>(CONTENT_KINDS);
    for (const d of [this.dir, ...this.seedDirs]) if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.json') && KIND_RE.test(f.slice(0, -5))) s.add(f.slice(0, -5));
    return [...s];
  }
  private seedFor(kind: string): string | null { for (const d of this.seedDirs) { const f = join(d, kind + '.json'); if (existsSync(f)) return readFileSync(f, 'utf8'); } return null; }
  /** Returns the live document plus its history number. Seeds from the repo content on first use. */
  read(kind: string, actor = 'system'): { doc: ContentDoc; version: number; hash: string } {
    if (!KIND_RE.test(kind)) throw new Error('bad kind');
    let text: string | null = existsSync(this.file(kind)) ? readFileSync(this.file(kind), 'utf8') : null;
    if (text === null) { text = this.seedFor(kind) ?? JSON.stringify({ version: 1, items: [] }, null, 2); writeFileSync(this.file(kind), text); }
    const doc = JSON.parse(text) as ContentDoc;
    let cur = this.db.prepare('SELECT MAX(version) v FROM content_versions WHERE kind=?').get(kind)?.v as number | null;
    if (!cur) { this.record(kind, 1, actor, 'Initial import', doc, text); cur = 1; }
    return { doc, version: cur, hash: sha(text) };
  }
  private record(kind: string, version: number, by: string, note: string, doc: ContentDoc, text: string) {
    this.db.prepare('INSERT INTO content_versions(kind,version,saved_at,by,note,items,hash,body) VALUES(?,?,?,?,?,?,?,?)').run(kind, version, Date.now(), by, note, doc.items?.length ?? 0, sha(text), text);
  }
  validate(kind: string, doc: unknown): Issue[] { return validateContent(kind, doc); }
  save(kind: string, doc: ContentDoc, by: string, note: string, baseVersion?: number): { ok: true; version: number; changed: boolean; issues: Issue[] } | { ok: false; status: number; error: string; issues?: Issue[]; current?: number } {
    const cur = this.read(kind, by);
    if (baseVersion !== undefined && baseVersion !== cur.version) return { ok: false, status: 409, error: `Someone saved version ${cur.version} while you were editing version ${baseVersion}. Reload to merge.`, current: cur.version };
    const issues = this.validate(kind, doc);
    if (hasErrors(issues)) return { ok: false, status: 422, error: 'Validation failed', issues };
    const text = JSON.stringify(doc, null, 2) + '\n';
    if (sha(text) === cur.hash || sha(JSON.stringify(cur.doc, null, 2) + '\n') === sha(text)) return { ok: true, version: cur.version, changed: false, issues };
    const v = cur.version + 1; const tmp = this.file(kind) + '.tmp';
    writeFileSync(tmp, text); renameSync(tmp, this.file(kind));
    this.record(kind, v, by, note, doc, text);
    return { ok: true, version: v, changed: true, issues };
  }
  versions(kind: string): ContentVersion[] { this.read(kind); return this.db.prepare('SELECT kind,version,saved_at,by,note,items,hash FROM content_versions WHERE kind=? ORDER BY version DESC LIMIT 200').all(kind).map((r: any) => ({ kind: r.kind, version: r.version, savedAt: r.saved_at, by: r.by, note: r.note, items: r.items, hash: r.hash })); }
  versionBody(kind: string, version: number): ContentDoc | null { const r = this.db.prepare('SELECT body FROM content_versions WHERE kind=? AND version=?').get(kind, version); return r ? JSON.parse(r.body) : null; }
  rollback(kind: string, version: number, by: string) {
    const old = this.versionBody(kind, version); if (!old) return { ok: false as const, status: 404, error: 'No such version' };
    return this.save(kind, old, by, `Rollback to v${version}`);
  }
}
