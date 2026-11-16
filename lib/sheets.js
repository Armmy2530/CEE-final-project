'use strict';
// Data source: ONE batched Google Sheets API call for all tabs (keeps us far below the
// rate limit), cached for SHEET_CACHE_SECONDS with in-flight de-duplication. Falls back to
// the last good copy if Google errors, and to built-in mock data when no key is configured.
const { generateMock } = require('./mock');
const { normalizeDate, todayInTz } = require('./dates');

const TABS = ['Members', 'Events', 'Attendance', 'Budget'];

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,฿\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => String(v ?? '').trim();

// Accepts English or Thai status words.
const EVENT_STATUS = { scheduled: 'Scheduled', 'in progress': 'Scheduled', 'ดำเนินการ': 'Scheduled', 'กำลังดำเนินการ': 'Scheduled',
  completed: 'Completed', closed: 'Completed', 'ปิดโครงการ': 'Completed', 'เสร็จสิ้น': 'Completed',
  cancelled: 'Cancelled', canceled: 'Cancelled', 'ยกเลิก': 'Cancelled' };
const GENDERS = { female: 'Female', f: 'Female', 'หญิง': 'Female', male: 'Male', m: 'Male', 'ชาย': 'Male' };
const normGender = (v) => { const k = str(v).toLowerCase(); return !k ? '' : GENDERS[k] || 'Other'; };
const normYear = (v) => { const n = parseInt(str(v), 10); return Number.isFinite(n) && n > 0 ? String(n) : ''; };

const NORMALIZERS = {
  Members: (r) => ({
    member_id: str(r.member_id), full_name: str(r.full_name), department: str(r.department),
    role: str(r.role), email: str(r.email), joined_date: normalizeDate(r.joined_date) || '',
    gender: normGender(r.gender), year: normYear(r.year), major: str(r.major),
  }),
  Events: (r) => ({
    event_id: str(r.event_id), title: str(r.title), date: normalizeDate(r.date) || '',
    end_date: normalizeDate(r.end_date) || normalizeDate(r.date) || '',
    location: str(r.location), description: str(r.description), budget_planned: num(r.budget_planned),
    status: EVENT_STATUS[str(r.status).toLowerCase()] || 'Scheduled',
    image_url: /^https:\/\//i.test(str(r.image_url)) ? str(r.image_url) : '',
  }),
  Attendance: (r) => ({
    attendance_id: str(r.attendance_id), event_id: str(r.event_id), member_id: str(r.member_id),
    check_in_time: str(r.check_in_time),
    status: ['Present', 'Absent', 'Late'].find((s) => s.toLowerCase() === str(r.status).toLowerCase()) || 'Absent',
    participant_type: /staff|เจ้าหน้าที่|สตาฟ/i.test(str(r.participant_type)) ? 'Staff' : 'Participant',
  }),
  Budget: (r) => ({
    expense_id: str(r.expense_id), event_id: str(r.event_id), category: str(r.category) || 'Other',
    amount: num(r.amount), date: normalizeDate(r.date) || '', receipt_ref: str(r.receipt_ref),
  }),
};
const KEY_FIELD = { Members: 'member_id', Events: 'event_id', Attendance: 'attendance_id', Budget: 'expense_id' };

function rowsToObjects(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const header = values[0].map((h) => str(h).toLowerCase());
  return values.slice(1)
    .map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])));
}

function parseBatchResponse(json) {
  const out = {};
  for (const vr of json.valueRanges || []) {
    const tab = TABS.find((t) => (vr.range || '').replace(/^'/, '').startsWith(t));
    if (tab) out[tab] = vr.values || [];
  }
  const data = {};
  for (const tab of TABS) {
    if (!out[tab]) throw new Error(`Sheet tab "${tab}" was not found in the spreadsheet`);
    data[tab] = rowsToObjects(out[tab]).map(NORMALIZERS[tab]).filter((r) => r[KEY_FIELD[tab]]);
  }
  return data;
}

function createSource({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const key = env.GOOGLE_API_KEY;
  const sheetId = env.GOOGLE_SHEET_ID;
  const ttl = Math.max(0, Number(env.SHEET_CACHE_SECONDS ?? 30)) * 1000;
  const tz = env.TZ_NAME || 'Asia/Bangkok';
  let cache = null;
  let inflight = null;

  async function fetchGoogle() {
    const params = TABS.map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params}&key=${encodeURIComponent(key)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Google Sheets API responded ${res.status}`);
    return parseBatchResponse(await res.json());
  }

  async function load() {
    if (!key || !sheetId) {
      return { data: generateMock(todayInTz(tz, new Date(now()))), source: 'mock', stale: false };
    }
    return { data: await fetchGoogle(), source: 'google', stale: false };
  }

  async function getData({ force = false } = {}) {
    if (cache && !force && now() - cache.fetchedAt < ttl) return cache;
    if (!inflight) {
      inflight = load()
        .then((r) => { cache = { ...r, fetchedAt: now() }; return cache; })
        .catch((err) => {
          if (cache) { cache = { ...cache, stale: true, error: err.message }; return cache; }
          throw err;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  return { getData, mode: key && sheetId ? 'google' : 'mock' };
}

module.exports = { createSource, parseBatchResponse, rowsToObjects, TABS };
