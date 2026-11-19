import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';

import { buildAlerts } from '../src/lib/server/alerts';
import { normalizeDate, daysBetween, addDays } from '../src/lib/server/dates';
import { parseBatchResponse, createSource, extractSheetId } from '../src/lib/server/sheets';
import { createSupabaseClient } from '../src/lib/server/supabase';
import { buildDashboard } from '../src/lib/server/dashboard';
import { generateMock, parseCsv, resolveSampleSheetsDir } from '../src/lib/server/mock';
import { answerOffline, askOpenRouter, buildContext } from '../src/lib/server/chat';
import { normalizeMemberId, openDb } from '../src/lib/server/db';
import { createRuntime, setRuntimeForTesting } from '../src/lib/server/runtime';
import { rank } from '../src/lib/search';
import {
  EVENT_PALETTE,
  buildByDateMap,
  buildMonthGrid,
  buildWeekDays,
  buildWeekSpans,
  formatLocalIso,
  getDayTitle,
  getEventColorIndex,
  getMonthTitle,
  getWeekRange,
  getWeekStart,
  getWeekTitle,
  shiftDayStr,
  shiftMonthStr,
  shiftWeekStr,
  toSvarEvents
} from '../src/lib/calendar';

import { handle } from '../src/hooks.server';
import { load as layoutLoad } from '../src/routes/+layout.server';
import * as healthRoute from '../src/routes/api/health/+server';
import * as setupRoute from '../src/routes/api/auth/setup/+server';
import * as registerRoute from '../src/routes/api/auth/register/+server';
import * as loginRoute from '../src/routes/api/auth/login/+server';
import * as logoutRoute from '../src/routes/api/auth/logout/+server';
import * as authGoogleRoute from '../src/routes/api/auth/google/+server';
import * as meRoute from '../src/routes/api/me/+server';
import * as meThemeRoute from '../src/routes/api/me/theme/+server';
import * as dashRoute from '../src/routes/api/dashboard/+server';
import * as chatRoute from '../src/routes/api/chat/+server';
import * as sheetsConfigRoute from '../src/routes/api/sheets/config/+server';
import * as sheetsDriveRoute from '../src/routes/api/sheets/drive/+server';
import * as sheetsExportCsvRoute from '../src/routes/api/sheets/export-csv/+server';
import * as adminUsersRoute from '../src/routes/api/admin/users/+server';
import * as adminUserIdRoute from '../src/routes/api/admin/users/[id]/+server';
import * as adminUserResetRoute from '../src/routes/api/admin/users/[id]/reset/+server';
import * as adminUserRoleRoute from '../src/routes/api/admin/users/[id]/role/+server';

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
          ['6600000001', 'Aiden Adams', 'Academic Affairs', 'President', 'a@example.com', '1/1/2026', 'ชาย', 'Year 2', 'Mechatronics']
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
          ['A1', 'AC-001', '6600000001', 'Aiden Adams', '2026-11-20 09:00', 'present', 'IT Head', 'Computer Engineering / Year 3', 'Male']
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
    expect(d.Members[0].member_id).toBe('6600000001');
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
    expect(payload.max_tokens).toBe(2048);
    expect(payload.temperature).toBe(0.2);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[0].content).toContain('"spending_by_category"');
    expect(payload.messages[0].content).toContain('"AC-002"');
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'How much did AC-002 spend?' }
    ]);

    // Array-of-parts content & custom model/base URL/max_tokens support
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
        OPENROUTER_BASE_URL: 'https://custom-proxy.example/v1/chat/completions',
        OPENROUTER_MAX_TOKENS: '4096'
      },
      dash,
      message: 'Summary?',
      history: [],
      fetchImpl: arrayFetch
    });
    expect(capturedUrl).toBe('https://custom-proxy.example/v1/chat/completions');
    expect(JSON.parse(String(capturedInit?.body)).model).toBe('openai/gpt-4o-mini');
    expect(JSON.parse(String(capturedInit?.body)).max_tokens).toBe(4096);
    expect(arrayReply).toBe('Line 1\nLine 2');
  });

  test('askOpenRouter handles reasoning model fallback and HTTP 200 error payloads', async () => {
    const dash = buildDashboard(generateMock('2026-11-16'), '2026-11-16');

    const reasoningFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: '',
                reasoning: '  Partial reasoning answer for AC-002.  '
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as unknown as typeof fetch;

    const reasoningReply = await askOpenRouter({
      env: { OPENROUTER_API_KEY: 'sk-or-test-key', OPENROUTER_MODEL: 'z-ai/glm-5.3-flash' },
      dash,
      message: 'Budget summary?',
      history: [],
      fetchImpl: reasoningFetch
    });
    expect(reasoningReply).toBe('Partial reasoning answer for AC-002.');

    const reasoningContentFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: null,
                reasoning_content: 'Reasoning content fallback.'
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as unknown as typeof fetch;

    const reasoningContentReply = await askOpenRouter({
      env: { OPENROUTER_API_KEY: 'sk-or-test-key', OPENROUTER_MODEL: 'z-ai/glm-5.3-flash' },
      dash,
      message: 'Budget summary?',
      history: [],
      fetchImpl: reasoningContentFetch
    });
    expect(reasoningContentReply).toBe('Reasoning content fallback.');

    const error200Fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: 'Upstream provider timed out', code: 504 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as unknown as typeof fetch;

    await expect(
      askOpenRouter({
        env: { OPENROUTER_API_KEY: 'sk-or-test-key' },
        dash,
        message: 'Budget summary?',
        history: [],
        fetchImpl: error200Fetch
      })
    ).rejects.toThrow('Upstream provider timed out');
  });
});

