import { describe, test, expect } from 'bun:test';
import type { RequestEvent } from '@sveltejs/kit';

import { buildAlerts } from '../src/lib/server/alerts';
import { normalizeDate, daysBetween, addDays } from '../src/lib/server/dates';
import { parseBatchResponse, createSource } from '../src/lib/server/sheets';
import { buildDashboard } from '../src/lib/server/dashboard';
import { generateMock, parseCsv } from '../src/lib/server/mock';
import { answerOffline } from '../src/lib/server/chat';
import { openDb } from '../src/lib/server/db';
import { createRuntime, setRuntimeForTesting } from '../src/lib/server/runtime';
import { rank } from '../src/lib/search';

import { handle } from '../src/hooks.server';
import { load as layoutLoad } from '../src/routes/+layout.server';
import * as healthRoute from '../src/routes/api/health/+server';
import * as setupRoute from '../src/routes/api/auth/setup/+server';
import * as registerRoute from '../src/routes/api/auth/register/+server';
import * as loginRoute from '../src/routes/api/auth/login/+server';
import * as logoutRoute from '../src/routes/api/auth/logout/+server';
import * as meRoute from '../src/routes/api/me/+server';
import * as meThemeRoute from '../src/routes/api/me/theme/+server';
import * as dashRoute from '../src/routes/api/dashboard/+server';
import * as chatRoute from '../src/routes/api/chat/+server';
import * as adminUsersRoute from '../src/routes/api/admin/users/+server';
import * as adminUserIdRoute from '../src/routes/api/admin/users/[id]/+server';
import * as adminUserResetRoute from '../src/routes/api/admin/users/[id]/reset/+server';

// ---- alert engine ----
const ev = (o: Partial<Parameters<typeof buildAlerts>[0]['events'][number]> = {}) => ({
  event_id: 'E',
  title: 'T',
  date: '2026-11-20',
  location: 'L',
  budget_planned: 1000,
  actual: 0,
  status: 'Scheduled',
  ...o
});
const runAlerts = (events: ReturnType<typeof ev>[], today = '2026-11-14') =>
  buildAlerts({ events, totals: { planned: 1e9, actual: 0 } }, today);

describe('Alert engine', () => {
  test('budget alert fires at >= 80% and marks >= 100% critical', () => {
    expect(runAlerts([ev({ actual: 800, date: '2027-01-01' })])).toHaveLength(1);
    expect(runAlerts([ev({ actual: 790, date: '2027-01-01' })])).toHaveLength(0);
    const crit = runAlerts([ev({ actual: 1000, date: '2027-01-01' })]);
    expect(crit[0].severity).toBe('critical');
  });

  test('upcoming alert fires for 0..3 days only on Scheduled events', () => {
    expect(runAlerts([ev({ date: '2026-11-14' })])).toHaveLength(1);
    expect(runAlerts([ev({ date: '2026-11-17' })])).toHaveLength(1);
    expect(runAlerts([ev({ date: '2026-11-18' })])).toHaveLength(0);
    expect(runAlerts([ev({ date: '2026-11-13' })])).toHaveLength(0);
    expect(runAlerts([ev({ date: '2026-11-15', status: 'Cancelled' })])).toHaveLength(0);
    expect(runAlerts([ev({ date: '2026-11-15', status: 'Completed' })])).toHaveLength(0);
  });
});

