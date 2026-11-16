'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { openDb } = require('../lib/db');
const { buildAlerts } = require('../lib/alerts');
const { parseBatchResponse, createSource } = require('../lib/sheets');
const { normalizeDate, daysBetween, addDays } = require('../lib/dates');
const { answerOffline } = require('../lib/chat');
const { buildDashboard } = require('../lib/dashboard');
const { generateMock } = require('../lib/mock');

// ---- alert engine ----
const ev = (o) => ({ event_id: 'E', title: 'T', date: '2026-11-20', location: 'L', budget_planned: 1000, actual: 0, status: 'Scheduled', ...o });
const run = (events, today = '2026-11-14') => buildAlerts({ events, totals: { planned: 1e9, actual: 0 } }, today);

test('budget alert fires at exactly 80% but not at 79%', () => {
  assert.equal(run([ev({ actual: 800, date: '2027-01-01' })]).length, 1);
  assert.equal(run([ev({ actual: 790, date: '2027-01-01' })]).length, 0);
  assert.equal(run([ev({ actual: 1000, date: '2027-01-01' })])[0].severity, 'critical');
});
test('upcoming alert: 0..3 days only, Scheduled only', () => {
  assert.equal(run([ev({ date: '2026-11-14' })]).length, 1);
  assert.equal(run([ev({ date: '2026-11-17' })]).length, 1);
  assert.equal(run([ev({ date: '2026-11-18' })]).length, 0);
  assert.equal(run([ev({ date: '2026-11-13' })]).length, 0);
  assert.equal(run([ev({ date: '2026-11-15', status: 'Cancelled' })]).length, 0);
  assert.equal(run([ev({ date: '2026-11-15', status: 'Completed' })]).length, 0);
});

// ---- dates / sheets parsing ----
test('date parsing', () => {
  assert.equal(normalizeDate('2026-11-05'), '2026-11-05');
  assert.equal(normalizeDate('5/11/2026'), '2026-11-05');
  assert.equal(normalizeDate('05-11-2569'), '2026-11-05');
  assert.equal(normalizeDate('31/02/2026'), null);
  assert.equal(daysBetween('2026-11-14', '2026-11-17'), 3);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});
const sheetJson = {
  valueRanges: [
    { range: 'Members!A1:F25', values: [['member_id', 'full_name', 'department', 'role', 'email', 'joined_date', 'gender', 'year', 'major'], ['ST001', 'A', 'X', 'President', 'a@example.com', '1/1/2026', 'หญิง', '2', 'Chem']] },
    { range: 'Events!A1:E5', values: [['event_id', 'title', 'date', 'end_date', 'location', 'description', 'budget_planned', 'status'], ['E1', 'Camp', '20/11/2026', '22/11/2026', 'Hall', 'About', '฿12,000', 'ดำเนินการ']] },
    { range: 'Attendance!A1:E5', values: [['attendance_id', 'event_id', 'member_id', 'check_in_time', 'status', 'participant_type'], ['A1', 'E1', 'ST001', '', 'present', 'staff']] },
    { range: 'Budget!A1:F5', values: [['expense_id', 'event_id', 'category', 'amount', 'date', 'receipt_ref'], ['X1', 'E1', 'Food', '1,500.50', '2026-11-01', 'R1']] },
  ],
};
test('parseBatchResponse normalizes Google Sheets values', () => {
  const d = parseBatchResponse(sheetJson);
  assert.equal(d.Events[0].budget_planned, 12000);
  assert.equal(d.Events[0].status, 'Scheduled');
  assert.equal(d.Events[0].date, '2026-11-20');
  assert.equal(d.Budget[0].amount, 1500.5);
  assert.equal(d.Attendance[0].status, 'Present');
  assert.equal(d.Attendance[0].participant_type, 'Staff');
  assert.equal(d.Events[0].end_date, '2026-11-22');
  assert.equal(d.Members[0].gender, 'Female');
  assert.equal(d.Members[0].year, '2');
});
test('parseBatchResponse rejects a missing tab', () => {
  assert.throws(() => parseBatchResponse({ valueRanges: sheetJson.valueRanges.slice(0, 2) }), /not found/);
});
test('source makes ONE batched call, caches, and serves stale on error', async () => {
  let calls = 0, fail = false, t = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.match(url, /values:batchGet/);
    if (fail) return { ok: false, status: 429 };
    return { ok: true, json: async () => sheetJson };
  };
  const src = createSource({ env: { GOOGLE_API_KEY: 'k', GOOGLE_SHEET_ID: 's', SHEET_CACHE_SECONDS: '30' }, fetchImpl, now: () => t });
  await Promise.all([src.getData(), src.getData(), src.getData()]);
  assert.equal(calls, 1);
  await src.getData(); assert.equal(calls, 1);
  t = 31000; fail = true;
  const r = await src.getData();
  assert.equal(calls, 2); assert.equal(r.stale, true); assert.equal(r.data.Events.length, 1);
});

