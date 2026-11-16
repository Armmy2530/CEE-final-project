// Accounts + sessions in SQLite (bun:sqlite). Passwords are scrypt-hashed with a per-user
// salt; session tokens are random and only their SHA-256 is stored.
import { Database } from 'bun:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MemberRecord } from './sheets';

export type UserRole = 'admin' | 'user';
export type ThemeMode = 'light' | 'dark';

export interface DbUserRow {
  member_id: string;
  full_name: string;
  role: UserRole;
  pw_hash: string | null;
  pw_salt: string | null;
  theme: ThemeMode | null;
  created_at: number;
}

export interface SessionUser {
  member_id: string;
  full_name: string;
  role: UserRole;
  theme: ThemeMode | null;
}

export interface PublicUser {
  member_id: string;
  full_name: string;
  role: UserRole;
  has_password: boolean;
  theme: ThemeMode | null;
  created_at: number;
}

export const SESSION_MS = 7 * 24 * 3600 * 1000;
const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k)))
  );
}

export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      member_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','user')),
      pw_hash TEXT,
      pw_salt TEXT,
      theme TEXT CHECK (theme IN ('light','dark')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES users(member_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    PRAGMA foreign_keys = ON;
  `);

  // Safe migration if opening a pre-existing DB without the `theme` column.
  const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'theme')) {
    db.exec("ALTER TABLE users ADD COLUMN theme TEXT CHECK (theme IN ('light','dark'))");
  }

  const q = {
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    get: db.prepare('SELECT * FROM users WHERE member_id = ?'),
    list: db.prepare(
      'SELECT member_id, full_name, role, pw_hash IS NOT NULL AS has_password, theme, created_at FROM users ORDER BY role, member_id'
    ),
    insert: db.prepare('INSERT INTO users (member_id, full_name, role, created_at) VALUES (?,?,?,?)'),
    setPw: db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE member_id = ?'),
    setTheme: db.prepare('UPDATE users SET theme = ? WHERE member_id = ?'),
    del: db.prepare('DELETE FROM users WHERE member_id = ?'),
    admins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    sessIns: db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?,?,?)'),
    sessGet: db.prepare(`SELECT u.member_id, u.full_name, u.role, u.theme FROM sessions s
      JOIN users u ON u.member_id = s.member_id WHERE s.token_hash = ? AND s.expires_at > ?`),
    sessDel: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessDelUser: db.prepare('DELETE FROM sessions WHERE member_id = ?'),
    sessPurge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
  };

  return {
    seedFromMembers(members: Array<Pick<MemberRecord, 'member_id' | 'full_name'>>) {
      const row = q.count.get() as { n: number };
      if (row.n > 0 || !members.length) return;
      const tx = db.transaction((list: Array<Pick<MemberRecord, 'member_id' | 'full_name'>>) => {
        const now = Date.now();
        list.forEach((m, i) => q.insert.run(m.member_id, m.full_name, i === 0 ? 'admin' : 'user', now));
      });
      tx(members);
    },
    getUser(id: string): DbUserRow | null {
      return (q.get.get(id) as DbUserRow | undefined) || null;
    },
    listUsers(): PublicUser[] {
      const rows = q.list.all() as Array<Omit<PublicUser, 'has_password'> & { has_password: number }>;
      return rows.map((u) => ({ ...u, has_password: Boolean(u.has_password) }));
    },
    createUser(member_id: string, full_name: string, role: UserRole) {
      q.insert.run(member_id, full_name, role, Date.now());
    },
    deleteUser(id: string): 'not_found' | 'last_admin' | 'ok' {
      const u = q.get.get(id) as DbUserRow | undefined;
      if (!u) return 'not_found';
      if (u.role === 'admin' && (q.admins.get() as { n: number }).n <= 1) return 'last_admin';
      q.del.run(id);
      return 'ok';
    },
    async setPassword(id: string, password: string) {
      const salt = crypto.randomBytes(16).toString('hex');
      q.setPw.run((await scrypt(password, salt)).toString('hex'), salt, id);
      q.sessDelUser.run(id);
    },
    resetPassword(id: string) {
      q.setPw.run(null, null, id);
      q.sessDelUser.run(id);
    },
    setTheme(id: string, theme: ThemeMode) {
      q.setTheme.run(theme, id);
    },
    async verifyPassword(id: string, password: string): Promise<SessionUser | null> {
      const u = q.get.get(id) as DbUserRow | undefined;
      // Always spend the same work, even for unknown users, to avoid timing leaks.
      const salt = u?.pw_salt || 'x'.repeat(32);
      const hash = await scrypt(password, salt);
      if (!u || !u.pw_hash) return null;
      const ok = crypto.timingSafeEqual(hash, Buffer.from(u.pw_hash, 'hex'));
      return ok ? { member_id: u.member_id, full_name: u.full_name, role: u.role, theme: u.theme } : null;
    },
    createSession(member_id: string): string {
      const token = crypto.randomBytes(32).toString('hex');
      q.sessPurge.run(Date.now());
      q.sessIns.run(sha(token), member_id, Date.now() + SESSION_MS);
      return token;
    },
    getSession(token: string | undefined | null): SessionUser | null {
      return token ? ((q.sessGet.get(sha(token), Date.now()) as SessionUser | undefined) || null) : null;
    },
    deleteSession(token: string | undefined | null) {
      if (token) q.sessDel.run(sha(token));
    },
    close() {
      db.close();
    },
    SESSION_MS
  };
}

export type AppDb = ReturnType<typeof openDb>;