// ---- dates & sheets parsing ----
describe('Dates and Google Sheets normalization', () => {
  test('date parsing handles ISO, D/M/YYYY, Buddhist Era, and invalid dates', () => {
    expect(normalizeDate('2026-11-05')).toBe('2026-11-05');
    expect(normalizeDate('5/11/2026')).toBe('2026-11-05');
    expect(normalizeDate('05-11-2569')).toBe('2026-11-05');
    expect(normalizeDate('31/02/2026')).toBeNull();
    expect(daysBetween('2026-11-14', '2026-11-17')).toBe(3);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  const sheetJson = {
    valueRanges: [
      {
        range: 'Members!A1:J10',
        values: [
          ['Student_ID', 'Name', 'Committee', 'Role', 'Email', 'Join_Date', 'Gender', 'Year', 'Department'],
          ['MOCK-66-0001', 'Aiden Adams', 'Academic Affairs', 'President', 'a@example.com', '1/1/2026', 'ชาย', 'Year 2', 'Mechatronics']
        ]
      },
      {
        range: 'Events!A1:I10',
        values: [
          ['Project_ID', 'Project_Name', 'Start_Date', 'End_Date', 'Location', 'Description', 'Total_Income', 'Status'],
          ['AC-001', 'Camp', '20/11/2026', '22/11/2026', 'Hall', 'About', '฿12,000', 'Waiting for approving'],
          ['AC-002', 'DoneProj', '10/10/2026', '10/10/2026', 'Room 1', 'Done', '5000', 'Done']
        ]
      },
      {
        range: 'Attendance!A1:K10',
        values: [
          ['attendance_id', 'Project_ID', 'Student_ID', 'Name', 'check_in_time', 'status', 'Role', 'Department / Year', 'gender'],
          ['A1', 'AC-001', 'MOCK-66-0001', 'Aiden Adams', '2026-11-20 09:00', 'present', 'IT Head', 'Computer Engineering / Year 3', 'Male']
        ]
      },
      {
        range: 'Budget!A1:G10',
        values: [
          ['TX_ID', 'Project_ID', 'Type', 'Expense_Type', 'amount', 'date', 'receipt_ref'],
          ['TX-001', 'AC-001', 'Income', '', '12,000', '2026-11-01', 'R1'],
          ['TX-002', 'AC-001', 'Expense', 'Food', '1,500.50', '2026-11-02', 'R2']
        ]
      }
    ]
  };

  test('parseBatchResponse normalizes standard and Mock-Data aliases, statuses, and Income/Expense', () => {
    const d = parseBatchResponse(sheetJson);
    expect(d.Members[0].member_id).toBe('MOCK-66-0001');
    expect(d.Members[0].department).toBe('Academic Affairs');
    expect(d.Members[0].major).toBe('Mechatronics');
    expect(d.Members[0].gender).toBe('Male');
    expect(d.Members[0].year).toBe('2');

    expect(d.Events[0].budget_planned).toBe(12000);
    expect(d.Events[0].status).toBe('Scheduled');
    expect(d.Events[0].date).toBe('2026-11-20');
    expect(d.Events[0].end_date).toBe('2026-11-22');
    expect(d.Events[1].status).toBe('Completed');

    expect(d.Attendance[0].status).toBe('Present');
    expect(d.Attendance[0].participant_type).toBe('Staff');
    expect(d.Attendance[0].project_role).toBe('IT Head');
    expect(d.Attendance[0].major).toBe('Computer Engineering');
    expect(d.Attendance[0].year).toBe('3');

    expect(d.Budget[0].type).toBe('Income');
    expect(d.Budget[0].category).toBe('Club Allocation');
    expect(d.Budget[1].type).toBe('Expense');
    expect(d.Budget[1].amount).toBe(1500.5);
  });

  test('parseBatchResponse rejects a missing tab', () => {
    expect(() => parseBatchResponse({ valueRanges: sheetJson.valueRanges.slice(0, 2) })).toThrow(/not found/);
  });

  test('source makes ONE batched call, caches, and serves stale on error', async () => {
    let calls = 0;
    let shouldFail = false;
    let t = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      calls++;
      expect(String(url)).toMatch(/values:batchGet/);
      if (shouldFail) return new Response(null, { status: 429 });
      return new Response(JSON.stringify(sheetJson), { status: 200 });
    }) as typeof fetch;

    const src = createSource({
      env: { GOOGLE_API_KEY: 'k', GOOGLE_SHEET_ID: 's', SHEET_CACHE_SECONDS: '30' },
      fetchImpl,
      now: () => t
    });

    await Promise.all([src.getData(), src.getData(), src.getData()]);
    expect(calls).toBe(1);
    await src.getData();
    expect(calls).toBe(1);

    t = 31000;
    shouldFail = true;
    const r = await src.getData();
    expect(calls).toBe(2);
    expect(r.stale).toBe(true);
    expect(r.data.Events).toHaveLength(2);
  });
});

