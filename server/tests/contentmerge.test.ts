// A server that already has content picks up new items shipped with a game update (the story chapters) and keeps the
// edits its admin made to the items it had.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startServer } from '../src/main.ts';

describe('content update', () => {
  it('adds new shipped items and keeps edited ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hl-merge-')); mkdirSync(join(dir, 'seed')); mkdirSync(join(dir, 'content'));
    writeFileSync(join(dir, 'content', 'missions.json'), JSON.stringify({ version: 3, items: [{ id: 'old_job', title: 'Edited by admin' }] }));
    writeFileSync(join(dir, 'seed', 'missions.json'), JSON.stringify({ version: 1, items: [{ id: 'old_job', title: 'Shipped title' }, { id: 'story_01', title: 'Last Stop, Oshodi' }] }));
    const s = await startServer({ port: 0, host: '127.0.0.1', dbFile: ':memory:', seedContentDir: join(dir, 'seed'), contentDir: join(dir, 'content'), plotsFile: join(dir, 'none.bin') } as never);
    try {
      const doc = JSON.parse(readFileSync(join(dir, 'content', 'missions.json'), 'utf8'));
      expect(doc.items.map((i: any) => i.id)).toEqual(['old_job', 'story_01']);
      expect(doc.items[0].title).toBe('Edited by admin');
    } finally { await s.close(); }
  });
});