test('dashboard aggregates and mock data triggers the demo alerts', () => {
  const today = '2026-11-14';
  const dash = buildDashboard(generateMock(today), today);
  assert.equal(dash.metrics.members, 24);
  assert.equal(dash.metrics.budgetActual, dash.events.reduce((s, e) => s + e.actual, 0));
  assert.ok(dash.alerts.some((a) => a.type === 'upcoming'));
  assert.ok(dash.alerts.some((a) => a.type === 'budget' && a.severity === 'critical'));
});
test('project detail: staff/participants, this-year breakdown, budget', () => {
  const today = '2026-11-15';
  const dash = buildDashboard(generateMock(today), today);
  const camp = dash.events.find((e) => e.title === 'Study Camp');
  assert.equal(camp.days, 3);
  assert.equal(camp.stats.staff, camp.staff.length);
  assert.equal(camp.stats.participants, camp.participants.length);
  const total = (o) => Object.values(o).reduce((s, n) => s + n, 0);
  assert.equal(total(camp.breakdown.gender), total(camp.breakdown.major));
  assert.equal(total(camp.breakdown.gender), total(camp.breakdown.year));
  assert.equal(camp.actual, camp.expenses.reduce((s, e) => s + e.amount, 0));
  // attendance from an earlier calendar year is excluded ("this year only")
  const old = buildDashboard(generateMock(today), '2027-03-01');
  assert.equal(Object.keys(old.events.find((e) => e.title === 'Study Camp').breakdown.gender).length, 0);
  // events without attendance have empty breakdowns, not errors
  assert.deepEqual(dash.events.find((e) => e.title === 'Year-End Party').breakdown.gender, {});
});

test('project search ranks by name relevance and tolerates typos/Thai', () => {
  const S = require('../public/search.js');
  const items = ['Orientation Day', 'Study Camp', 'Career Talk', 'Camp Fire Night', 'Photography Walk', 'ค่ายติวสอบ']
    .map((t, i) => ({ title: t, date: `2026-01-0${i + 1}` }));
  const titles = (q) => S.rank(items, q).map((x) => x.title);
  assert.deepEqual(titles('camp').slice(0, 2), ['Camp Fire Night', 'Study Camp']); // name starts with query ranks first
  assert.equal(titles('photgraphy')[0], 'Photography Walk');                       // typo
  assert.equal(titles('talk career')[0], 'Career Talk');                           // word order
  assert.equal(titles('ค่าย')[0], 'ค่ายติวสอบ');                                   // Thai
  assert.deepEqual(titles('zzzz'), []);
  assert.equal(titles('  ').length, items.length);                                 // empty query keeps all
});

test('offline chat answers in Thai and English', () => {
  const dash = buildDashboard(generateMock('2026-11-14'), '2026-11-14');
  assert.match(answerOffline('how many members?', dash), /24 members/);
  assert.match(answerOffline('จำนวนสมาชิก', dash), /24 คน/);
});

