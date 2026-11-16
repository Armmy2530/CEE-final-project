'use strict';
// Accounts + sessions in SQLite (node:sqlite). Passwords are scrypt-hashed with a per-user
// salt; session tokens are random and only their SHA-256 is stored.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_MS = 7 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))));
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      member_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','user')),
      pw_hash TEXT, pw_salt TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES users(member_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );`);
  db.exec('PRAGMA foreign_keys = ON');

  const q = {
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    get: db.prepare('SELECT * FROM users WHERE member_id = ?'),
    list: db.prepare('SELECT member_id, full_name, role, pw_hash IS NOT NULL AS has_password, created_at FROM users ORDER BY role, member_id'),
    insert: db.prepare('INSERT INTO users (member_id, full_name, role, created_at) VALUES (?,?,?,?)'),
    setPw: db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE member_id = ?'),
    del: db.prepare('DELETE FROM users WHERE member_id = ?'),
    admins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    sessIns: db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?,?,?)'),
    sessGet: db.prepare(`SELECT u.member_id, u.full_name, u.role FROM sessions s
      JOIN users u ON u.member_id = s.member_id WHERE s.token_hash = ? AND s.expires_at > ?`),
    sessDel: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    sessDelUser: db.prepare('DELETE FROM sessions WHERE member_id = ?'),
    sessPurge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  return {
    seedFromMembers(members) {
      if (q.count.get().n > 0 || !members.length) return;
      members.forEach((m, i) => q.insert.run(m.member_id, m.full_name, i === 0 ? 'admin' : 'user', Date.now()));
    },
    getUser: (id) => q.get.get(id) || null,
    listUsers: () => q.list.all().map((u) => ({ ...u, has_password: !!u.has_password })),
    createUser(member_id, full_name, role) {
      q.insert.run(member_id, full_name, role, Date.now());
    },
    deleteUser(id) {
      const u = q.get.get(id);
      if (!u) return 'not_found';
      if (u.role === 'admin' && q.admins.get().n <= 1) return 'last_admin';
      q.del.run(id);
      return 'ok';
    },
    async setPassword(id, password) {
      const salt = crypto.randomBytes(16).toString('hex');
      q.setPw.run((await scrypt(password, salt)).toString('hex'), salt, id);
      q.sessDelUser.run(id);
    },
    resetPassword(id) {
      q.setPw.run(null, null, id);
      q.sessDelUser.run(id);
    },
    async verifyPassword(id, password) {
      const u = q.get.get(id);
      // Always spend the same work, even for unknown users, to avoid timing leaks.
      const salt = u?.pw_salt || 'x'.repeat(32);
      const hash = await scrypt(password, salt);
      if (!u || !u.pw_hash) return null;
      const ok = crypto.timingSafeEqual(hash, Buffer.from(u.pw_hash, 'hex'));
      return ok ? { member_id: u.member_id, full_name: u.full_name, role: u.role } : null;
    },
    createSession(member_id) {
      const token = crypto.randomBytes(32).toString('hex');
      q.sessPurge.run(Date.now());
      q.sessIns.run(sha(token), member_id, Date.now() + SESSION_MS);
      return token;
    },
    getSession: (token) => (token ? q.sessGet.get(sha(token), Date.now()) || null : null),
    deleteSession: (token) => token && q.sessDel.run(sha(token)),
    SESSION_MS,
  };
}

module.exports = { openDb };