// ---- SvelteKit API Integration Tests ----
function createHarness(
  envOverrides: Record<string, string | undefined> = {},
  source?: NonNullable<Parameters<typeof createRuntime>[0]>['source'],
  supabase?: NonNullable<Parameters<typeof createRuntime>[0]>['supabase']
) {
  const db = openDb(':memory:');
  const rt = createRuntime({ env: { TZ_NAME: 'Asia/Bangkok', ...envOverrides }, db, source, supabase });
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
    { pattern: /^\/api\/auth\/google$/, handlers: authGoogleRoute as never },
    { pattern: /^\/api\/me$/, handlers: meRoute as never },
    { pattern: /^\/api\/me\/theme$/, handlers: meThemeRoute as never },
    { pattern: /^\/api\/dashboard$/, handlers: dashRoute as never },
    { pattern: /^\/api\/chat$/, handlers: chatRoute as never },
    { pattern: /^\/api\/sheets\/config$/, handlers: sheetsConfigRoute as never },
    { pattern: /^\/api\/sheets\/drive$/, handlers: sheetsDriveRoute as never },
    { pattern: /^\/api\/sheets\/export-csv$/, handlers: sheetsExportCsvRoute as never },
    { pattern: /^\/api\/admin\/users$/, handlers: adminUsersRoute as never },
    { pattern: /^\/api\/admin\/users\/([^/]+)$/, handlers: adminUserIdRoute as never, paramNames: ['id'] },
    { pattern: /^\/api\/admin\/users\/([^/]+)\/reset$/, handlers: adminUserResetRoute as never, paramNames: ['id'] },
    { pattern: /^\/api\/admin\/users\/([^/]+)\/role$/, handlers: adminUserRoleRoute as never, paramNames: ['id'] }
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
    const bytes = new Uint8Array(await response.clone().arrayBuffer().catch(() => new ArrayBuffer(0)));
    const sidCookie = setCookieHeaders.find((c) => c.startsWith('sid='))?.split(';')[0] || '';
    const allCookies = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');

    return {
      status: response.status,
      headers: response.headers,
      body: json as Record<string, any>,
      text,
      bytes,
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
      expect((await call('POST', '/api/auth/login', { member_id: '6600000001', password: 'x' })).status).toBe(401);
      expect((await call('POST', '/api/auth/setup', { member_id: 'NOPE99', password: 'LongEnough1' })).status).toBe(400);
      expect((await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'short' })).status).toBe(400);
      const setupNoUpper = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'lowercase1' });
      expect(setupNoUpper.status).toBe(400);
      expect(setupNoUpper.body.error).toContain('uppercase');
      const setupNoDigit = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'NoDigitsHere' });
      expect(setupNoDigit.status).toBe(400);
      expect(setupNoDigit.body.error).toContain('number');

      // GET /api/auth/setup lookup before password setup
      const lookupUnknown = await call('GET', '/api/auth/setup?member_id=NOPE99');
      expect(lookupUnknown.status).toBe(200);
      expect(lookupUnknown.body).toEqual({ found: false, alreadySetup: false });

      const lookupBefore = await call('GET', '/api/auth/setup?member_id=6600000001');
      expect(lookupBefore.status).toBe(200);
      expect(lookupBefore.body.found).toBe(true);
      expect(lookupBefore.body.alreadySetup).toBe(false);
      expect(lookupBefore.body.full_name).toBeTruthy();
      expect(lookupBefore.body.subtitle).toContain('Year');

      // Admin setup on 6600000001
      const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
      expect(adm.status).toBe(200);
      expect(adm.body.user.role).toBe('admin');

      // GET /api/auth/setup after password setup must omit full_name
      const lookupAfter = await call('GET', '/api/auth/setup?member_id=6600000001');
      expect(lookupAfter.status).toBe(200);
      expect(lookupAfter.body).toEqual({ found: true, alreadySetup: true });

      // Cannot re-setup an account that already has a password
      expect((await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'Hijack1234' })).status).toBe(400);

      // Login
      expect((await call('POST', '/api/auth/login', { member_id: '6600000001', password: 'wrongpass1' })).status).toBe(401);
      const login = await call('POST', '/api/auth/login', { member_id: '6600000001', password: 'AdminPass1' });
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

      // Public Sign up (/api/auth/register) enforces 10-digit student ID + password rules
      const regBadAlpha = await call('POST', '/api/auth/register', {
        member_id: 'REG-001',
        full_name: 'Registered Evaluator',
        password: 'Evaluator123'
      });
      expect(regBadAlpha.status).toBe(400);
      expect(regBadAlpha.body.error).toContain('digits only');

      const regBadLen = await call('POST', '/api/auth/register', {
        member_id: '66000001',
        full_name: 'Registered Evaluator',
        password: 'Evaluator123'
      });
      expect(regBadLen.status).toBe(400);
      expect(regBadLen.body.error).toContain('10 digits');
      expect(regBadLen.body.error).toContain('currently 8 digits');

      const regNoUpper = await call('POST', '/api/auth/register', {
        member_id: '6600009001',
        full_name: 'Registered Evaluator',
        password: 'evaluator123'
      });
      expect(regNoUpper.status).toBe(400);
      expect(regNoUpper.body.error).toContain('uppercase');

      const reg = await call('POST', '/api/auth/register', {
        member_id: '6600009001',
        full_name: 'Registered Evaluator',
        password: 'Evaluator123'
      });
      expect(reg.status).toBe(201);
      expect(reg.body.user.role).toBe('user');
      expect((await call('GET', '/api/me', undefined, reg.cookie)).status).toBe(200);
      expect(
        (
          await call('POST', '/api/auth/register', {
            member_id: '6600009001',
            full_name: 'Dup',
            password: 'Evaluator123'
          })
        ).status
      ).toBe(409);

      // Admin creates & manages users
      const created = await call(
        'POST',
        '/api/admin/users',
        { member_id: '6600009999', full_name: 'New Person', role: 'user' },
        login.cookie
      );
      expect(created.status).toBe(201);
      expect(
        (
          await call(
            'POST',
            '/api/admin/users',
            { member_id: '6600009999', full_name: 'Dup', role: 'user' },
            login.cookie
          )
        ).status
      ).toBe(409);
      const adminBadAlpha = await call(
        'POST',
        '/api/admin/users',
        { member_id: 'bad id!', full_name: 'X', role: 'user' },
        login.cookie
      );
      expect(adminBadAlpha.status).toBe(400);
      expect(adminBadAlpha.body.error).toContain('digits only');

      const adminBadLen = await call(
        'POST',
        '/api/admin/users',
        { member_id: '660009999', full_name: 'X', role: 'user' },
        login.cookie
      );
      expect(adminBadLen.status).toBe(400);
      expect(adminBadLen.body.error).toContain('10 digits');
      expect(adminBadLen.body.error).toContain('currently 9 digits');

      // Normal user cannot call admin endpoints
      const u = await call('POST', '/api/auth/setup', { member_id: '6600009999', password: 'UserPass99' });
      expect((await call('GET', '/api/admin/users', undefined, u.cookie)).status).toBe(403);
      expect((await call('DELETE', '/api/admin/users/6600000001', undefined, u.cookie)).status).toBe(403);
      expect(
        (await call('PATCH', '/api/admin/users/6600000001/role', { role: 'user' }, u.cookie)).status
      ).toBe(403);

      // Admin can change roles of other users (promote/demote) and guards invalid/self/unknown cases
      expect(
        (await call('PATCH', '/api/admin/users/6600000001/role', { role: 'user' }, login.cookie)).status
      ).toBe(400);
      expect(
        (await call('PATCH', '/api/admin/users/6600009999/role', { role: 'superadmin' }, login.cookie)).status
      ).toBe(400);
      expect(
        (await call('PATCH', '/api/admin/users/6699999999/role', { role: 'admin' }, login.cookie)).status
      ).toBe(404);

      const promoted = await call(
        'PATCH',
        '/api/admin/users/6600009999/role',
        { role: 'admin' },
        login.cookie
      );
      expect(promoted.status).toBe(200);
      expect(promoted.body.users.find((x: { member_id: string }) => x.member_id === '6600009999')?.role).toBe('admin');
      expect((await call('GET', '/api/me', undefined, u.cookie)).body.user.role).toBe('admin');

      const demoted = await call(
        'PATCH',
        '/api/admin/users/6600009999/role',
        { role: 'user' },
        login.cookie
      );
      expect(demoted.status).toBe(200);
      expect(demoted.body.users.find((x: { member_id: string }) => x.member_id === '6600009999')?.role).toBe('user');
      expect((await call('GET', '/api/me', undefined, u.cookie)).body.user.role).toBe('user');

      // Admin cannot delete self / last admin; can reset and delete others
      expect((await call('DELETE', '/api/admin/users/6600000001', undefined, login.cookie)).status).toBe(400);
      expect((await call('POST', '/api/admin/users/6600009999/reset', {}, login.cookie)).status).toBe(200);
      expect((await call('GET', '/api/me', undefined, u.cookie)).status).toBe(401);
      expect((await call('DELETE', '/api/admin/users/6600009999', undefined, login.cookie)).status).toBe(200);

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

  test('login allows repeated attempts without rate limiting', async () => {
    const { call, close } = createHarness();
    try {
      let last: Awaited<ReturnType<typeof call>> | null = null;
      for (let i = 0; i < 10; i++) {
        last = await call('POST', '/api/auth/login', { member_id: '6600000002', password: 'nope' + i });
      }
      expect(last?.status).toBe(401);
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
      const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
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

  test('EVENT_PALETTE, getEventColorIndex, and day helpers generate consistent colors and labels', () => {
    expect(EVENT_PALETTE).toHaveLength(8);
    expect(EVENT_PALETTE[0].cssClass).toBe('ev-palette-0');
    expect(EVENT_PALETTE[7].cssClass).toBe('ev-palette-7');

    // Numeric suffix mapping cycles cleanly 0..7
    expect(getEventColorIndex('AC-001')).toBe(0);
    expect(getEventColorIndex('AC-002')).toBe(1);
    expect(getEventColorIndex('AC-008')).toBe(7);
    expect(getEventColorIndex('AC-009')).toBe(0);
    expect(getEventColorIndex('AC-016')).toBe(7);

    // Non-numeric IDs use deterministic hash fallback
    const customIdx = getEventColorIndex('CUSTOM-EVENT');
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeLessThan(8);
    expect(getEventColorIndex('CUSTOM-EVENT')).toBe(customIdx);

    // Day shifting & formatting
    expect(shiftDayStr('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDayStr('2026-01-01', -1)).toBe('2025-12-31');
    expect(getDayTitle('2026-11-16')).toBe('Mon, 16 Nov 2026');
  });

  test('toSvarEvents maps multi-day and single-day events with exclusive end dates, allDay spans, and palette CSS', () => {
    const svarEvents = toSvarEvents(dash.events);
    expect(svarEvents).toHaveLength(20);

    // Multi-day event AC-016: 2026-11-18..2026-11-20 (3 days) -> exclusive end 2026-11-21
    const ac16 = svarEvents.find((e) => e.id === 'AC-016')!;
    expect(ac16).toBeDefined();
    expect(ac16.allDay).toBe(true);
    expect(formatLocalIso(ac16.start)).toBe('2026-11-18');
    expect(formatLocalIso(ac16.end)).toBe('2026-11-21');
    expect(ac16.colorIndex).toBe(7);
    expect(ac16.color).toBe(EVENT_PALETTE[7].hex);
    expect(ac16.css).toContain('ev-palette-7');
    expect(ac16.css).toContain('ev-multiday');
    expect(ac16.days).toBe(3);
    expect(ac16.raw.event_id).toBe('AC-016');

    // Single-day event AC-020: 2027-01-30..2027-01-30 (1 day) -> exclusive end 2027-01-31
    const ac20 = svarEvents.find((e) => e.id === 'AC-020')!;
    expect(ac20).toBeDefined();
    expect(ac20.allDay).toBe(true);
    expect(formatLocalIso(ac20.start)).toBe('2027-01-30');
    expect(formatLocalIso(ac20.end)).toBe('2027-01-31');
    expect(ac20.colorIndex).toBe(3);
    expect(ac20.css).toContain('ev-palette-3');
    expect(ac20.css).not.toContain('ev-multiday');
    expect(ac20.days).toBe(1);
    expect(ac20.budget_planned).toBe(ac20.raw.budget_planned);
    expect(ac20.attendee_count).toBe(ac20.raw.attendees);
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
        .run('6600000001', 'Aiden Adams', 'admin', 1700000000000);
      legacy.close();

      // openDb must migrate `users` by adding `theme` without dropping existing rows
      const migrated = openDb(dbFile);
      try {
        const uBefore = migrated.getUser('6600000001');
        expect(uBefore).not.toBeNull();
        expect(uBefore?.full_name).toBe('Aiden Adams');
        expect(uBefore?.theme).toBeNull();

        migrated.setTheme('6600000001', 'dark');
        expect(migrated.getUser('6600000001')?.theme).toBe('dark');
        expect(migrated.listUsers()[0].theme).toBe('dark');

        migrated.setTheme('6600000001', 'light');
        expect(migrated.getUser('6600000001')?.theme).toBe('light');
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
    expect(data.Members[0].member_id).toBe('6600000001');
    expect(data.Members[66].member_id).toBe('6600000067');
  });

  test('seedFromMembers is idempotent and promotes 6600000001 to admin even if registered early as user', async () => {
    const db = openDb(':memory:');
    try {
      // Simulate the exact bug state: user clicked Sign up for 6600000001 with role = 'user' before seeding ran
      db.createUser('6600000001', 'Sutthikan Panla', 'user');
      await db.setPassword('6600000001', 'existingpass1');
      db.setTheme('6600000001', 'dark');
      const token = db.createSession('6600000001');

      expect(db.getUser('6600000001')?.role).toBe('user');
      expect(db.listUsers()).toHaveLength(1);

      // Now seedFromMembers runs with all 67 members
      db.seedFromMembers(generateMock('2026-11-16').Members);

      const all = db.listUsers();
      expect(all).toHaveLength(67);
      const admin = db.getUser('6600000001')!;
      expect(admin.role).toBe('admin');
      expect(admin.full_name).toBe('Sutthikan Panla');
      expect(admin.theme).toBe('dark');
      expect(admin.pw_hash).not.toBeNull();

      // Existing session immediately sees promoted role and password still verifies
      expect(db.getSession(token)?.role).toBe('admin');
      expect((await db.verifyPassword('6600000001', 'existingpass1'))?.role).toBe('admin');

      // Re-running seedFromMembers remains idempotent
      db.seedFromMembers(generateMock('2026-11-16').Members);
      expect(db.listUsers()).toHaveLength(67);
    } finally {
      db.close();
    }
  });

  test('/api/auth/register assigns admin to 6600000001 when unseeded, and GET /api/me promotes existing session once seeding recovers', async () => {
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
      // 1. Register 6600000001 via Sign up while seeding is failing (with whitespace)
      const reg = await call('POST', '/api/auth/register', {
        member_id: '  6600000001  ',
        full_name: 'Sutthikan Panla',
        password: 'AdminPass123'
      });
      expect(reg.status).toBe(201);
      expect(reg.body.user.member_id).toBe('6600000001');
      expect(reg.body.user.role).toBe('admin');

      // 2. Seeding recovers -> GET /api/me runs ensureSeeded() and seeds remaining 66 members
      failSeed = false;
      const me = await call('GET', '/api/me', undefined, reg.cookie);
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe('admin');

      const usersRes = await call('GET', '/api/admin/users', undefined, reg.cookie);
      expect(usersRes.status).toBe(200);
      expect(usersRes.body.users).toHaveLength(67);

      // 3. Trimmed setup + login for 6600000002 (and normalizeMemberId still normalizes legacy mock/st prefixes)
      expect(normalizeMemberId('  mock-66-0002 ')).toBe('MOCK-66-0002');
      expect(normalizeMemberId('  6600000002 ')).toBe('6600000002');
      const setup2 = await call('POST', '/api/auth/setup', {
        member_id: ' 6600000002 ',
        password: 'MemberPass1'
      });
      expect(setup2.status).toBe(200);
      expect(setup2.body.user.member_id).toBe('6600000002');
      expect(setup2.body.user.role).toBe('user');

      const login2 = await call('POST', '/api/auth/login', {
        member_id: '6600000002',
        password: 'MemberPass1'
      });
      expect(login2.status).toBe(200);
      expect(login2.body.user.member_id).toBe('6600000002');
    } finally {
      close();
    }
  });
});

// ---- Google Sheets Dynamic Selector & Keyless gviz CSV Fallback ----
describe('Google Sheets dynamic selector and keyless gviz CSV export', () => {
  test('extractSheetId parses full Google Sheet URLs, raw IDs, and rejects invalid inputs', () => {
    expect(
      extractSheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0')
    ).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    expect(extractSheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
    );
    expect(extractSheetId('short')).toBe('');
    expect(extractSheetId('https://example.com/not-a-sheet')).toBe('');
  });

  test('createSource fetches keyless public gviz CSV tabs and rejects private HTML responses', async () => {
    const csvTabs: Record<string, string> = {
      Members: 'Member_ID,Full_Name,Department,Role\n6600000001,Aiden Adams,Academic Affairs,President\n',
      Events: 'Event_ID,Title,Date,End_Date,Location,Budget_Planned,Status\nEV-01,Workshop,2026-11-20,2026-11-20,Room 101,5000,Scheduled\n',
      Attendance: 'Attendance_ID,Event_ID,Member_ID,Full_Name,Status,Participant_Type\nATT-1,EV-01,6600000001,Aiden Adams,Present,Staff\n',
      Budget: 'Expense_ID,Event_ID,Type,Category,Amount,Date\nTX-1,EV-01,Expense,Food,1200,2026-11-20\n'
    };

    const csvFetch = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.pathname).toContain('/spreadsheets/d/1PubSheet1234567/gviz/tq');
      expect(u.searchParams.get('tqx')).toBe('out:csv');
      expect(u.searchParams.get('headers')).toBe('1');
      const sheet = u.searchParams.get('sheet') || '';
      return new Response(csvTabs[sheet] || '', {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' }
      });
    }) as typeof fetch;

    const src = createSource({
      env: { GOOGLE_SHEET_ID: '1PubSheet1234567', SHEET_CACHE_SECONDS: '30' },
      fetchImpl: csvFetch
    });

    const res = await src.getData();
    expect(res.source).toBe('google');
    expect(res.data.Members).toHaveLength(1);
    expect(res.data.Events[0].title).toBe('Workshop');
    expect(res.data.Budget[0].amount).toBe(1200);

    // Private sheet returning HTML login page fails with helpful message
    const htmlFetch = (async () =>
      new Response('<!doctype html><html><body>Sign in</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })) as unknown as typeof fetch;
    const privateSrc = createSource({ env: {}, fetchImpl: htmlFetch });
    await expect(privateSrc.validateGoogleSheet('1PrivateSheet1234')).rejects.toThrow(/publicly accessible/i);
  });

  test('POST /api/sheets/config switches between google (gviz CSV) and mock modes and persists config', async () => {
    const csvTabs: Record<string, string> = {
      Members: 'Member_ID,Full_Name,Department,Role\n6600000001,Aiden Adams,Academic Affairs,President\n',
      Events: 'Event_ID,Title,Date,End_Date,Location,Budget_Planned,Status\nEV-10,Robotics Talk,2026-11-25,2026-11-25,Hall,8000,Scheduled\n',
      Attendance: 'Attendance_ID,Event_ID,Member_ID,Full_Name,Status,Participant_Type\nATT-10,EV-10,6600000001,Aiden Adams,Present,Staff\n',
      Budget: 'Expense_ID,Event_ID,Type,Category,Amount,Date\nTX-10,EV-10,Expense,Venue,2500,2026-11-25\n'
    };

    const gvizFetch = (async (url: string | URL | Request) => {
      const sheet = new URL(String(url)).searchParams.get('sheet') || '';
      return new Response(csvTabs[sheet] || '', {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' }
      });
    }) as typeof fetch;

    const src = createSource({ env: {}, fetchImpl: gvizFetch });
    const { call, close } = createHarness({}, src);
    try {
      const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
      expect(adm.status).toBe(200);

      const cfg0 = await call('GET', '/api/sheets/config', undefined, adm.cookie);
      expect(cfg0.status).toBe(200);
      expect(cfg0.body.mode).toBe('mock');

      // Switch to Google Sheet URL
      const conn = await call(
        'POST',
        '/api/sheets/config',
        {
          mode: 'google',
          sheetUrlOrId: 'https://docs.google.com/spreadsheets/d/1LiveClubSheet999/edit#gid=0',
          sheetTitle: 'Club Live 2026'
        },
        adm.cookie
      );
      expect(conn.status).toBe(200);
      expect(conn.body.config).toEqual({
        mode: 'google',
        sheetId: '1LiveClubSheet999',
        sheetTitle: 'Club Live 2026'
      });
      expect(conn.body.summary).toEqual({ members: 1, events: 1, attendance: 1, budget: 1 });
      expect(conn.body.recentSheets[0].sheetId).toBe('1LiveClubSheet999');

      // Dashboard now serves Google Sheet data
      const dashGoogle = await call('GET', '/api/dashboard', undefined, adm.cookie);
      expect(dashGoogle.status).toBe(200);
      expect(dashGoogle.body.meta.source).toBe('google');
      expect(dashGoogle.body.meta.sheetId).toBe('1LiveClubSheet999');
      expect(dashGoogle.body.events[0].title).toBe('Robotics Talk');

      // Export CSV endpoint works for canonical tabs
      const csvExp = await call('GET', '/api/sheets/export-csv?tab=Events', undefined, adm.cookie);
      expect(csvExp.status).toBe(200);
      expect(csvExp.headers.get('content-type')).toContain('text/csv');
      expect(csvExp.text).toContain('AC-001');

      // Export XLSX endpoint returns 4-tab Google-Sheet-ready workbook with valid ZIP header (PK\x03\x04)
      for (const query of ['format=xlsx', 'tab=xlsx']) {
        const xlsxExp = await call('GET', `/api/sheets/export-csv?${query}`, undefined, adm.cookie);
        expect(xlsxExp.status).toBe(200);
        expect(xlsxExp.headers.get('content-type')).toBe(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        expect(xlsxExp.headers.get('content-disposition')).toContain('Clubhouse-Google-Sheet-Ready.xlsx');
        expect(xlsxExp.bytes.length).toBeGreaterThan(1000);
        expect(Array.from(xlsxExp.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
      }

      // Drive endpoint returns recentSheets cleanly when no OAuth token is provided
      const driveRes = await call('GET', '/api/sheets/drive', undefined, adm.cookie);
      expect(driveRes.status).toBe(200);
      expect(driveRes.body.hasDriveAccess).toBe(false);
      expect(driveRes.body.recentSheets[0].sheetId).toBe('1LiveClubSheet999');

      // Switch back to built-in Mock-Data
      const back = await call('POST', '/api/sheets/config', { mode: 'mock' }, adm.cookie);
      expect(back.status).toBe(200);
      expect(back.body.config.mode).toBe('mock');
      expect(back.body.summary.members).toBe(67);
    } finally {
      close();
    }
  });
});

// ---- SQLite Settings & Supabase (public-cee-v2) Client ----
describe('SQLite app_settings and Supabase public-cee-v2 client', () => {
  test('db.getSetting and db.setSetting persist and overwrite key-value pairs', () => {
    const db = openDb(':memory:');
    try {
      expect(db.getSetting('sheet_config')).toBeNull();
      db.setSetting('sheet_config', '{"mode":"mock"}', 1000);
      expect(db.getSetting('sheet_config')).toBe('{"mode":"mock"}');
      expect(db.getSettingRow('sheet_config')?.updated_at).toBe(1000);

      db.setSetting('sheet_config', '{"mode":"google","sheetId":"abc"}', 2000);
      expect(db.getSetting('sheet_config')).toBe('{"mode":"google","sheetId":"abc"}');
      expect(db.listSettings()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('createSupabaseClient sends Accept-Profile/Content-Profile: public-cee-v2 headers and falls back gracefully on PGRST106', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const hdrs: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => {
        hdrs[k.toLowerCase()] = v;
      });
      calls.push({ url: String(url), method: init?.method || 'GET', headers: hdrs });
      if ((init?.method || 'GET') === 'GET') {
        return new Response(JSON.stringify([{ member_id: '6600000001' }]), { status: 200 });
      }
      return new Response('', { status: 201 });
    }) as typeof fetch;

    const supa = createSupabaseClient({
      env: {
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_test',
        SUPABASE_SCHEMA: 'public-cee-v2'
      },
      fetchImpl: okFetch
    });

    expect(supa.isEnabled()).toBe(true);
    expect(await supa.probe()).toBe('connected');
    await supa.upsertSetting('sheet_config', '{"mode":"mock"}', 12345);

    expect(calls[0].headers['accept-profile']).toBe('public-cee-v2');
    expect(calls[0].headers['apikey']).toBe('sb_secret_test');
    expect(calls[1].headers['content-profile']).toBe('public-cee-v2');
    expect(calls[1].url).toBe('https://demo.supabase.co/rest/v1/app_settings?on_conflict=key');

    // Graceful fallback when Supabase responds with PGRST106 (schema not exposed yet)
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
      const missingFetch = (async () =>
        new Response(
          JSON.stringify({ code: 'PGRST106', message: 'The schema must be one of the following: public' }),
          { status: 406 }
        )) as unknown as typeof fetch;

      const missingSupa = createSupabaseClient({
        env: {
          SUPABASE_URL: 'https://demo.supabase.co',
          SUPABASE_SECRET_KEY: 'sb_secret_test'
        },
        fetchImpl: missingFetch
      });

      expect(await missingSupa.probe()).toBe('schema_missing');
      expect(missingSupa.getStatus()).toBe('schema_missing');
      expect(warnings.some((w) => w.includes('public-cee-v2'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  function createFakeSupabaseServer(initial?: {
    users?: Array<{
      member_id: string;
      full_name: string;
      role: 'admin' | 'user';
      pw_hash?: string | null;
      pw_salt?: string | null;
      theme?: 'light' | 'dark' | null;
      created_at?: number;
    }>;
    sessions?: Array<{ token_hash: string; member_id: string; created_at: number; expires_at: number }>;
    settings?: Array<{ key: string; value: string; updated_at: number }>;
  }) {
    const users = new Map<
      string,
      {
        member_id: string;
        full_name: string;
        role: 'admin' | 'user';
        pw_hash: string | null;
        pw_salt: string | null;
        theme: 'light' | 'dark' | null;
        created_at: number;
      }
    >();
    const sessions = new Map<
      string,
      { token_hash: string; member_id: string; created_at: number; expires_at: number }
    >();
    const settings = new Map<string, { key: string; value: string; updated_at: number }>();

    for (const u of initial?.users || []) {
      users.set(u.member_id.toLowerCase(), {
        member_id: u.member_id,
        full_name: u.full_name,
        role: u.role,
        pw_hash: u.pw_hash ?? null,
        pw_salt: u.pw_salt ?? null,
        theme: u.theme ?? null,
        created_at: u.created_at ?? Date.now()
      });
    }
    for (const s of initial?.sessions || []) sessions.set(s.token_hash, { ...s });
    for (const s of initial?.settings || []) settings.set(s.key, { ...s });

    let failMode: 'none' | 'schema_missing' | 'unreachable' | 'error_500' = 'none';

    const unescapeIlike = (s: string) =>
      s.replace(/\\\\%/g, '%').replace(/\\\\_/g, '_').replace(/\\\\%|\\\\_|\\\\\\\\/g, (m) => m.slice(-1));

    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (failMode === 'unreachable') throw new TypeError('fetch failed');
      if (failMode === 'schema_missing') {
        return new Response(
          JSON.stringify({ code: 'PGRST106', message: 'The schema must be one of the following: public' }),
          { status: 406 }
        );
      }
      if (failMode === 'error_500') {
        return new Response('Supabase internal error', { status: 500 });
      }

      const method = (init?.method || 'GET').toUpperCase();
      const hdrs = new Headers(init?.headers);
      const prefer = hdrs.get('prefer') || '';
      const u = new URL(String(url));
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      const bodyJson =
        init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

      if (table === 'users') {
        if (method === 'GET') {
          let rows = Array.from(users.values());
          const ilike = u.searchParams.get('member_id');
          if (ilike?.startsWith('ilike.')) {
            const target = unescapeIlike(ilike.slice(6)).toLowerCase();
            rows = rows.filter((r) => r.member_id.toLowerCase() === target);
          } else if (ilike?.startsWith('eq.')) {
            const target = ilike.slice(3);
            rows = rows.filter((r) => r.member_id === target);
          }
          const roleEq = u.searchParams.get('role');
          if (roleEq?.startsWith('eq.')) {
            const target = roleEq.slice(3);
            rows = rows.filter((r) => r.role === target);
          }
          const order = u.searchParams.get('order') || '';
          if (order.includes('role.asc')) {
            rows.sort((a, b) => a.role.localeCompare(b.role) || a.member_id.localeCompare(b.member_id));
          } else if (order.includes('created_at.asc')) {
            rows.sort((a, b) => a.created_at - b.created_at || a.member_id.localeCompare(b.member_id));
          }
          const limit = Number(u.searchParams.get('limit') || 0);
          if (limit > 0) rows = rows.slice(0, limit);
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const items = (Array.isArray(bodyJson) ? bodyJson : [bodyJson]) as Array<Record<string, unknown>>;
          const ignoreDup = prefer.includes('ignore-duplicates');
          const mergeDup = prefer.includes('merge-duplicates');
          for (const item of items) {
            const id = String(item.member_id || '');
            const key = id.toLowerCase();
            const existing = users.get(key);
            if (existing) {
              if (ignoreDup) continue;
              if (!mergeDup && !u.searchParams.has('on_conflict')) {
                return new Response(JSON.stringify({ code: '23505', message: 'duplicate' }), { status: 409 });
              }
              users.set(key, {
                member_id: id,
                full_name: String(item.full_name ?? existing.full_name),
                role: (item.role === 'admin' ? 'admin' : 'user'),
                pw_hash: item.pw_hash !== undefined ? (item.pw_hash as string | null) : existing.pw_hash,
                pw_salt: item.pw_salt !== undefined ? (item.pw_salt as string | null) : existing.pw_salt,
                theme:
                  item.theme !== undefined
                    ? (item.theme as 'light' | 'dark' | null)
                    : existing.theme,
                created_at: Number(item.created_at) || existing.created_at
              });
            } else {
              users.set(key, {
                member_id: id,
                full_name: String(item.full_name || ''),
                role: item.role === 'admin' ? 'admin' : 'user',
                pw_hash: (item.pw_hash as string | null) ?? null,
                pw_salt: (item.pw_salt as string | null) ?? null,
                theme: (item.theme as 'light' | 'dark' | null) ?? null,
                created_at: Number(item.created_at) || Date.now()
              });
            }
          }
          return new Response('', { status: 201 });
        }
        if (method === 'PATCH') {
          const eq = u.searchParams.get('member_id');
          const patch = (bodyJson || {}) as Record<string, unknown>;
          if (eq?.startsWith('eq.')) {
            const target = eq.slice(3);
            const cur = users.get(target.toLowerCase());
            if (cur && cur.member_id === target) {
              users.set(target.toLowerCase(), {
                ...cur,
                ...(patch.role !== undefined ? { role: patch.role as 'admin' | 'user' } : {}),
                ...(patch.pw_hash !== undefined ? { pw_hash: patch.pw_hash as string | null } : {}),
                ...(patch.pw_salt !== undefined ? { pw_salt: patch.pw_salt as string | null } : {}),
                ...(patch.theme !== undefined ? { theme: patch.theme as 'light' | 'dark' | null } : {})
              });
            }
          }
          return new Response('', { status: 204 });
        }
        if (method === 'DELETE') {
          const eq = u.searchParams.get('member_id');
          if (eq?.startsWith('eq.')) {
            const target = eq.slice(3);
            users.delete(target.toLowerCase());
            for (const [th, s] of sessions) {
              if (s.member_id === target) sessions.delete(th);
            }
          }
          return new Response('', { status: 204 });
        }
      }

      if (table === 'sessions') {
        if (method === 'GET') {
          let rows = Array.from(sessions.values());
          const thEq = u.searchParams.get('token_hash');
          if (thEq?.startsWith('eq.')) {
            const target = thEq.slice(3);
            rows = rows.filter((r) => r.token_hash === target);
          }
          const expGt = u.searchParams.get('expires_at');
          if (expGt?.startsWith('gt.')) {
            const cutoff = Number(expGt.slice(3));
            rows = rows.filter((r) => r.expires_at > cutoff);
          }
          const limit = Number(u.searchParams.get('limit') || 0);
          if (limit > 0) rows = rows.slice(0, limit);
          const select = u.searchParams.get('select') || '';
          const payload = rows.map((r) => {
            if (!select.includes('users(')) return r;
            const usr = users.get(r.member_id.toLowerCase());
            return {
              ...r,
              users: usr
                ? {
                    member_id: usr.member_id,
                    full_name: usr.full_name,
                    role: usr.role,
                    theme: usr.theme
                  }
                : null
            };
          });
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        if (method === 'POST') {
          const item = bodyJson as {
            token_hash: string;
            member_id: string;
            created_at: number;
            expires_at: number;
          };
          sessions.set(item.token_hash, { ...item });
          return new Response('', { status: 201 });
        }
        if (method === 'PATCH') {
          const memEq = u.searchParams.get('member_id');
          const patch = bodyJson as { member_id?: string };
          if (memEq?.startsWith('eq.') && patch.member_id) {
            const fromId = memEq.slice(3);
            for (const s of sessions.values()) {
              if (s.member_id === fromId) s.member_id = patch.member_id;
            }
          }
          return new Response('', { status: 204 });
        }
        if (method === 'DELETE') {
          const thEq = u.searchParams.get('token_hash');
          const memEq = u.searchParams.get('member_id');
          if (thEq?.startsWith('eq.')) {
            sessions.delete(thEq.slice(3));
          } else if (memEq?.startsWith('eq.')) {
            const target = memEq.slice(3);
            for (const [th, s] of sessions) {
              if (s.member_id === target) sessions.delete(th);
            }
          }
          return new Response('', { status: 204 });
        }
      }

      if (table === 'app_settings') {
        if (method === 'GET') {
          let rows = Array.from(settings.values());
          const keyEq = u.searchParams.get('key');
          if (keyEq?.startsWith('eq.')) {
            const target = keyEq.slice(3);
            rows = rows.filter((r) => r.key === target);
          }
          const limit = Number(u.searchParams.get('limit') || 0);
          if (limit > 0) rows = rows.slice(0, limit);
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const item = bodyJson as { key: string; value: string; updated_at: number };
          settings.set(item.key, {
            key: item.key,
            value: item.value,
            updated_at: Number(item.updated_at) || Date.now()
          });
          return new Response('', { status: 201 });
        }
        if (method === 'DELETE') {
          const keyEq = u.searchParams.get('key');
          if (keyEq?.startsWith('eq.')) settings.delete(keyEq.slice(3));
          return new Response('', { status: 204 });
        }
      }

      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const client = createSupabaseClient({
      env: {
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_test',
        SUPABASE_SCHEMA: 'public-cee-v2'
      },
      fetchImpl
    });

    return {
      client,
      users,
      sessions,
      settings,
      setFailMode(mode: 'none' | 'schema_missing' | 'unreachable' | 'error_500') {
        failMode = mode;
      }
    };
  }

  test('runtime uses Supabase exclusively when available and never touches local SQLite', async () => {
    const fakeSupa = createFakeSupabaseServer();
    const { call, close, db } = (() => {
      const localDb = openDb(':memory:');
      const h = createHarness({}, undefined, fakeSupa.client);
      return { ...h, db: localDb };
    })();

    try {
      const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
      expect(adm.status).toBe(200);
      expect(fakeSupa.users.has('6600000001')).toBe(true);
      expect(fakeSupa.users.size).toBe(67);
      // Local SQLite remained untouched
      expect(db.listUsers()).toHaveLength(0);

      const dash = await call('GET', '/api/dashboard', undefined, adm.cookie);
      expect(dash.status).toBe(200);
      expect(dash.body.meta.dbBackend).toBe('supabase');
      expect(dash.body.meta.supabaseStatus).toBe('connected');

      await call('POST', '/api/sheets/config', { mode: 'mock' }, adm.cookie);
      expect(fakeSupa.settings.has('sheet_config')).toBe(true);
    } finally {
      db.close();
      close();
    }
  });

  test('strict when selected: mid-request Supabase failure returns 503 instead of failing over to SQLite', async () => {
    const fakeSupa = createFakeSupabaseServer();
    const { call, close } = createHarness({}, undefined, fakeSupa.client);
    const origWarn = console.warn;
    console.warn = () => {};

    try {
      const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
      expect(adm.status).toBe(200);

      const okDash = await call('GET', '/api/dashboard', undefined, adm.cookie);
      expect(okDash.status).toBe(200);
      expect(okDash.body.meta.dbBackend).toBe('supabase');

      // Simulate Supabase outage mid-flight
      fakeSupa.setFailMode('error_500');

      const failedMe = await call('GET', '/api/me', undefined, adm.cookie);
      expect(failedMe.status).toBe(503);
      expect(failedMe.headers.get('x-content-type-options')).toBe('nosniff');

      const failedLogin = await call('POST', '/api/auth/login', {
        member_id: '6600000001',
        password: 'AdminPass1'
      });
      expect(failedLogin.status).toBe(503);

      // Recovery restores requests without ever falling back to SQLite
      fakeSupa.setFailMode('none');
      const recoveredMe = await call('GET', '/api/me', undefined, adm.cookie);
      expect(recoveredMe.status).toBe(200);
      expect(recoveredMe.body.user.member_id).toBe('6600000001');
    } finally {
      console.warn = origWarn;
      close();
    }
  });

  test('falls back cleanly to local SQLite when Supabase is schema_missing or unreachable at startup', async () => {
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      for (const mode of ['schema_missing', 'unreachable'] as const) {
        const fakeSupa = createFakeSupabaseServer();
        fakeSupa.setFailMode(mode);
        const { call, close } = createHarness({}, undefined, fakeSupa.client);
        try {
          const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
          expect(adm.status).toBe(200);

          const dash = await call('GET', '/api/dashboard', undefined, adm.cookie);
          expect(dash.status).toBe(200);
          expect(dash.body.meta.dbBackend).toBe('sqlite');
          expect(dash.body.meta.supabaseStatus).toBe(mode);
          expect(fakeSupa.users.size).toBe(0);
        } finally {
          close();
        }
      }
    } finally {
      console.warn = origWarn;
    }
  });
});

// ---- Supabase Google OAuth & Authenticated Drive / Sheets ----
describe('Supabase Google OAuth & authenticated Drive / Sheets', () => {
  function createFakeOAuthSupa() {
    const users = new Map<
      string,
      {
        member_id: string;
        full_name: string;
        role: 'admin' | 'user';
        pw_hash: string | null;
        pw_salt: string | null;
        theme: 'light' | 'dark' | null;
        created_at: number;
      }
    >();
    const sessions = new Map<
      string,
      { token_hash: string; member_id: string; created_at: number; expires_at: number }
    >();
    const savedSettings = new Map<string, string>();
    const settingUpdatedAt = new Map<string, number>();

    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      const hdrs = new Headers(init?.headers);
      const prefer = hdrs.get('prefer') || '';
      const u = new URL(String(url));
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      const bodyJson =
        init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

      if (table === 'users') {
        if (method === 'GET') {
          let rows = Array.from(users.values());
          const ilike = u.searchParams.get('member_id');
          if (ilike?.startsWith('ilike.')) {
            const target = ilike.slice(6).replace(/\\\\%/g, '%').replace(/\\\\_/g, '_').replace(/\\\\\\\\/g, '\\').toLowerCase();
            rows = rows.filter((r) => r.member_id.toLowerCase() === target);
          } else if (ilike?.startsWith('eq.')) {
            const target = ilike.slice(3);
            rows = rows.filter((r) => r.member_id === target);
          }
          const roleEq = u.searchParams.get('role');
          if (roleEq?.startsWith('eq.')) rows = rows.filter((r) => r.role === roleEq.slice(3));
          const limit = Number(u.searchParams.get('limit') || 0);
          if (limit > 0) rows = rows.slice(0, limit);
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const items = (Array.isArray(bodyJson) ? bodyJson : [bodyJson]) as Array<Record<string, unknown>>;
          const ignoreDup = prefer.includes('ignore-duplicates');
          for (const item of items) {
            const id = String(item.member_id || '');
            const existing = users.get(id.toLowerCase());
            if (existing && ignoreDup) continue;
            users.set(id.toLowerCase(), {
              member_id: id,
              full_name: String(item.full_name ?? existing?.full_name ?? ''),
              role: item.role === 'admin' ? 'admin' : 'user',
              pw_hash: item.pw_hash !== undefined ? (item.pw_hash as string | null) : (existing?.pw_hash ?? null),
              pw_salt: item.pw_salt !== undefined ? (item.pw_salt as string | null) : (existing?.pw_salt ?? null),
              theme: item.theme !== undefined ? (item.theme as 'light' | 'dark' | null) : (existing?.theme ?? null),
              created_at: Number(item.created_at) || existing?.created_at || Date.now()
            });
          }
          return new Response('', { status: 201 });
        }
        if (method === 'PATCH') {
          const target = u.searchParams.get('member_id')?.slice(3) || '';
          const patch = (bodyJson || {}) as Record<string, unknown>;
          const cur = users.get(target.toLowerCase());
          if (cur) {
            users.set(target.toLowerCase(), {
              ...cur,
              ...(patch.role !== undefined ? { role: patch.role as 'admin' | 'user' } : {}),
              ...(patch.pw_hash !== undefined ? { pw_hash: patch.pw_hash as string | null } : {}),
              ...(patch.pw_salt !== undefined ? { pw_salt: patch.pw_salt as string | null } : {}),
              ...(patch.theme !== undefined ? { theme: patch.theme as 'light' | 'dark' | null } : {})
            });
          }
          return new Response('', { status: 204 });
        }
        if (method === 'DELETE') {
          const target = u.searchParams.get('member_id')?.slice(3) || '';
          users.delete(target.toLowerCase());
          return new Response('', { status: 204 });
        }
      }

      if (table === 'sessions') {
        if (method === 'GET') {
          let rows = Array.from(sessions.values());
          const thEq = u.searchParams.get('token_hash');
          if (thEq?.startsWith('eq.')) rows = rows.filter((r) => r.token_hash === thEq.slice(3));
          const expGt = u.searchParams.get('expires_at');
          if (expGt?.startsWith('gt.')) rows = rows.filter((r) => r.expires_at > Number(expGt.slice(3)));
          const payload = rows.map((r) => {
            const usr = users.get(r.member_id.toLowerCase());
            return { ...r, users: usr || null };
          });
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        if (method === 'POST') {
          const item = bodyJson as { token_hash: string; member_id: string; created_at: number; expires_at: number };
          sessions.set(item.token_hash, { ...item });
          return new Response('', { status: 201 });
        }
        if (method === 'PATCH') {
          const fromId = u.searchParams.get('member_id')?.slice(3) || '';
          const toId = (bodyJson as { member_id: string }).member_id;
          for (const s of sessions.values()) if (s.member_id === fromId) s.member_id = toId;
          return new Response('', { status: 204 });
        }
        if (method === 'DELETE') {
          const thEq = u.searchParams.get('token_hash');
          const memEq = u.searchParams.get('member_id');
          if (thEq?.startsWith('eq.')) sessions.delete(thEq.slice(3));
          if (memEq?.startsWith('eq.')) {
            const target = memEq.slice(3);
            for (const [th, s] of sessions) if (s.member_id === target) sessions.delete(th);
          }
          return new Response('', { status: 204 });
        }
      }

      if (table === 'app_settings') {
        if (method === 'GET') {
          const keyEq = u.searchParams.get('key');
          let keys = Array.from(savedSettings.keys());
          if (keyEq?.startsWith('eq.')) keys = keys.filter((k) => k === keyEq.slice(3));
          const rows = keys.map((k) => ({
            key: k,
            value: savedSettings.get(k) || '',
            updated_at: settingUpdatedAt.get(k) || 0
          }));
          return new Response(JSON.stringify(rows), { status: 200 });
        }
        if (method === 'POST') {
          const item = bodyJson as { key: string; value: string; updated_at: number };
          savedSettings.set(item.key, item.value);
          settingUpdatedAt.set(item.key, Number(item.updated_at) || Date.now());
          return new Response('', { status: 201 });
        }
        if (method === 'DELETE') {
          const keyEq = u.searchParams.get('key');
          if (keyEq?.startsWith('eq.')) {
            savedSettings.delete(keyEq.slice(3));
            settingUpdatedAt.delete(keyEq.slice(3));
          }
          return new Response('', { status: 204 });
        }
      }

      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    return {
      client: createSupabaseClient({
        env: {
          SUPABASE_URL: 'https://demo.supabase.co',
          SUPABASE_SECRET_KEY: 'sb_secret_test',
          SUPABASE_SCHEMA: 'public-cee-v2'
        },
        fetchImpl
      }),
      savedSettings
    };
  }

  test('GET /api/auth/google returns Supabase authorize URL with Google provider and Drive/Sheets scopes', async () => {
    const noSupa = createHarness({});
    try {
      const missing = await noSupa.call('GET', '/api/auth/google?json=1');
      expect(missing.status).toBe(400);
    } finally {
      noSupa.close();
    }

    const { call, close } = createHarness({
      SUPABASE_URL: 'https://demo.supabase.co'
    });
    try {
      const res = await call('GET', '/api/auth/google?intent=drive&json=1');
      expect(res.status).toBe(200);
      const authUrl = new URL(res.body.url);
      expect(authUrl.origin).toBe('https://demo.supabase.co');
      expect(authUrl.pathname).toBe('/auth/v1/authorize');
      expect(authUrl.searchParams.get('provider')).toBe('google');
      expect(authUrl.searchParams.get('redirect_to')).toBe('http://localhost/auth/callback?intent=drive');
      expect(authUrl.searchParams.get('scopes')).toContain('https://www.googleapis.com/auth/drive.readonly');
      expect(authUrl.searchParams.get('scopes')).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
      expect(authUrl.searchParams.get('access_type')).toBe('offline');
      expect(authUrl.searchParams.get('prompt')).toBe('consent');

      const redir = await call('GET', '/api/auth/google?intent=login');
      expect(redir.status).toBe(302);
      expect(redir.headers.get('location')).toContain('https://demo.supabase.co/auth/v1/authorize');

      const linkUrl = await call('GET', '/api/auth/google?intent=link&json=1');
      expect(linkUrl.status).toBe(200);
      expect(new URL(linkUrl.body.url).searchParams.get('redirect_to')).toBe(
        'http://localhost/auth/callback?intent=link'
      );
    } finally {
      close();
    }
  });

  test('Google sign-in hooks only to linked accounts, supports link/unlink, enforces admin-only sheets, and surfaces Drive 403 activationUrl', async () => {
    const origFetch = globalThis.fetch;
    const { client: mockSupa, savedSettings } = createFakeOAuthSupa();

    let driveStatus = 200;
    let capturedDriveAuth = '';
    let activeGoogleEmail = 'club.lead@example.com';
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const hdrs = new Headers(init?.headers);
      if (u === 'https://demo.supabase.co/auth/v1/user') {
        if (hdrs.get('authorization') === 'Bearer bad-supa-token') {
          return new Response(JSON.stringify({ msg: 'invalid token' }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            id: 'a1b2c3d4-0000-0000-0000-000000000000',
            email: activeGoogleEmail,
            user_metadata: { full_name: 'Club Lead' }
          }),
          { status: 200 }
        );
      }
      if (u.startsWith('https://www.googleapis.com/drive/v3/files')) {
        capturedDriveAuth = hdrs.get('authorization') || '';
        if (driveStatus === 401) {
          return new Response('Unauthorized', { status: 401 });
        }
        if (driveStatus === 403) {
          return new Response(
            JSON.stringify({
              error: {
                code: 403,
                message:
                  'Google Drive API has not been used in project 802882631291 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=802882631291 then retry.',
                errors: [
                  {
                    reason: 'accessNotConfigured',
                    extendedHelp:
                      'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=802882631291'
                  }
                ],
                details: [
                  {
                    '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                    reason: 'SERVICE_DISABLED',
                    metadata: {
                      activationUrl:
                        'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=802882631291'
                    }
                  }
                ]
              }
            }),
            { status: 403 }
          );
        }
        return new Response(
          JSON.stringify({
            files: [{ id: '1PrivSheetABC123', name: 'Private Club Sheet 2026', modifiedTime: '2026-11-16T10:00:00Z' }]
          }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch;

    const { call, close } = createHarness(
      {
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_pub_test'
      },
      undefined,
      mockSupa
    );

    try {
      // 1. Invalid Supabase token returns 401
      const bad = await call('POST', '/api/auth/google', { access_token: 'bad-supa-token' });
      expect(bad.status).toBe(401);

      // 2. Unlinked Google login returns 403 and NEVER creates a GOOGLE-XXXXXX user
      const unlinkedRes = await call('POST', '/api/auth/google', {
        access_token: 'valid-supa-token',
        provider_token: 'goog-provider-tok-unlinked',
        intent: 'login'
      });
      expect(unlinkedRes.status).toBe(403);
      expect(unlinkedRes.body.error).toContain('No club account is linked to club.lead@example.com');
      expect(savedSettings.has('google_provider_token')).toBe(false);

      // 3. Admin (6600000001) sets up password -> linkedGoogleEmail starts null
      const adm = await call('POST', '/api/auth/setup', { member_id: '6600000001', password: 'AdminPass1' });
      expect(adm.status).toBe(200);
      expect(adm.body.user.linkedGoogleEmail).toBeNull();

      // Verify no GOOGLE-* user was provisioned
      const userList = await call('GET', '/api/admin/users', undefined, adm.cookie);
      expect(
        (userList.body.users as Array<{ member_id: string }>).some((u) => u.member_id.startsWith('GOOGLE-'))
      ).toBe(false);

      // 4. Signed-in admin links Google account (POST /api/auth/google while authenticated)
      const linkAdm = await call(
        'POST',
        '/api/auth/google',
        {
          access_token: 'valid-supa-token',
          provider_token: 'goog-provider-tok-1',
          intent: 'link'
        },
        adm.cookie
      );
      expect(linkAdm.status).toBe(200);
      expect(linkAdm.body.user.member_id).toBe('6600000001');
      expect(linkAdm.body.user.linkedGoogleEmail).toBe('club.lead@example.com');
      expect(linkAdm.body.hasDriveAccess).toBe(true);
      expect(savedSettings.get('google_user_map:club.lead@example.com')).toBe('6600000001');
      expect(savedSettings.get('user_google_email:6600000001')).toBe('club.lead@example.com');
      expect(savedSettings.get('google_provider_token')).toBe('goog-provider-tok-1');
      expect(savedSettings.get('google_connected_email')).toBe('club.lead@example.com');

      const meLinked = await call('GET', '/api/me', undefined, adm.cookie);
      expect(meLinked.body.user.linkedGoogleEmail).toBe('club.lead@example.com');

      // 5. Subsequent unauthenticated Google Sign-In resolves to 6600000001 (not GOOGLE-XXXXXX)
      const googleLogin = await call('POST', '/api/auth/google', {
        access_token: 'valid-supa-token',
        provider_token: 'goog-provider-tok-2',
        intent: 'login'
      });
      expect(googleLogin.status).toBe(200);
      expect(googleLogin.body.user.member_id).toBe('6600000001');
      expect(googleLogin.body.user.role).toBe('admin');
      expect(googleLogin.body.user.linkedGoogleEmail).toBe('club.lead@example.com');
      expect(googleLogin.cookie).toContain('sid=');
      expect(savedSettings.get('google_provider_token')).toBe('goog-provider-tok-2');

      // 6. Normal user (6600000002) links their own Google account, does NOT overwrite Drive token,
      //    and receives 403 on POST /api/sheets/config and GET /api/sheets/drive
      const normalUser = await call('POST', '/api/auth/setup', {
        member_id: '6600000002',
        password: 'MemberPass1'
      });
      expect(normalUser.status).toBe(200);
      expect(normalUser.body.user.role).toBe('user');

      activeGoogleEmail = 'member.two@example.com';
      const linkMember = await call(
        'POST',
        '/api/auth/google',
        {
          access_token: 'valid-supa-token',
          provider_token: 'member-token-should-not-overwrite-drive',
          intent: 'link'
        },
        normalUser.cookie
      );
      expect(linkMember.status).toBe(200);
      expect(linkMember.body.user.member_id).toBe('6600000002');
      expect(linkMember.body.user.linkedGoogleEmail).toBe('member.two@example.com');
      expect(linkMember.body.hasDriveAccess).toBe(false);
      // Admin's global Drive token was NOT overwritten by normal user
      expect(savedSettings.get('google_provider_token')).toBe('goog-provider-tok-2');

      const nonAdminConfig = await call(
        'POST',
        '/api/sheets/config',
        { mode: 'mock' },
        normalUser.cookie
      );
      expect(nonAdminConfig.status).toBe(403);
      expect(nonAdminConfig.body.error).toContain('Only admins');

      const nonAdminDrive = await call('GET', '/api/sheets/drive', undefined, normalUser.cookie);
      expect(nonAdminDrive.status).toBe(403);
      expect(nonAdminDrive.body.error).toContain('Only admins');

      // Unauthenticated Google login as member.two@example.com signs in as 6600000002
      const memberGoogleLogin = await call('POST', '/api/auth/google', {
        access_token: 'valid-supa-token',
        intent: 'login'
      });
      expect(memberGoogleLogin.status).toBe(200);
      expect(memberGoogleLogin.body.user.member_id).toBe('6600000002');
      expect(memberGoogleLogin.body.user.role).toBe('user');

      // DELETE /api/auth/google unlinks member.two@example.com -> subsequent Google login returns 403
      const unlinkMember = await call('DELETE', '/api/auth/google', undefined, normalUser.cookie);
      expect(unlinkMember.status).toBe(200);
      expect(unlinkMember.body.user.linkedGoogleEmail).toBeNull();
      expect(savedSettings.has('google_user_map:member.two@example.com')).toBe(false);
      expect(savedSettings.has('user_google_email:6600000002')).toBe(false);

      const afterUnlink = await call('POST', '/api/auth/google', {
        access_token: 'valid-supa-token',
        intent: 'login'
      });
      expect(afterUnlink.status).toBe(403);

      // 7. Admin succeeds on /api/sheets/config and /api/sheets/drive
      const adminConfigOk = await call('POST', '/api/sheets/config', { mode: 'mock' }, googleLogin.cookie);
      expect(adminConfigOk.status).toBe(200);

      const cfg = await call('GET', '/api/sheets/config', undefined, googleLogin.cookie);
      expect(cfg.status).toBe(200);
      expect(cfg.body.supabaseOAuthAvailable).toBe(true);
      expect(cfg.body.hasDriveToken).toBe(true);
      expect(cfg.body.googleEmail).toBe('club.lead@example.com');

      const driveOk = await call('GET', '/api/sheets/drive', undefined, googleLogin.cookie);
      expect(driveOk.status).toBe(200);
      expect(capturedDriveAuth).toBe('Bearer goog-provider-tok-2');
      expect(driveOk.body.hasDriveAccess).toBe(true);
      expect(driveOk.body.files).toHaveLength(1);
      expect(driveOk.body.files[0].id).toBe('1PrivSheetABC123');

      // 8. Drive API 403 SERVICE_DISABLED surfaces Google message + activationUrl
      driveStatus = 403;
      const driveDisabled = await call('GET', '/api/sheets/drive', undefined, googleLogin.cookie);
      expect(driveDisabled.status).toBe(403);
      expect(driveDisabled.body.code).toBe('SERVICE_DISABLED');
      expect(driveDisabled.body.error).toContain('Google Drive API has not been used in project 802882631291');
      expect(driveDisabled.body.activationUrl).toBe(
        'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=802882631291'
      );

      // 9. Expired stored token on /api/sheets/drive clears google_provider_token and reports tokenExpired: true
      driveStatus = 401;
      const expired = await call('GET', '/api/sheets/drive', undefined, googleLogin.cookie);
      expect(expired.status).toBe(200);
      expect(expired.body.hasDriveAccess).toBe(false);
      expect(expired.body.tokenExpired).toBe(true);
      expect(savedSettings.get('google_provider_token')).toBe('');

      // 10. createSource uses Bearer OAuth token from getAccessToken() without appending ?key=
      let sheetUrl = '';
      let sheetAuth = '';
      const oauthSheetFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        sheetUrl = String(url);
        sheetAuth = new Headers(init?.headers).get('authorization') || '';
        return new Response(
          JSON.stringify({
            valueRanges: [
              {
                range: 'Members!A1:D2',
                values: [
                  ['member_id', 'full_name', 'department', 'role'],
                  ['6600000001', 'Aiden Adams', 'Academic', 'President']
                ]
              },
              {
                range: 'Events!A1:G2',
                values: [
                  ['event_id', 'title', 'date', 'end_date', 'location', 'budget_planned', 'status'],
                  ['EV-01', 'Private Drive Sheet Event', '2026-11-20', '2026-11-20', 'Hall', '5000', 'Scheduled']
                ]
              },
              {
                range: 'Attendance!A1:F2',
                values: [
                  ['attendance_id', 'event_id', 'member_id', 'full_name', 'status', 'participant_type'],
                  ['ATT-1', 'EV-01', '6600000001', 'Aiden Adams', 'Present', 'Staff']
                ]
              },
              {
                range: 'Budget!A1:F2',
                values: [
                  ['expense_id', 'event_id', 'type', 'category', 'amount', 'date'],
                  ['TX-1', 'EV-01', 'Expense', 'Food', '800', '2026-11-20']
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }) as unknown as typeof fetch;

      const src = createSource({
        env: { GOOGLE_API_KEY: 'api-key-should-be-skipped', GOOGLE_SHEET_ID: '1PrivSheetABC123' },
        fetchImpl: oauthSheetFetch,
        getAccessToken: () => 'goog-provider-tok-2'
      });
      const sheetRes = await src.getData();
      expect(sheetAuth).toBe('Bearer goog-provider-tok-2');
      expect(sheetUrl).not.toContain('key=');
      expect(sheetRes.source).toBe('google');
      expect(sheetRes.data.Events[0].title).toBe('Private Drive Sheet Event');
    } finally {
      globalThis.fetch = origFetch;
      close();
    }
  });

  test('ensureSeeded idempotently migrates legacy MOCK-66-0001..0067 rows, sessions, and Google links to 6600000001..6600000067 on active store', async () => {
    // 1. SQLite fallback store migration
    const db = openDb(':memory:');
    db.createUser('MOCK-66-0001', 'Sutthikan Panla', 'admin');
    await db.setPassword('MOCK-66-0001', 'adminpass1');
    db.setTheme('MOCK-66-0001', 'light');
    const sessToken = db.createSession('MOCK-66-0001');
    db.setSetting('google_user_map:sutigran2557@gmail.com', 'MOCK-66-0001', 1000);
    db.setSetting('user_google_email:MOCK-66-0001', 'sutigran2557@gmail.com', 1000);

    const rtSqlite = createRuntime({ db });
    try {
      await rtSqlite.ensureSeeded();

      expect(db.getUser('MOCK-66-0001')).toBeNull();
      const admin = db.getUser('6600000001');
      expect(admin).not.toBeNull();
      expect(admin?.full_name).toBe('Sutthikan Panla');
      expect(admin?.role).toBe('admin');
      expect(admin?.theme).toBe('light');
      expect(await db.verifyPassword('6600000001', 'adminpass1')).not.toBeNull();

      const sess = db.getSession(sessToken);
      expect(sess?.member_id).toBe('6600000001');
      expect(sess?.linkedGoogleEmail).toBe('sutigran2557@gmail.com');

      expect(db.getSetting('google_user_map:sutigran2557@gmail.com')).toBe('6600000001');
      expect(db.getSetting('user_google_email:6600000001')).toBe('sutigran2557@gmail.com');
      expect(db.getSetting('user_google_email:MOCK-66-0001')).toBeNull();
      expect(db.listUsers()).toHaveLength(67);
    } finally {
      db.close();
    }

    // 2. Supabase primary store migration
    const { client: mockSupa, savedSettings } = createFakeOAuthSupa();
    const supaStore = mockSupa.toStore();
    await supaStore.createUser('MOCK-66-0001', 'Sutthikan Panla', 'admin');
    await supaStore.setPassword('MOCK-66-0001', 'AdminPass1');
    await supaStore.setTheme('MOCK-66-0001', 'dark');
    const supaSess = await supaStore.createSession('MOCK-66-0001');
    await supaStore.setSetting('google_user_map:sutigran2557@gmail.com', 'MOCK-66-0001', 1000);
    await supaStore.setSetting('user_google_email:MOCK-66-0001', 'sutigran2557@gmail.com', 1000);

    const rtSupa = createRuntime({ supabase: mockSupa });
    try {
      await rtSupa.ensureSeeded();

      expect(await rtSupa.db.getUser('MOCK-66-0001')).toBeNull();
      const admin = await rtSupa.db.getUser('6600000001');
      expect(admin?.full_name).toBe('Sutthikan Panla');
      expect(admin?.role).toBe('admin');
      expect(admin?.theme).toBe('dark');
      expect(await rtSupa.db.verifyPassword('6600000001', 'AdminPass1')).not.toBeNull();

      const resolved = await rtSupa.resolveSession(supaSess);
      expect(resolved?.member_id).toBe('6600000001');
      expect(resolved?.linkedGoogleEmail).toBe('sutigran2557@gmail.com');
      expect(savedSettings.get('google_user_map:sutigran2557@gmail.com')).toBe('6600000001');
      expect(savedSettings.get('user_google_email:6600000001')).toBe('sutigran2557@gmail.com');
      expect(savedSettings.has('user_google_email:MOCK-66-0001')).toBe(false);
      expect(await rtSupa.db.listUsers()).toHaveLength(67);
    } finally {
      rtSupa.db.close();
    }
  });
});



