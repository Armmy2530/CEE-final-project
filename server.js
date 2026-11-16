'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./lib/db');
const { createSource } = require('./lib/sheets');
const { buildDashboard } = require('./lib/dashboard');
const { todayInTz } = require('./lib/dates');
const { askClaude, answerOffline } = require('./lib/chat');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const ID_RE = /^[A-Za-z0-9_-]{2,20}$/;

function loadEnvFile() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Fixed-window limiter keyed by string.
function limiter(max, windowMs) {
  const hits = new Map();
  return {
    take(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
      h.n += 1;
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return h.n <= max;
    },
    clear: (key) => hits.delete(key),
  };
}

function createApp({ env = process.env, source = createSource({ env }), db } = {}) {
  db = db || openDb(env.DB_PATH || path.join(__dirname, 'data', 'app.db'));
  const tz = env.TZ_NAME || 'Asia/Bangkok';
  const loginLimit = limiter(8, 15 * 60 * 1000);
  const chatLimit = limiter(20, 60 * 1000);
  let seeded = false;

  // Accounts are seeded from the Members tab the first time data is available.
  async function ensureSeeded() {
    if (seeded) return;
    try { const r = await source.getData(); db.seedFromMembers(r.data.Members); seeded = true; }
    catch (e) { console.error('seed:', e.message); }
  }

  async function getDashboard(force) {
    const r = await source.getData({ force });
    if (!seeded) { db.seedFromMembers(r.data.Members); seeded = true; }
    return { ...buildDashboard(r.data, todayInTz(tz)), meta: { source: r.source, fetchedAt: r.fetchedAt, stale: !!r.stale } };
  }

  const send = (res, code, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(code, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(isStr ? body : JSON.stringify(body));
  };
  const fail = (res, code, error) => send(res, code, { error });

  async function readJson(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 20000) throw Object.assign(new Error('too large'), { code: 413 }); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
  }

  const cookieOf = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
  const secure = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const setCookie = (req, token, maxAge) =>
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
  const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 100;

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
    if (unsafe) {
      if (!(req.headers['content-type'] || '').startsWith('application/json') && req.method !== 'DELETE') return fail(res, 415, 'JSON required');
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return fail(res, 403, 'Bad origin');
    }
    const token = cookieOf(req, 'sid');
    const user = db.getSession(token);
    const ip = req.socket.remoteAddress || '';

    if (route.startsWith('POST /api/auth/')) await ensureSeeded();
    if (route === 'GET /api/health') return send(res, 200, { ok: true, dataSource: source.mode });

    // ---- auth ----
    if (route === 'POST /api/auth/setup') {          // first-time sign in: create password
      const { member_id, password } = await readJson(req);
      if (!loginLimit.take(`setup:${ip}`)) return fail(res, 429, 'Too many attempts. Try again later.');
      if (!validPassword(password)) return fail(res, 400, 'Password must be at least 8 characters.');
      const u = typeof member_id === 'string' ? db.getUser(member_id.trim()) : null;
      if (!u || u.pw_hash) return fail(res, 400, 'This ID is not registered or already has a password. Ask an admin to reset it.');
      await db.setPassword(u.member_id, password);
      const t = db.createSession(u.member_id);
      return send(res, 200, { user: { member_id: u.member_id, full_name: u.full_name, role: u.role } }, { 'set-cookie': setCookie(req, t, db.SESSION_MS / 1000) });
    }
    if (route === 'POST /api/auth/login') {
      const { member_id, password } = await readJson(req);
      const key = `login:${ip}:${String(member_id).toLowerCase()}`;
      if (!loginLimit.take(key)) return fail(res, 429, 'Too many attempts. Try again in 15 minutes.');
      const u = typeof member_id === 'string' && typeof password === 'string' ? await db.verifyPassword(member_id.trim(), password) : null;
      if (!u) {
        const exists = typeof member_id === 'string' && db.getUser(member_id.trim());
        return fail(res, 401, exists && !exists.pw_hash ? 'This account has no password yet. Use "First time? Create password".' : 'Wrong ID or password.');
      }
      loginLimit.clear(key);
      const t = db.createSession(u.member_id);
      return send(res, 200, { user: u }, { 'set-cookie': setCookie(req, t, db.SESSION_MS / 1000) });
    }
    if (route === 'POST /api/auth/logout') {
      db.deleteSession(token);
      return send(res, 200, { ok: true }, { 'set-cookie': setCookie(req, '', 0) });
    }
    if (route === 'GET /api/me') return user ? send(res, 200, { user }) : fail(res, 401, 'Not signed in');

    if (!user) return fail(res, 401, 'Not signed in');

    // ---- data ----
    if (route === 'GET /api/dashboard') {
      try { return send(res, 200, await getDashboard(url.searchParams.get('refresh') === '1' && chatLimit.take(`refresh:${user.member_id}`))); }
      catch (e) { console.error('dashboard:', e.message); return fail(res, 502, 'Could not load data from Google Sheets.'); }
    }

    if (route === 'POST /api/chat') {
      const { message, history } = await readJson(req);
      if (typeof message !== 'string' || !message.trim() || message.length > 500) return fail(res, 400, 'Message must be 1-500 characters.');
      if (!chatLimit.take(`chat:${user.member_id}`)) return fail(res, 429, 'Slow down a little.');
      const hist = (Array.isArray(history) ? history : []).filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .slice(-6).map((h) => ({ role: h.role, content: h.content.slice(0, 1000) }));
      const dash = await getDashboard(false);
      if (env.ANTHROPIC_API_KEY) {
        try { return send(res, 200, { reply: await askClaude({ env, dash, message: message.trim(), history: hist }), mode: 'ai' }); }
        catch (e) { console.error('chat:', e.message); }
      }
      return send(res, 200, { reply: answerOffline(message, dash), mode: 'offline' });
    }

    // ---- admin ----
    if (url.pathname.startsWith('/api/admin/')) {
      if (user.role !== 'admin') return fail(res, 403, 'Admins only');
      if (route === 'GET /api/admin/users') return send(res, 200, { users: db.listUsers() });
      if (route === 'POST /api/admin/users') {
        const { member_id, full_name, role } = await readJson(req);
        const id = typeof member_id === 'string' ? member_id.trim() : '';
        const name = typeof full_name === 'string' ? full_name.trim() : '';
        if (!ID_RE.test(id)) return fail(res, 400, 'ID must be 2-20 letters, digits, - or _.');
        if (!name || name.length > 80) return fail(res, 400, 'Name is required (max 80 characters).');
        if (role !== 'admin' && role !== 'user') return fail(res, 400, 'Role must be admin or user.');
        if (db.getUser(id)) return fail(res, 409, 'This ID already exists.');
        db.createUser(id, name, role);
        return send(res, 201, { users: db.listUsers() });
      }
      const m = url.pathname.match(/^\/api\/admin\/users\/([^/]+?)(\/reset)?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'DELETE' && !m[2]) {
          if (id === user.member_id) return fail(res, 400, 'You cannot delete your own account.');
          const r = db.deleteUser(id);
          if (r === 'not_found') return fail(res, 404, 'User not found.');
          if (r === 'last_admin') return fail(res, 400, 'Cannot delete the last admin.');
          return send(res, 200, { users: db.listUsers() });
        }
        if (req.method === 'POST' && m[2]) {
          if (!db.getUser(id)) return fail(res, 404, 'User not found.');
          db.resetPassword(id);
          return send(res, 200, { users: db.listUsers() });
        }
      }
    }
    return fail(res, 404, 'Not found');
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      if (e.code === 413 || e.code === 400) return fail(res, e.code, e.message);
      console.error(e);
      return fail(res, 500, 'Server error');
    }
  });
  return { server, db };
}

if (require.main === module) {
  loadEnvFile();
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Club dashboard on http://localhost:${port}  (data: ${createSource().mode})`));
}

module.exports = { createApp };