// ---- Mock-Data CSV parsing & dashboard aggregation ----
describe('Mock-Data CSV & dashboard aggregation', () => {
  test('RFC-4180 CSV parser handles quoted fields with commas and escaped quotes', () => {
    const parsed = parseCsv('a,b,c\nAC-001,"Eng 3 Building, Room 301","hello ""world"""\n');
    expect(parsed).toEqual([
      ['a', 'b', 'c'],
      ['AC-001', 'Eng 3 Building, Room 301', 'hello "world"']
    ]);
  });

  test('dashboard aggregates real normalized Mock-Data (67 members, 20 events, 220,580 Expense total, breakdowns, alerts)', () => {
    const today = '2026-11-16';
    const data = generateMock(today);
    expect(data.Members).toHaveLength(67);
    expect(data.Events).toHaveLength(20);
    expect(data.Attendance).toHaveLength(2322);
    expect(data.Budget).toHaveLength(126);

    const dash = buildDashboard(data, today);
    expect(dash.metrics.members).toBe(67);
    expect(dash.metrics.events).toBe(20);
    expect(dash.metrics.budgetActual).toBe(220580);
    expect(dash.metrics.budgetIncome).toBe(384500);
    expect(dash.metrics.budgetActual).toBe(dash.events.reduce((s, e) => s + e.actual, 0));

    // Alerts include both upcoming (AC-016) and budget >= 80% (AC-001..AC-013)
    expect(dash.alerts.some((a) => a.type === 'upcoming' && a.event_id === 'AC-016')).toBe(true);
    expect(dash.alerts.some((a) => a.type === 'budget' && a.event_id === 'AC-007')).toBe(true);

    // Attendance breakdowns populated for both 2026 and 2027 projects
    const sumVals = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
    for (const eid of ['AC-001', 'AC-007', 'AC-016', 'AC-018', 'AC-019', 'AC-020']) {
      const proj = dash.events.find((e) => e.event_id === eid)!;
      expect(proj).toBeDefined();
      expect(sumVals(proj.breakdown.gender)).toBeGreaterThan(0);
      expect(sumVals(proj.breakdown.gender)).toBe(sumVals(proj.breakdown.year));
      expect(sumVals(proj.breakdown.gender)).toBe(sumVals(proj.breakdown.major));
      expect(proj.actual).toBe(proj.expenses.reduce((s, x) => s + x.amount, 0));
    }

    // Staff project roles preserved
    const ac1 = dash.events.find((e) => e.event_id === 'AC-001')!;
    expect(ac1.staff.some((s) => s.role === 'President')).toBe(true);
    expect(ac1.location).toBe('Eng 3 Building, Room 301');

    // Empty attendance event still handles empty breakdowns cleanly
    const custom = {
      ...data,
      Events: [
        ...data.Events,
        {
          event_id: 'AC-999',
          title: 'Empty Event',
          date: '2026-12-01',
          end_date: '2026-12-01',
          location: 'Hall',
          description: '',
          budget_planned: 1000,
          status: 'Scheduled' as const,
          image_url: ''
        }
      ]
    };
    const dash2 = buildDashboard(custom, today);
    expect(dash2.events.find((e) => e.event_id === 'AC-999')!.breakdown.gender).toEqual({});
  });
});

