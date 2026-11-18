// Accounts + sessions in SQLite (bun:sqlite in Bun, node:sqlite fallback in Node).
// Used as the local fallback store when Supabase is not configured or unavailable at startup.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeMemberId,
  SESSION_MS,
  verifyPasswordHash,
  type DbSessionRow,
  type DbSettingRow,
  type DbUserRow,
  type PublicUser,
  type SessionUser,
  type ThemeMode,
  type UserRole
} from './auth-crypto';
import type { MemberRecord } from './sheets';
import type { AppStore } from './store';

export {
  hashSessionToken,
  normalizeMemberId,
  SESSION_MS,
  type DbSessionRow,
  type DbSettingRow,
  type DbUserRow,
  type PublicUser,
  type SessionUser,
  type ThemeMode,
  type UserRole
};

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);

function openSqliteDatabase(file: string): SqliteDatabase {
  const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);
  const modName = isBun ? 'bun:sqlite' : 'node:sqlite';
  const mod = require(modName) as {
    Database?: new (filename: string) => SqliteDatabase;
    DatabaseSync?: new (filename: string) => SqliteDatabase;
  };
  const Ctor = isBun ? mod.Database : mod.DatabaseSync || mod.Database;
  if (!Ctor) throw new Error(`SQLite driver unavailable in ${modName}`);
  return new Ctor(file);
}

