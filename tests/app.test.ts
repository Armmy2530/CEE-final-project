import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';

import { buildAlerts } from '../src/lib/server/alerts';
import { normalizeDate, daysBetween, addDays } from '../src/lib/server/dates';
import { parseBatchResponse, createSource } from '../src/lib/server/sheets';
import { buildDashboard } from '../src/lib/server/dashboard';
import { generateMock, parseCsv, resolveSampleSheetsDir } from '../src/lib/server/mock';
import { answerOffline, askOpenRouter, buildContext } from '../src/lib/server/chat';
import { normalizeMemberId, openDb } from '../src/lib/server/db';
import { createRuntime, setRuntimeForTesting } from '../src/lib/server/runtime';
import { rank } from '../src/lib/search';
import {
  buildByDateMap,
  buildMonthGrid,
  buildWeekDays,
  buildWeekSpans,
  getMonthTitle,
  getWeekRange,
  getWeekStart,
  getWeekTitle,
  shiftMonthStr,
  shiftWeekStr
} from '../src/lib/calendar';

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

    // Staff project roles preserved & lead/category enrichment
    const ac1 = dash.events.find((e) => e.event_id === 'AC-001')!;
    expect(ac1.staff.some((s) => s.role === 'President')).toBe(true);
    expect(ac1.location).toBe('Eng 3 Building, Room 301');
    expect(ac1.lead.name).toBeTruthy();
    expect(ac1.lead.initials).toMatch(/^[A-Z]{1,2}$/);
    expect(ac1.category).toBe('Academic');

    const ac2 = dash.events.find((e) => e.event_id === 'AC-002')!;
    expect(ac2.category).toBe('Community');

    // Enriched Clubhouse DashboardPayload fields
    expect(dash.metrics.activeMembers).toBe(55);
    expect(dash.members).toHaveLength(67);
    expect(dash.membersByStatus).toEqual({ Active: 55, 'On leave': 8, Graduating: 4 });
    expect(dash.membersByGender).toEqual({ Male: 39, Female: 28 });
    expect(sumVals(dash.membersByYear)).toBe(67);
    expect(JSON.stringify(dash.members)).not.toMatch(/@|email|phone/i);
    expect('email' in dash.members[0]).toBe(false);

    // 126 transactions sorted newest date first with resolved event_title
    expect(dash.transactions).toHaveLength(126);
    expect(dash.transactions[0].event_title).toBeTruthy();
    for (let i = 1; i < dash.transactions.length; i++) {
      expect(dash.transactions[i - 1].date >= dash.transactions[i].date).toBe(true);
    }

    // Empty attendance event still handles empty breakdowns cleanly & fallback lead
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
    const ac999 = dash2.events.find((e) => e.event_id === 'AC-999')!;
    expect(ac999.breakdown.gender).toEqual({});
    expect(ac999.lead).toEqual({ member_id: '', name: 'Club Team', role: 'Organizer', initials: 'CT' });
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

  test('offline chat answers in Thai and English for 67 members, projects, and expense categories', () => {
    const dash = buildDashboard(generateMock('2026-11-16'), '2026-11-16');
    expect(answerOffline('how many members?', dash)).toMatch(/67 members/);
    expect(answerOffline('จำนวนสมาชิก', dash)).toMatch(/67 คน/);

    // Specific project code & name lookup
    const ac2 = answerOffline('What is the budget for AC-002?', dash);
    expect(ac2).toContain('AC-002');
    expect(ac2).toContain('Open House Engineering 2026');
    expect(ac2).toContain('฿44,000');

    const openHouse = answerOffline('Tell me about Open House', dash);
    expect(openHouse).toContain('Open House Engineering 2026');

    // Expense category lookup
    const food = answerOffline('How much did we spend on Food & Beverages?', dash);
    expect(food).toContain('Food & Beverages');
    const cats = answerOffline('สรุปหมวดค่าใช้จ่าย', dash);
    expect(cats).toContain('Speaker Honorarium');
  });

  test('buildContext includes enriched aggregates and never leaks member emails or phone numbers', () => {
    const dash = buildDashboard(generateMock('2026-11-16'), '2026-11-16');
    const ctx = buildContext(dash);
    expect(ctx.today).toBe('2026-11-16');
    expect(ctx.metrics.members).toBe(67);
    expect(ctx.metrics.events).toBe(20);
    expect(Object.keys(ctx.members_by_department).length).toBeGreaterThan(0);
    expect(ctx.spending_by_category['Food & Beverages']).toBeGreaterThan(0);
    expect(ctx.events).toHaveLength(20);
    expect(ctx.events[1]).toMatchObject({
      id: 'AC-002',
      title: 'Open House Engineering 2026',
      planned_budget: 44000
    });
    expect(ctx.active_alerts.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toMatch(/@example\.com|@chula\.ac\.th|email|phone/i);
  });

  test('askOpenRouter sends OpenAI-compatible request, headers, system context, and parses string & array replies', async () => {
    const dash = buildDashboard(generateMock('2026-11-16'), '2026-11-16');
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '  AC-002 spent ฿40,830 of ฿44,000.  ' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    const reply = await askOpenRouter({
      env: {
        OPENROUTER_API_KEY: 'sk-or-test-key',
        PUBLIC_APP_URL: 'https://club.example.com'
      },
      dash,
      message: 'How much did AC-002 spend?',
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' }
      ],
      fetchImpl: mockFetch
    });

    expect(reply).toBe('AC-002 spent ฿40,830 of ฿44,000.');
    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(capturedInit?.method).toBe('POST');

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-or-test-key');
    expect(headers.get('x-title')).toBe('Club Dashboard');
    expect(headers.get('http-referer')).toBe('https://club.example.com');
    expect(headers.get('content-type')).toBe('application/json');

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload.model).toBe('google/gemini-2.5-flash');
    expect(payload.max_tokens).toBe(500);
    expect(payload.temperature).toBe(0.2);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[0].content).toContain('"spending_by_category"');
    expect(payload.messages[0].content).toContain('"AC-002"');
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'How much did AC-002 spend?' }
    ]);

    // Array-of-parts content & custom model/base URL support
    const arrayFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'Line 1' },
                  { type: 'text', text: 'Line 2' }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const arrayReply = await askOpenRouter({
      env: {
        OPENROUTER_API_KEY: 'sk-or-test-key',
        OPENROUTER_MODEL: 'openai/gpt-4o-mini',
        OPENROUTER_BASE_URL: 'https://custom-proxy.example/v1/chat/completions'
      },
      dash,
      message: 'Summary?',
      history: [],
      fetchImpl: arrayFetch
    });
    expect(capturedUrl).toBe('https://custom-proxy.example/v1/chat/completions');
    expect(JSON.parse(String(capturedInit?.body)).model).toBe('openai/gpt-4o-mini');
    expect(arrayReply).toBe('Line 1\nLine 2');
  });
});