// ---- Search & Offline Chat ----
describe('Project search and offline chat', () => {
  test('project search ranks by name relevance and tolerates typos/Thai', () => {
    const items = ['Orientation Day', 'Study Camp', 'Career Talk', 'Camp Fire Night', 'Photography Walk', 'ค่ายติวสอบ']
      .map((t, i) => ({ title: t, date: `2026-01-0${i + 1}` }));
    const titles = (q: string) => rank(items, q).map((x) => x.title);
    expect(titles('camp').slice(0, 2)).toEqual(['Camp Fire Night', 'Study Camp']);
    expect(titles('photgraphy')[0]).toBe('Photography Walk');
    expect(titles('talk career')[0]).toBe('Career Talk');
    expect(titles('ค่าย')[0]).toBe('ค่ายติวสอบ');
    expect(titles('zzzz')).toEqual([]);
    expect(titles('  ')).toHaveLength(items.length);
  });

  test('offline chat answers in Thai and English for 67 members', () => {
    const dash = buildDashboard(generateMock('2026-11-16'), '2026-11-16');
    expect(answerOffline('how many members?', dash)).toMatch(/67 members/);
    expect(answerOffline('จำนวนสมาชิก', dash)).toMatch(/67 คน/);
  });
});

// ---- SvelteKit API Integration Tests ----
function createHarness() {
  const db = openDb(':memory:');
  const rt = createRuntime({ env: { TZ_NAME: 'Asia/Bangkok' }, db });
  setRuntimeForTesting(rt);

  const routes: Array<{
    pattern: RegExp;
    handlers: Record<string, (e: RequestEvent) => Promise<Response>>;
    paramNames?: string[];
  }> = [
    { pattern: /^\/api\/health$/, handlers: healthRoute as never },
    { pattern: /^\/api\/auth\/setup$/, handlers: setupRoute as never },
    { pattern: /^\/api\/auth\/register$/, handlers: registerRoute as never },
    { pattern: /^\/api\/auth\/login$/, handlers: loginRoute as never },
    { pattern: /^\/api\/auth\/logout$/, handlers: logoutRoute as never },
    { pattern: /^\/api\/me$/, handlers: meRoute as never },
    { pattern: /^\/api\/me\/theme$/, handlers: meThemeRoute as never },
    { pattern: /^\/api\/dashboard$/, handlers: dashRoute as never },
    { pattern: /^\/api\/chat$/, handlers: chatRoute as never },
    { pattern: /^\/api\/admin\/users$/, handlers: adminUsersRoute as never },
    { pattern: /^\/api\/admin\/users\/([^/]+)$/, handlers: adminUserIdRoute as never, paramNames: ['id'] },
    { pattern: /^\/api\/admin\/users\/([^/]+)\/reset$/, handlers: adminUserResetRoute as never, paramNames: ['id'] }
  ];

  async function call(
    method: string,
    path: string,
    body?: unknown,
    cookieHeader?: string,
    extraHeaders: Record<string, string> = {}
  ) {
    const url = new URL(`http://localhost${path}`);
    const reqCookies = new Map<string, string>();
    if (cookieHeader) {
      for (const part of cookieHeader.split(/;\s*/)) {
        const eq = part.indexOf('=');
        if (eq > 0) reqCookies.set(part.slice(0, eq), part.slice(eq + 1));
      }
    }

    const setCookieHeaders: string[] = [];
    const headers = new Headers({
      host: 'localhost',
      ...(method !== 'GET' && method !== 'HEAD' && !('content-type' in extraHeaders)
        ? { 'content-type': 'application/json' }
        : {}),
      ...extraHeaders
    });

    const request = new Request(url, {
      method,
      headers,
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
    });

    const cookies = {
      get: (name: string) => reqCookies.get(name),
      getAll: () => Array.from(reqCookies.entries()).map(([name, value]) => ({ name, value })),
      set: (name: string, value: string, opts?: { maxAge?: number; path?: string }) => {
        const parts = [`${name}=${value}`, `Path=${opts?.path || '/'}`];
        if (opts?.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
        setCookieHeaders.push(parts.join('; '));
        if (opts?.maxAge === 0) reqCookies.delete(name);
        else reqCookies.set(name, value);
      },
      delete: (name: string, opts?: { path?: string }) => {
        setCookieHeaders.push(`${name}=; Path=${opts?.path || '/'}; Max-Age=0`);
        reqCookies.delete(name);
      },
      serialize: (name: string, value: string) => `${name}=${value}`
    };

    let matchedParams: Record<string, string> = {};
    let handler: ((e: RequestEvent) => Promise<Response>) | null = null;
    for (const r of routes) {
      const m = url.pathname.match(r.pattern);
      if (m) {
        if (r.paramNames) {
          r.paramNames.forEach((p, idx) => (matchedParams[p] = m[idx + 1]));
        }
        handler = r.handlers[method] || null;
        break;
      }
    }

    const event = {
      request,
      url,
      cookies,
      locals: {} as App.Locals,
      params: matchedParams,
      getClientAddress: () => '127.0.0.1'
    } as unknown as RequestEvent;

    const response = await handle({
      event,
      resolve: async (ev, opts) => {
        if (url.pathname === '/') {
          const data = await layoutLoad({ locals: ev.locals, cookies: ev.cookies } as never);
          let html = `<!doctype html><html data-theme="%sveltekit.theme%"><body>${JSON.stringify(data)}</body></html>`;
          if (opts?.transformPageChunk) {
            html = (await opts.transformPageChunk({ html, done: true })) || html;
          }
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        if (!handler) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        return handler(ev);
      }
    });

    const json = await response.clone().json().catch(() => ({}));
    const text = await response.clone().text().catch(() => '');
    const sidCookie = setCookieHeaders.find((c) => c.startsWith('sid='))?.split(';')[0] || '';
    const allCookies = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');

    return {
      status: response.status,
      headers: response.headers,
      body: json as Record<string, any>,
      text,
      cookie: sidCookie,
      allCookies
    };
  }

  return { call, close: () => db.close() };
}

describe('SvelteKit API routes, auth, theme persistence, and rate limiting', () => {
  test('auth setup, register, login, logout, theme persistence, admin permissions, and security checks', async () => {
    const { call, close } = createHarness();
    try {
      const health = await call('GET', '/api/health');
      expect(health.status).toBe(200);
      expect(health.body).toEqual({ ok: true, dataSource: 'mock' });

      expect((await call('GET', '/api/dashboard')).status).toBe(401);
      expect((await call('POST', '/api/auth/login', { member_id: 'MOCK-66-0001', password: 'x' })).status).toBe(401);
      expect((await call('POST', '/api/auth/setup', { member_id: 'NOPE99', password: 'longenough1' })).status).toBe(400);
      expect((await call('POST', '/api/auth/setup', { member_id: 'MOCK-66-0001', password: 'short' })).status).toBe(400);

      // Admin setup on MOCK-66-0001
      const adm = await call('POST', '/api/auth/setup', { member_id: 'MOCK-66-0001', password: 'adminpass1' });
      expect(adm.status).toBe(200);
      expect(adm.body.user.role).toBe('admin');

      // Cannot re-setup an account that already has a password
      expect((await call('POST', '/api/auth/setup', { member_id: 'MOCK-66-0001', password: 'hijack1234' })).status).toBe(400);

      // Login
      expect((await call('POST', '/api/auth/login', { member_id: 'MOCK-66-0001', password: 'wrongpass1' })).status).toBe(401);
      const login = await call('POST', '/api/auth/login', { member_id: 'MOCK-66-0001', password: 'adminpass1' });
      expect(login.status).toBe(200);

      // Dashboard returns Mock-Data aggregates
      const dash = await call('GET', '/api/dashboard', undefined, login.cookie);
      expect(dash.status).toBe(200);
      expect(dash.body.metrics.members).toBe(67);
      expect(dash.body.metrics.events).toBe(20);
      expect(dash.body.metrics.budgetActual).toBe(220580);

      // Theme persistence in SQLite + SSR HTML rendering
      expect((await call('PATCH', '/api/me/theme', { theme: 'neon' }, login.cookie)).status).toBe(400);
      const themeRes = await call('PATCH', '/api/me/theme', { theme: 'dark' }, login.cookie);
      expect(themeRes.status).toBe(200);
      expect(themeRes.body.theme).toBe('dark');
      const meAfter = await call('GET', '/api/me', undefined, login.cookie);
      expect(meAfter.body.user.theme).toBe('dark');
      const ssrPage = await call('GET', '/', undefined, login.cookie);
      expect(ssrPage.text).toContain('<html data-theme="dark">');

      // Public Sign up (/api/auth/register)
      const reg = await call('POST', '/api/auth/register', {
        member_id: 'REG-001',
        full_name: 'Registered Evaluator',
        password: 'evaluator123'
      });
      expect(reg.status).toBe(201);
      expect(reg.body.user.role).toBe('user');
      expect((await call('GET', '/api/me', undefined, reg.cookie)).status).toBe(200);
      expect(
        (
          await call('POST', '/api/auth/register', {
            member_id: 'REG-001',
            full_name: 'Dup',
            password: 'evaluator123'
          })
        ).status
      ).toBe(409);

      // Admin creates & manages users
      const created = await call(
        'POST',
        '/api/admin/users',
        { member_id: 'MOCK-66-9999', full_name: 'New Person', role: 'user' },
        login.cookie
      );
      expect(created.status).toBe(201);
      expect(
        (
          await call(
            'POST',
            '/api/admin/users',
            { member_id: 'MOCK-66-9999', full_name: 'Dup', role: 'user' },
            login.cookie
          )
        ).status
      ).toBe(409);
      expect(
        (
          await call(
            'POST',
            '/api/admin/users',
            { member_id: 'bad id!', full_name: 'X', role: 'user' },
            login.cookie
          )
        ).status
      ).toBe(400);

      // Normal user cannot call admin endpoints
      const u = await call('POST', '/api/auth/setup', { member_id: 'MOCK-66-9999', password: 'userpass99' });
      expect((await call('GET', '/api/admin/users', undefined, u.cookie)).status).toBe(403);
      expect((await call('DELETE', '/api/admin/users/MOCK-66-0001', undefined, u.cookie)).status).toBe(403);

      // Admin cannot delete self / last admin; can reset and delete others
      expect((await call('DELETE', '/api/admin/users/MOCK-66-0001', undefined, login.cookie)).status).toBe(400);
      expect((await call('POST', '/api/admin/users/MOCK-66-9999/reset', {}, login.cookie)).status).toBe(200);
      expect((await call('GET', '/api/me', undefined, u.cookie)).status).toBe(401);
      expect((await call('DELETE', '/api/admin/users/MOCK-66-9999', undefined, login.cookie)).status).toBe(200);

      // Chat endpoint
      const chatRes = await call('POST', '/api/chat', { message: 'งบ' }, login.cookie);
      expect(chatRes.status).toBe(200);
      expect(chatRes.body.mode).toBe('offline');
      expect((await call('POST', '/api/chat', { message: '' }, login.cookie)).status).toBe(400);

      // Logout invalidates session
      await call('POST', '/api/auth/logout', {}, login.cookie);
      expect((await call('GET', '/api/me', undefined, login.cookie)).status).toBe(401);

      // Security checks: non-JSON and cross-origin writes refused, security headers present
      const badCt = await call('POST', '/api/auth/login', '{}', undefined, { 'content-type': 'text/plain' });
      expect(badCt.status).toBe(415);
      const xo = await call('POST', '/api/auth/login', {}, undefined, {
        'content-type': 'application/json',
        origin: 'https://evil.example'
      });
      expect(xo.status).toBe(403);
      expect(health.headers.get('x-content-type-options')).toBe('nosniff');
      expect(health.headers.get('x-frame-options')).toBe('DENY');
    } finally {
      close();
    }
  });

  test('login is rate limited after 8 attempts', async () => {
    const { call, close } = createHarness();
    try {
      let last: Awaited<ReturnType<typeof call>> | null = null;
      for (let i = 0; i < 10; i++) {
        last = await call('POST', '/api/auth/login', { member_id: 'MOCK-66-0002', password: 'nope' + i });
      }
      expect(last?.status).toBe(429);
    } finally {
      close();
    }
  });
});
