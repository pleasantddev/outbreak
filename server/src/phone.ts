// The phone network: every account gets an in-game number (0809 ... style) and a public player ID (HL-XXXXXX) to share.
// Contacts, text messages (stored, delivered when you come online), and the call book-keeping that voice.ts on the
// client turns into a real voice call. Nothing here touches money.
import { randomInt } from 'node:crypto';
import type { DB } from './db.ts';
import { all, one, run } from './db.ts';
import { HttpError } from './auth.ts';
import { cleanChat } from '../../v2/src/net/rules.ts';

export interface PhoneRow { account_id: string; number: string; public_id: string }
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export class PhoneNet {
  constructor(private db: DB) {}
  /** the account's number and public id, made on first use */
  ensure(accountId: string): PhoneRow {
    const r = one<PhoneRow>(this.db, 'SELECT account_id, number, public_id FROM phones WHERE account_id=?', accountId); if (r) return r;
    for (let k = 0; k < 40; k++) {
      const number = `0${[803, 806, 809, 813, 816, 703, 706, 810, 814, 903][randomInt(10)]}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
      const pid = 'HL-' + Array.from({ length: 6 }, () => B32[randomInt(B32.length)]).join('');
      try { run(this.db, 'INSERT INTO phones(account_id, number, public_id, created_at) VALUES(?,?,?,?)', accountId, number, pid, Date.now()); return { account_id: accountId, number, public_id: pid }; } catch { /* clash, try again */ }
    }
    throw new HttpError(500, 'Could not give you a number.');
  }
  /** find a player by phone number, public id, or exact name */
  lookup(q: unknown): { id: string; name: string; number: string; publicId: string } | null {
    const t = String(q ?? '').trim(); if (!t || t.length > 40) return null;
    const digits = t.replace(/[^0-9]/g, ''); const pid = t.toUpperCase().replace(/^HL-?/, 'HL-');
    const r = one<{ account_id: string; number: string; public_id: string; name: string | null }>(this.db,
      'SELECT p.account_id, p.number, p.public_id, f.name FROM phones p LEFT JOIN profiles f ON f.account_id=p.account_id WHERE p.number=? OR p.public_id=? OR lower(f.name)=lower(?) LIMIT 1', digits, pid, t);
    return r ? { id: r.account_id, name: r.name ?? 'Player', number: r.number, publicId: r.public_id } : null;
  }
  addContact(owner: string, q: unknown, name?: unknown) {
    const p = this.lookup(q); if (!p) throw new HttpError(404, 'No player with that number or ID.'); if (p.id === owner) throw new HttpError(400, 'That na your own number.');
    const n = cleanChat(name ?? p.name, 24) ?? p.name;
    run(this.db, 'INSERT INTO contacts(owner_id, contact_id, name, added_at) VALUES(?,?,?,?) ON CONFLICT(owner_id, contact_id) DO UPDATE SET name=excluded.name', owner, p.id, n, Date.now());
    return { ...p, saved: n };
  }
  removeContact(owner: string, id: unknown) { run(this.db, 'DELETE FROM contacts WHERE owner_id=? AND contact_id=?', owner, String(id ?? '')); }
  contacts(owner: string) {
    return all<{ id: string; name: string; number: string; publicId: string; player: string | null }>(this.db,
      'SELECT c.contact_id AS id, c.name, p.number, p.public_id AS publicId, f.name AS player FROM contacts c JOIN phones p ON p.account_id=c.contact_id LEFT JOIN profiles f ON f.account_id=c.contact_id WHERE c.owner_id=? ORDER BY c.name COLLATE NOCASE', owner);
  }
  send(from: string, to: unknown, body: unknown) {
    const t = String(to ?? ''); const text = cleanChat(body, 500); if (!text) throw new HttpError(400, 'Say something.');
    if (t === from) throw new HttpError(400, 'You cannot text yourself.');
    if (!one(this.db, 'SELECT 1 FROM phones WHERE account_id=?', t)) throw new HttpError(404, 'That number is not on the network.');
    const recent = one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM messages WHERE from_id=? AND at>?', from, Date.now() - 10_000)!.n;
    if (recent >= 6) throw new HttpError(429, 'Slow down small.');
    const at = Date.now(); const r = run(this.db, 'INSERT INTO messages(from_id, to_id, body, at) VALUES(?,?,?,?)', from, t, text, at);
    return { id: Number(r.lastInsertRowid), from, to: t, body: text, at };
  }
  /** one row per person you have texted with: the last message and how many you have not read */
  threads(owner: string) {
    return all<{ other: string; body: string; at: number; mine: number; unread: number; name: string | null; saved: string | null; number: string }>(this.db, `
      WITH t AS (SELECT CASE WHEN from_id=@me THEN to_id ELSE from_id END AS other, body, at, from_id=@me AS mine FROM messages WHERE from_id=@me OR to_id=@me),
      last AS (SELECT other, MAX(at) AS at FROM t GROUP BY other)
      SELECT t.other, t.body, t.at, t.mine, (SELECT COUNT(*) FROM messages m WHERE m.from_id=t.other AND m.to_id=@me AND m.read=0) AS unread,
        f.name, c.name AS saved, p.number
      FROM t JOIN last ON last.other=t.other AND last.at=t.at LEFT JOIN profiles f ON f.account_id=t.other LEFT JOIN contacts c ON c.owner_id=@me AND c.contact_id=t.other
      LEFT JOIN phones p ON p.account_id=t.other GROUP BY t.other ORDER BY t.at DESC LIMIT 50`, { me: owner });
  }
  thread(owner: string, other: unknown) {
    const o = String(other ?? '');
    run(this.db, 'UPDATE messages SET read=1 WHERE from_id=? AND to_id=? AND read=0', o, owner);
    return all<{ id: number; from_id: string; body: string; at: number }>(this.db, 'SELECT id, from_id, body, at FROM messages WHERE (from_id=@a AND to_id=@b) OR (from_id=@b AND to_id=@a) ORDER BY id DESC LIMIT 60', { a: owner, b: o }).reverse();
  }
  unread(owner: string) { return one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM messages WHERE to_id=? AND read=0', owner)!.n; }
}