// ---- SvelteKit API Integration Tests ----
function createHarness(
  envOverrides: Record<string, string | undefined> = {},
  source?: ReturnType<typeof createSource>
) {
  const db = openDb(':memory:');
  const rt = createRuntime({ env: { TZ_NAME: 'Asia/Bangkok', ...envOverrides }, db, source });
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

  test('/api/chat uses OpenRouter when OPENROUTER_API_KEY is set and falls back to offline on error', async () => {
    const origFetch = globalThis.fetch;
    const { call, close } = createHarness({
      OPENROUTER_API_KEY: 'sk-or-live-test',
      ANTHROPIC_API_KEY: 'sk-ant-should-not-win'
    });

    try {
      const adm = await call('POST', '/api/auth/setup', { member_id: 'MOCK-66-0001', password: 'adminpass1' });
      expect(adm.status).toBe(200);

      // 1. OpenRouter succeeds -> mode: 'ai'
      let calledUrl = '';
      globalThis.fetch = (async (url: string | URL | Request) => {
        calledUrl = String(url);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'There are 67 members in the club.' } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as unknown as typeof fetch;

      const aiRes = await call('POST', '/api/chat', { message: 'How many members?' }, adm.cookie);
      expect(aiRes.status).toBe(200);
      expect(calledUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(aiRes.body).toEqual({
        reply: 'There are 67 members in the club.',
        mode: 'ai'
      });

      // 2. OpenRouter returns HTTP 500 -> clean fallback to mode: 'offline'
      globalThis.fetch = (async () => {
        return new Response('Upstream error', { status: 500 });
      }) as unknown as typeof fetch;

      const errFallback = await call('POST', '/api/chat', { message: 'What is the budget for AC-002?' }, adm.cookie);
      expect(errFallback.status).toBe(200);
      expect(errFallback.body.mode).toBe('offline');
      expect(errFallback.body.reply).toContain('AC-002');
      expect(errFallback.body.reply).toContain('Open House Engineering 2026');
    } finally {
      globalThis.fetch = origFetch;
      close();
    }
  });
});

// ---- Calendar week & month helpers ----
describe('Calendar week and month helpers', () => {
  const dash = buildDashboard(generateMock('2026-11-16'), '2026-11-16');
  const byDate = buildByDateMap(dash.events);

  test('week range, shifting, and title formatting across month and year boundaries', () => {
    expect(getWeekStart('2026-11-16')).toBe('2026-11-15');
    expect(getWeekStart('2026-11-15')).toBe('2026-11-15');
    expect(getWeekStart('2026-11-21')).toBe('2026-11-15');
    expect(getWeekRange('2026-11-16')).toEqual({ start: '2026-11-15', end: '2026-11-21' });

    expect(getWeekTitle('2026-11-15')).toBe('15 \u2013 21 Nov 2026');
    expect(getWeekTitle('2026-11-29')).toBe('29 Nov \u2013 5 Dec 2026');
    expect(getWeekTitle('2026-12-27')).toBe('27 Dec 2026 \u2013 2 Jan 2027');

    expect(shiftWeekStr('2026-11-15', -1)).toBe('2026-11-08');
    expect(shiftWeekStr('2026-11-15', 1)).toBe('2026-11-22');
    expect(shiftWeekStr('2026-11-29', 1)).toBe('2026-12-06');
  });

  test('buildWeekDays generates 7 Sun-Sat days with today, selected, and event day progress', () => {
    const days = buildWeekDays('2026-11-15', '2026-11-16', '2026-11-20', byDate);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.key)).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21'
    ]);
    expect(days.map((d) => d.dowLabel)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(days[1].today).toBe(true);
    expect(days[0].today).toBe(false);
    expect(days[5].selected).toBe(true);

    // On Fri 2026-11-20, AC-014, AC-015, AC-016, and AC-017 are all active
    const friIds = days[5].evs.map((e) => e.event_id);
    expect(friIds).toEqual(['AC-014', 'AC-015', 'AC-016', 'AC-017']);
    const ac016 = days[5].evs.find((e) => e.event_id === 'AC-016')!;
    expect(ac016.dayNo).toBe(3);
    expect(ac016.dayCount).toBe(3);
  });

  test('buildWeekSpans clips multi-day events across week boundaries and packs non-overlapping lanes', () => {
    const spans = buildWeekSpans('2026-11-15', dash.events);
    expect(spans.map((s) => s.event.event_id)).toEqual(['AC-014', 'AC-015', 'AC-016', 'AC-017']);

    const s14 = spans.find((s) => s.event.event_id === 'AC-014')!;
    expect(s14.startCol).toBe(1);
    expect(s14.spanCols).toBe(7);
    expect(s14.continuesBefore).toBe(true);
    expect(s14.continuesAfter).toBe(true);
    expect(s14.dayRangeText).toBe('Day 28\u201334 of 47');

    const s16 = spans.find((s) => s.event.event_id === 'AC-016')!;
    expect(s16.startCol).toBe(4); // Wed Nov 18
    expect(s16.spanCols).toBe(3); // Wed..Fri
    expect(s16.continuesBefore).toBe(false);
    expect(s16.continuesAfter).toBe(false);
    expect(s16.dayRangeText).toBe('Day 1\u20133 of 3');

    const s17 = spans.find((s) => s.event.event_id === 'AC-017')!;
    expect(s17.startCol).toBe(6); // Fri Nov 20
    expect(s17.spanCols).toBe(2); // Fri..Sat
    expect(s17.lane).not.toBe(s16.lane); // overlaps AC-016 on col 6

    // Single-day event AC-020 (2027-01-30) should appear in day agenda, not multi-day spans
    const janWeekSpans = buildWeekSpans('2027-01-24', dash.events);
    expect(janWeekSpans).toHaveLength(0);
    const janWeekDays = buildWeekDays('2027-01-24', '2026-11-16', null, byDate);
    expect(janWeekDays[6].evs.map((e) => e.event_id)).toEqual(['AC-020']);

    // Non-overlapping multi-day events in the same week share lane 0
    const base = dash.events[0];
    const packed = buildWeekSpans('2026-11-15', [
      { ...base, event_id: 'T1', title: 'Early', date: '2026-11-15', end_date: '2026-11-16' },
      { ...base, event_id: 'T2', title: 'Late', date: '2026-11-19', end_date: '2026-11-21' }
    ]);
    expect(packed[0].lane).toBe(0);
    expect(packed[1].lane).toBe(0);
  });

  test('month title, shifting, and grid generation handle 5-row and 6-row months', () => {
    expect(getMonthTitle('2026-11')).toBe('November 2026');
    expect(shiftMonthStr('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthStr('2026-01', -1)).toBe('2025-12');

    // Nov 2026 starts on Sunday Nov 1 -> 35 cells
    const novCells = buildMonthGrid('2026-11', '2026-11-16', '2026-11-20', byDate);
    expect(novCells).toHaveLength(35);
    expect(novCells[0].key).toBe('2026-11-01');
    expect(novCells[15].today).toBe(true);
    expect(novCells[19].selected).toBe(true);
    expect(novCells[19].evs.map((e) => e.event_id)).toEqual(['AC-014', 'AC-015', 'AC-016', 'AC-017']);
    expect(novCells[30].key).toBe('2026-12-01');
    expect(novCells[30].other).toBe(true);

    // Aug 2026 starts on Saturday Aug 1 -> 42 cells
    const augCells = buildMonthGrid('2026-08', '2026-11-16', null, byDate);
    expect(augCells).toHaveLength(42);
    expect(augCells[0].key).toBe('2026-07-26');
    expect(augCells[0].other).toBe(true);
  });
});