export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openSqliteDatabase(file);
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
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
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
    get: db.prepare('SELECT * FROM users WHERE LOWER(member_id) = LOWER(?)'),
    list: db.prepare(
      'SELECT member_id, full_name, role, pw_hash IS NOT NULL AS has_password, theme, created_at FROM users ORDER BY role, member_id'
    ),
    listAll: db.prepare('SELECT * FROM users ORDER BY created_at ASC, member_id ASC'),
    insert: db.prepare('INSERT INTO users (member_id, full_name, role, created_at) VALUES (?,?,?,?)'),
    insertIgnore: db.prepare('INSERT OR IGNORE INTO users (member_id, full_name, role, created_at) VALUES (?,?,?,?)'),
    upsertUser: db.prepare(
      `INSERT INTO users (member_id, full_name, role, pw_hash, pw_salt, theme, created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(member_id) DO UPDATE SET
         full_name = excluded.full_name,
         role = excluded.role,
         pw_hash = COALESCE(excluded.pw_hash, users.pw_hash),
         pw_salt = COALESCE(excluded.pw_salt, users.pw_salt),
         theme = COALESCE(excluded.theme, users.theme)`
    ),
    promoteAdmin: db.prepare("UPDATE users SET role = 'admin' WHERE LOWER(member_id) = LOWER(?)"),
    firstUser: db.prepare('SELECT member_id FROM users ORDER BY created_at ASC, member_id ASC LIMIT 1'),
    setPw: db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE member_id = ?'),
    setRole: db.prepare('UPDATE users SET role = ? WHERE member_id = ?'),
    setTheme: db.prepare('UPDATE users SET theme = ? WHERE member_id = ?'),
    del: db.prepare('DELETE FROM users WHERE member_id = ?'),
    admins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    sessIns: db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?,?,?)'),
    sessUpsert: db.prepare(
      `INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?,?,?)
       ON CONFLICT(token_hash) DO UPDATE SET member_id = excluded.member_id, expires_at = excluded.expires_at`
    ),
    sessGet: db.prepare(`SELECT u.member_id, u.full_name, u.role, u.theme FROM sessions s
      JOIN users u ON u.member_id = s.member_id WHERE s.token_hash = ? AND s.expires_at > ?`),
    sessList: db.prepare('SELECT token_hash, member_id, expires_at FROM sessions WHERE expires_at > ?'),
    sessDel: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessDelUser: db.prepare('DELETE FROM sessions WHERE member_id = ?'),
    sessReassign: db.prepare('UPDATE sessions SET member_id = ? WHERE member_id = ?'),
    sessPurge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    settingGet: db.prepare('SELECT key, value, updated_at FROM app_settings WHERE key = ?'),
    settingList: db.prepare('SELECT key, value, updated_at FROM app_settings'),
    settingSet: db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ),
    settingDel: db.prepare('DELETE FROM app_settings WHERE key = ?')
  };

  function getLinkedGoogleEmail(memberId: string): string | null {
    const row = q.settingGet.get(`user_google_email:${memberId}`) as DbSettingRow | undefined;
    const val = row?.value?.trim().toLowerCase() || '';
    return val || null;
  }

  return {
    isMemory: file === ':memory:',
    seedFromMembers(members: Array<Pick<MemberRecord, 'member_id' | 'full_name'>>) {
      if (!members.length) return;
      const now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          const existing = q.get.get(m.member_id) as DbUserRow | undefined;
          if (!existing) {
            q.insertIgnore.run(m.member_id, m.full_name, i === 0 ? 'admin' : 'user', now);
          }
        }
        // Always ensure the primary club admin (members[0], e.g. 6600000001) has role = 'admin'
        // even if someone registered it early via Sign up before seeding ran.
        q.promoteAdmin.run(members[0].member_id);
        if ((q.admins.get() as { n: number }).n === 0) {
          const first = q.firstUser.get() as { member_id: string } | undefined;
          if (first) q.promoteAdmin.run(first.member_id);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    getUser(id: string): DbUserRow | null {
      const row = q.get.get(id.trim()) as DbUserRow | undefined;
      return row ? { ...row } : null;
    },
    listUsers(): PublicUser[] {
      const rows = q.list.all() as Array<Omit<PublicUser, 'has_password'> & { has_password: number }>;
      return rows.map((u) => ({ ...u, has_password: Boolean(u.has_password) }));
    },
    listAllUserRows(): DbUserRow[] {
      return (q.listAll.all() as DbUserRow[]).map((r) => ({ ...r }));
    },
    upsertUserFromRemote(u: DbUserRow) {
      q.upsertUser.run(
        normalizeMemberId(u.member_id),
        u.full_name,
        u.role,
        u.pw_hash ?? null,
        u.pw_salt ?? null,
        u.theme ?? null,
        Number(u.created_at) || Date.now()
      );
    },
    createUser(member_id: string, full_name: string, role: UserRole) {
      q.insert.run(normalizeMemberId(member_id), full_name, role, Date.now());
    },
    setRole(id: string, role: UserRole): 'not_found' | 'last_admin' | 'ok' {
      const u = q.get.get(id.trim()) as DbUserRow | undefined;
      if (!u) return 'not_found';
      if (u.role === role) return 'ok';
      if (u.role === 'admin' && role !== 'admin' && (q.admins.get() as { n: number }).n <= 1) {
        return 'last_admin';
      }
      q.setRole.run(role, u.member_id);
      return 'ok';
    },
    deleteUser(id: string): 'not_found' | 'last_admin' | 'ok' {
      const u = q.get.get(id.trim()) as DbUserRow | undefined;
      if (!u) return 'not_found';
      if (u.role === 'admin' && (q.admins.get() as { n: number }).n <= 1) return 'last_admin';
      q.del.run(u.member_id);
      return 'ok';
    },
    async setPassword(id: string, password: string) {
      const u = q.get.get(id.trim()) as DbUserRow | undefined;
      const targetId = u ? u.member_id : id.trim();
      const { hash, salt } = await hashPassword(password);
      q.setPw.run(hash, salt, targetId);
      q.sessDelUser.run(targetId);
    },
    resetPassword(id: string) {
      const u = q.get.get(id.trim()) as DbUserRow | undefined;
      const targetId = u ? u.member_id : id.trim();
      q.setPw.run(null, null, targetId);
      q.sessDelUser.run(targetId);
    },
    setTheme(id: string, theme: ThemeMode) {
      const u = q.get.get(id.trim()) as DbUserRow | undefined;
      q.setTheme.run(theme, u ? u.member_id : id.trim());
    },
    async verifyPassword(id: string, password: string): Promise<SessionUser | null> {
      const u = q.get.get(id.trim()) as DbUserRow | undefined;
      const ok = await verifyPasswordHash(password, u?.pw_hash ?? null, u?.pw_salt ?? null);
      if (!u || !ok) return null;
      return {
        member_id: u.member_id,
        full_name: u.full_name,
        role: u.role,
        theme: u.theme,
        linkedGoogleEmail: getLinkedGoogleEmail(u.member_id)
      };
    },
    createSession(member_id: string): string {
      const token = generateSessionToken();
      q.sessPurge.run(Date.now());
      q.sessIns.run(hashSessionToken(token), member_id, Date.now() + SESSION_MS);
      return token;
    },
    upsertSessionFromRemote(token_hash: string, member_id: string, expires_at: number) {
      q.sessUpsert.run(token_hash, member_id, expires_at);
    },
    getSession(token: string | undefined | null): SessionUser | null {
      if (!token) return null;
      const row = q.sessGet.get(hashSessionToken(token), Date.now()) as
        | Omit<SessionUser, 'linkedGoogleEmail'>
        | undefined;
      if (!row) return null;
      return {
        ...row,
        linkedGoogleEmail: getLinkedGoogleEmail(row.member_id)
      };
    },
    listSessions(): DbSessionRow[] {
      return (q.sessList.all(Date.now()) as DbSessionRow[]).map((s) => ({ ...s }));
    },
    reassignSessions(fromMemberId: string, toMemberId: string) {
      q.sessReassign.run(toMemberId, fromMemberId);
    },
    deleteSession(token: string | undefined | null) {
      if (token) q.sessDel.run(hashSessionToken(token));
    },
    getLinkedGoogleEmail,
    getSetting(key: string): string | null {
      const row = q.settingGet.get(key) as DbSettingRow | undefined;
      return row ? row.value : null;
    },
    getSettingRow(key: string): DbSettingRow | null {
      const row = q.settingGet.get(key) as DbSettingRow | undefined;
      return row ? { ...row } : null;
    },
    setSetting(key: string, value: string, updatedAt = Date.now()) {
      q.settingSet.run(key, value, updatedAt);
    },
    deleteSetting(key: string) {
      q.settingDel.run(key);
    },
    listSettings(): DbSettingRow[] {
      return (q.settingList.all() as DbSettingRow[]).map((s) => ({ ...s }));
    },
    close() {
      db.close();
    },
    SESSION_MS
  };
}

