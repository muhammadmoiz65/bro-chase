// Guest-first accounts. A guest account is created on first visit and bound to the
// device by a random device token kept in the browser. The player can later add a
// username + password, which lets them sign in (and bind) on another device.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { encodeLook, parseLook, type Look } from '../shared/look.ts';
import { dirname } from 'node:path';

export interface Account {
  id: string;
  name: string;
  username: string | null;
  hasPassword: boolean;
  createdAt: number;
  look: Look | null; // null until the player opens the character creator
  stats: { nights: number; wins: number; catches: number; mogs: number; revives: number };
}

interface AccountRow {
  id: string;
  name: string;
  username: string | null;
  pass_hash: string | null;
  created_at: number;
  look: string | null;
  nights: number;
  wins: number;
  catches: number;
  mogs: number;
  revives: number;
}

const NAME_PARTS = ['Sigma', 'Rizzler', 'AuraFarmer', 'Mewer', 'NPC', 'Goofy', 'Cooked', 'Delulu', 'Bussin', 'Unc', 'Skrrt', 'Yapper'];

export function randomName(): string {
  const part = NAME_PARTS[Math.floor(Math.random() * NAME_PARTS.length)];
  const n = Math.random() < 0.15 ? 67 : Math.floor(Math.random() * 100);
  return `${part}${n}`;
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, 16);
  return s.length >= 2 ? s : null;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function checkPassword(pw: string, stored: string): boolean {
  const [, saltHex, keyHex] = stored.split('$');
  if (!saltHex || !keyHex) return false;
  const key = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && timingSafeEqual(key, want);
}

export class AccountError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Accounts {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE,
        pass_hash TEXT,
        created_at INTEGER NOT NULL,
        nights INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        catches INTEGER NOT NULL DEFAULT 0,
        mogs INTEGER NOT NULL DEFAULT 0,
        revives INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS devices (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS devices_account ON devices(account_id);
    `);
    const cols = this.db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'look')) this.db.exec('ALTER TABLE accounts ADD COLUMN look TEXT');
  }

  private toAccount(r: AccountRow): Account {
    return {
      id: r.id,
      name: r.name,
      username: r.username,
      hasPassword: !!r.pass_hash,
      createdAt: r.created_at,
      look: r.look ? parseLook(r.look) : null,
      stats: { nights: r.nights, wins: r.wins, catches: r.catches, mogs: r.mogs, revives: r.revives },
    };
  }

  private row(id: string): AccountRow | undefined {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  }

  private bindDevice(accountId: string): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare('INSERT INTO devices (token_hash, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), accountId, now, now);
    return token;
  }

  createGuest(name?: string): { token: string; account: Account } {
    const id = randomUUID();
    this.db.prepare('INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)')
      .run(id, cleanName(name) ?? randomName(), Date.now());
    const token = this.bindDevice(id);
    return { token, account: this.toAccount(this.row(id)!) };
  }

  byToken(token: string | undefined | null): Account | null {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const h = hashToken(token);
    const dev = this.db.prepare('SELECT account_id FROM devices WHERE token_hash = ?').get(h) as
      | { account_id: string }
      | undefined;
    if (!dev) return null;
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').run(Date.now(), h);
    const r = this.row(dev.account_id);
    return r ? this.toAccount(r) : null;
  }

  setName(id: string, raw: unknown): Account {
    const name = cleanName(raw);
    if (!name) throw new AccountError(400, 'Name must be 2 to 16 letters or numbers.');
    this.db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, id);
    return this.toAccount(this.row(id)!);
  }

  setLook(id: string, raw: unknown): Account {
    const look = parseLook(raw);
    if (!look) throw new AccountError(400, 'That look is not valid.');
    this.db.prepare('UPDATE accounts SET look = ? WHERE id = ?').run(encodeLook(look), id);
    return this.toAccount(this.row(id)!);
  }

  /** Add (or change) a username + password so the account can be used on other devices. */
  setCredentials(id: string, rawUser: unknown, rawPass: unknown, currentPass?: unknown): Account {
    const r = this.row(id);
    if (!r) throw new AccountError(404, 'Account not found.');
    if (r.pass_hash) {
      if (typeof currentPass !== 'string' || !checkPassword(currentPass, r.pass_hash)) {
        throw new AccountError(403, 'Current password is wrong.');
      }
    }
    const username = typeof rawUser === 'string' ? rawUser.trim().toLowerCase() : '';
    if (!USERNAME_RE.test(username)) {
      throw new AccountError(400, 'Username must be 3 to 20 characters: a to z, 0 to 9 or _.');
    }
    if (typeof rawPass !== 'string' || rawPass.length < 6 || rawPass.length > 128) {
      throw new AccountError(400, 'Password must be at least 6 characters.');
    }
    const taken = this.db.prepare('SELECT id FROM accounts WHERE username = ? AND id != ?').get(username, id);
    if (taken) throw new AccountError(409, 'That username is taken.');
    this.db.prepare('UPDATE accounts SET username = ?, pass_hash = ? WHERE id = ?')
      .run(username, hashPassword(rawPass), id);
    return this.toAccount(this.row(id)!);
  }

  /** Sign in with username + password; binds this device to the account. */
  login(rawUser: unknown, rawPass: unknown): { token: string; account: Account } {
    const username = typeof rawUser === 'string' ? rawUser.trim().toLowerCase() : '';
    const r = this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as AccountRow | undefined;
    if (!r || !r.pass_hash || typeof rawPass !== 'string' || !checkPassword(rawPass, r.pass_hash)) {
      throw new AccountError(401, 'Wrong username or password.');
    }
    return { token: this.bindDevice(r.id), account: this.toAccount(r) };
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM devices WHERE token_hash = ?').run(hashToken(token));
  }

  devices(id: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE account_id = ?').get(id) as { n: number };
    return r.n;
  }

  addStats(id: string, s: Partial<Account['stats']>): void {
    this.db.prepare(
      `UPDATE accounts SET nights = nights + ?, wins = wins + ?, catches = catches + ?,
       mogs = mogs + ?, revives = revives + ? WHERE id = ?`,
    ).run(s.nights ?? 0, s.wins ?? 0, s.catches ?? 0, s.mogs ?? 0, s.revives ?? 0, id);
  }
}