// ---- HTTP: auth, roles, admin ----
async function boot() {
  const { server, db } = createApp({ env: { TZ_NAME: 'Asia/Bangkok' }, db: openDb(':memory:') });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, cookie) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  return { call, close: () => server.close(), base };
}

test('auth flow, roles and admin permissions', async () => {
  const { call, close, base } = await boot();
  try {
    assert.equal((await call('GET', '/api/dashboard')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { member_id: 'ST001', password: 'x' })).status, 401); // no password yet
    assert.equal((await call('POST', '/api/auth/setup', { member_id: 'NOPE99', password: 'longenough1' })).status, 400);
    assert.equal((await call('POST', '/api/auth/setup', { member_id: 'ST001', password: 'short' })).status, 400);
    const adm = await call('POST', '/api/auth/setup', { member_id: 'ST001', password: 'adminpass1' });
    assert.equal(adm.status, 200); assert.equal(adm.body.user.role, 'admin');
    assert.equal((await call('POST', '/api/auth/setup', { member_id: 'ST001', password: 'hijack1234' })).status, 400); // already set
    assert.equal((await call('POST', '/api/auth/login', { member_id: 'ST001', password: 'wrongpass1' })).status, 401);
    const login = await call('POST', '/api/auth/login', { member_id: 'ST001', password: 'adminpass1' });
    assert.equal(login.status, 200);
    const dash = await call('GET', '/api/dashboard', null, login.cookie);
    assert.equal(dash.status, 200); assert.equal(dash.body.metrics.members, 24);

    // admin creates + deletes
    let r = await call('POST', '/api/admin/users', { member_id: 'ST777', full_name: 'New Person', role: 'user' }, login.cookie);
    assert.equal(r.status, 201);
    assert.equal((await call('POST', '/api/admin/users', { member_id: 'ST777', full_name: 'Dup', role: 'user' }, login.cookie)).status, 409);
    assert.equal((await call('POST', '/api/admin/users', { member_id: 'bad id!', full_name: 'X', role: 'user' }, login.cookie)).status, 400);

    // normal user cannot use admin routes
    const u = await call('POST', '/api/auth/setup', { member_id: 'ST777', password: 'userpass99' });
    assert.equal((await call('GET', '/api/admin/users', null, u.cookie)).status, 403);
    assert.equal((await call('DELETE', '/api/admin/users/ST001', null, u.cookie)).status, 403);

    // admin cannot delete self / last admin; can reset and delete others
    assert.equal((await call('DELETE', '/api/admin/users/ST001', null, login.cookie)).status, 400);
    assert.equal((await call('POST', '/api/admin/users/ST777/reset', {}, login.cookie)).status, 200);
    assert.equal((await call('GET', '/api/me', null, u.cookie)).status, 401); // reset ends sessions
    assert.equal((await call('DELETE', '/api/admin/users/ST777', null, login.cookie)).status, 200);

    // chat works + validates
    assert.equal((await call('POST', '/api/chat', { message: 'งบ' }, login.cookie)).body.mode, 'offline');
    assert.equal((await call('POST', '/api/chat', { message: '' }, login.cookie)).status, 400);

    // logout invalidates the session
    await call('POST', '/api/auth/logout', {}, login.cookie);
    assert.equal((await call('GET', '/api/me', null, login.cookie)).status, 401);

    // CSRF-ish: cross-origin and non-JSON writes are refused
    const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(bad.status, 415);
    const xo = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(xo.status, 403);
    // static: no path traversal, security headers
    assert.equal((await fetch(base + '/..%2fpackage.json')).status, 403);
    const idx = await fetch(base + '/');
    assert.equal(idx.status, 200); assert.ok(idx.headers.get('content-security-policy'));
  } finally { close(); }
});

test('login is rate limited', async () => {
  const { call, close } = await boot();
  try {
    let last;
    for (let i = 0; i < 10; i++) last = await call('POST', '/api/auth/login', { member_id: 'ST002', password: 'nope' + i });
    assert.equal(last.status, 429);
  } finally { close(); }
});