export type AppDb = ReturnType<typeof openDb>;

export function createSqliteStore(rawDb: AppDb): AppStore {
  return {
    backend: 'sqlite',
    isMemory: rawDb.isMemory,
    async seedFromMembers(members) {
      rawDb.seedFromMembers(members);
    },
    async getUser(id) {
      return rawDb.getUser(id);
    },
    async listUsers() {
      return rawDb.listUsers();
    },
    async listAllUserRows() {
      return rawDb.listAllUserRows();
    },
    async upsertUserFromRemote(u) {
      rawDb.upsertUserFromRemote(u);
    },
    async createUser(member_id, full_name, role) {
      rawDb.createUser(member_id, full_name, role);
    },
    async setRole(id, role) {
      return rawDb.setRole(id, role);
    },
    async deleteUser(id) {
      return rawDb.deleteUser(id);
    },
    async setPassword(id, password) {
      await rawDb.setPassword(id, password);
    },
    async resetPassword(id) {
      rawDb.resetPassword(id);
    },
    async setTheme(id, theme) {
      rawDb.setTheme(id, theme);
    },
    async verifyPassword(id, password) {
      return rawDb.verifyPassword(id, password);
    },
    async createSession(member_id) {
      return rawDb.createSession(member_id);
    },
    async getSession(token) {
      return rawDb.getSession(token);
    },
    async deleteSession(token) {
      rawDb.deleteSession(token);
    },
    async reassignSessions(fromMemberId, toMemberId) {
      rawDb.reassignSessions(fromMemberId, toMemberId);
    },
    async getLinkedGoogleEmail(memberId) {
      return rawDb.getLinkedGoogleEmail(memberId);
    },
    async getSetting(key) {
      return rawDb.getSetting(key);
    },
    async getSettingRow(key) {
      return rawDb.getSettingRow(key);
    },
    async setSetting(key, value, updatedAt) {
      rawDb.setSetting(key, value, updatedAt);
    },
    async deleteSetting(key) {
      rawDb.deleteSetting(key);
    },
    async listSettings() {
      return rawDb.listSettings();
    },
    close() {
      rawDb.close();
    }
  };
}