// ---- Database legacy migration ----
describe('Database legacy migration', () => {
  test('openDb safely migrates a legacy users table without the theme column and allows setTheme to succeed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-dash-db-'));
    const dbFile = path.join(tmpDir, 'legacy.db');

    try {
      // Create a legacy database schema missing the `theme` column
      const legacy = new Database(dbFile);
      legacy.exec(`
        CREATE TABLE users (
          member_id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin','user')),
          pw_hash TEXT,
          pw_salt TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          member_id TEXT NOT NULL REFERENCES users(member_id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
      `);
      legacy
        .prepare('INSERT INTO users (member_id, full_name, role, created_at) VALUES (?,?,?,?)')
        .run('MOCK-66-0001', 'Aiden Adams', 'admin', 1700000000000);
      legacy.close();

      // openDb must migrate `users` by adding `theme` without dropping existing rows
      const migrated = openDb(dbFile);
      try {
        const uBefore = migrated.getUser('MOCK-66-0001');
        expect(uBefore).not.toBeNull();
        expect(uBefore?.full_name).toBe('Aiden Adams');
        expect(uBefore?.theme).toBeNull();

        migrated.setTheme('MOCK-66-0001', 'dark');
        expect(migrated.getUser('MOCK-66-0001')?.theme).toBe('dark');
        expect(migrated.listUsers()[0].theme).toBe('dark');

        migrated.setTheme('MOCK-66-0001', 'light');
        expect(migrated.getUser('MOCK-66-0001')?.theme).toBe('light');
      } finally {
        migrated.close();
      }

      // Verify column exists via PRAGMA table_info(users)
      const verify = new Database(dbFile);
      const cols = verify.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
      verify.close();
      expect(cols.some((c) => c.name === 'theme')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---- Idempotent Seeding, Admin Promotion & Cross-Runtime Regression Tests ----
describe('Idempotent seeding, admin promotion, and runtime compatibility', () => {
  test('resolveSampleSheetsDir and generateMock work without Bun-specific import.meta.dir', () => {
    const dir = resolveSampleSheetsDir();
    expect(fs.existsSync(path.join(dir, 'Members.csv'))).toBe(true);
    const mockSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/server/mock.ts'), 'utf8');
    expect(mockSrc).not.toContain('import.meta.dir');
    const data = generateMock('2026-11-16');
    expect(data.Members).toHaveLength(67);
    expect(data.Members[0].member_id).toBe('MOCK-66-0001');
  });

  test('seedFromMembers is idempotent and promotes MOCK-66-0001 to admin even if registered early as user', async () => {
    const db = openDb(':memory:');
    try {
      // Simulate the exact bug state: user clicked Sign up for MOCK-66-0001 with role = 'user' before seeding ran
      db.createUser('MOCK-66-0001', 'Sutthikan Panla', 'user');
      await db.setPassword('MOCK-66-0001', 'existingpass1');
      db.setTheme('MOCK-66-0001', 'dark');
      const token = db.createSession('MOCK-66-0001');

      expect(db.getUser('MOCK-66-0001')?.role).toBe('user');
      expect(db.listUsers()).toHaveLength(1);

      // Now seedFromMembers runs with all 67 members
      db.seedFromMembers(generateMock('2026-11-16').Members);

      const all = db.listUsers();
      expect(all).toHaveLength(67);
      const admin = db.getUser('MOCK-66-0001')!;
      expect(admin.role).toBe('admin');
      expect(admin.full_name).toBe('Sutthikan Panla');
      expect(admin.theme).toBe('dark');
      expect(admin.pw_hash).not.toBeNull();

      // Existing session immediately sees promoted role and password still verifies
      expect(db.getSession(token)?.role).toBe('admin');
      expect((await db.verifyPassword('mock-66-0001', 'existingpass1'))?.role).toBe('admin');

      // Re-running seedFromMembers remains idempotent
      db.seedFromMembers(generateMock('2026-11-16').Members);
      expect(db.listUsers()).toHaveLength(67);
    } finally {
      db.close();
    }
  });

  test('/api/auth/register assigns admin to MOCK-66-0001 when unseeded, and GET /api/me promotes existing session once seeding recovers', async () => {
    let failSeed = true;
    const mockSource = {
      mode: 'mock' as const,
      async getData() {
        if (failSeed) throw new Error('simulated transient failure');
        return { data: generateMock('2026-11-16'), source: 'mock' as const, fetchedAt: Date.now(), stale: false };
      }
    };

    const { call, close } = createHarness({}, mockSource);
    try {
      // 1. Register MOCK-66-0001 via Sign up while seeding is failing (using lowercase + spaces)
      const reg = await call('POST', '/api/auth/register', {
        member_id: '  mock-66-0001  ',
        full_name: 'Sutthikan Panla',
        password: 'adminpass123'
      });
      expect(reg.status).toBe(201);
      expect(reg.body.user.member_id).toBe('MOCK-66-0001');
      expect(reg.body.user.role).toBe('admin');

      // 2. Seeding recovers -> GET /api/me runs ensureSeeded() and seeds remaining 66 members
      failSeed = false;
      const me = await call('GET', '/api/me', undefined, reg.cookie);
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe('admin');

      const usersRes = await call('GET', '/api/admin/users', undefined, reg.cookie);
      expect(usersRes.status).toBe(200);
      expect(usersRes.body.users).toHaveLength(67);

      // 3. Case-insensitive & trimmed setup + login for MOCK-66-0002
      expect(normalizeMemberId('  mock-66-0002 ')).toBe('MOCK-66-0002');
      const setup2 = await call('POST', '/api/auth/setup', {
        member_id: ' mock-66-0002 ',
        password: 'memberpass1'
      });
      expect(setup2.status).toBe(200);
      expect(setup2.body.user.member_id).toBe('MOCK-66-0002');
      expect(setup2.body.user.role).toBe('user');

      const login2 = await call('POST', '/api/auth/login', {
        member_id: 'mock-66-0002',
        password: 'memberpass1'
      });
      expect(login2.status).toBe(200);
      expect(login2.body.user.member_id).toBe('MOCK-66-0002');
    } finally {
      close();
    }
  });
});

