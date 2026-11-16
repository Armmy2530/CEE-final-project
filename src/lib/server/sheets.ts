// Data source: ONE batched Google Sheets API call for all tabs, cached for SHEET_CACHE_SECONDS
// with in-flight de-duplication. Falls back to the last good copy if Google errors, and to
// normalized Mock-Data CSVs when no key is configured.
import { generateMock } from './mock';
import { normalizeDate, todayInTz } from './dates';

export const TABS = ['Members', 'Events', 'Attendance', 'Budget'] as const;
export type TabName = (typeof TABS)[number];

export interface MemberRecord {
  member_id: string;
  full_name: string;
  department: string;
  role: string;
  email: string;
  joined_date: string;
  gender: string;
  year: string;
  major: string;
  member_status: string;
}

export interface EventRecord {
  event_id: string;
  title: string;
  date: string;
  end_date: string;
  location: string;
  description: string;
  budget_planned: number;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  image_url: string;
}

export interface AttendanceRecord {
  attendance_id: string;
  event_id: string;
  member_id: string;
  full_name: string;
  check_in_time: string;
  status: 'Present' | 'Absent' | 'Late';
  participant_type: 'Staff' | 'Participant';
  project_role: string;
  gender: string;
  year: string;
  major: string;
}

export interface BudgetRecord {
  expense_id: string;
  event_id: string;
  type: 'Income' | 'Expense';
  category: string;
  amount: number;
  date: string;
  receipt_ref: string;
}

export interface SheetData {
  Members: MemberRecord[];
  Events: EventRecord[];
  Attendance: AttendanceRecord[];
  Budget: BudgetRecord[];
}

export type RawRow = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[,฿\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => String(v ?? '').trim();

const pick = (r: RawRow, ...keys: string[]): unknown => {
  for (const k of keys) {
    if (r[k] !== undefined && str(r[k]) !== '') return r[k];
  }
  return '';
};

// Accepts English, Thai, and raw Mock-Data status words.
const EVENT_STATUS: Record<string, EventRecord['status']> = {
  scheduled: 'Scheduled',
  'in progress': 'Scheduled',
  processing: 'Scheduled',
  'waiting for approving': 'Scheduled',
  ดำเนินการ: 'Scheduled',
  กำลังดำเนินการ: 'Scheduled',
  completed: 'Completed',
  done: 'Completed',
  closed: 'Completed',
  ปิดโครงการ: 'Completed',
  เสร็จสิ้น: 'Completed',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  ยกเลิก: 'Cancelled'
};

const GENDERS: Record<string, string> = {
  female: 'Female',
  f: 'Female',
  หญิง: 'Female',
  male: 'Male',
  m: 'Male',
  ชาย: 'Male'
};

const normGender = (v: unknown): string => {
  const k = str(v).toLowerCase();
  return !k ? '' : GENDERS[k] || 'Other';
};

const normYear = (v: unknown): string => {
  const m = str(v).match(/\d+/);
  if (!m) return '';
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

const STAFF_ROLE_RE = /^(president|vice president|secretary|treasurer|it head|staff)$/i;
const STAFF_TYPE_RE = /staff|เจ้าหน้าที่|สต๊าฟ|สตาฟ/i;

function splitDeptYear(raw: unknown): { major: string; year: string } {
  const s = str(raw);
  if (!s.includes('/')) return { major: s, year: '' };
  const [mPart, yPart] = s.split('/', 2);
  return { major: mPart.trim(), year: normYear(yPart) };
}

export const NORMALIZERS = {
  Members: (r: RawRow): MemberRecord => {
    const hasCommittee = str(r.committee) !== '';
    return {
      member_id: str(pick(r, 'member_id', 'student_id')),
      full_name: str(pick(r, 'full_name', 'name')),
      department: hasCommittee ? str(r.committee) : str(r.department),
      role: str(pick(r, 'role')),
      email: str(pick(r, 'email')),
      joined_date: normalizeDate(pick(r, 'joined_date', 'join_date')) || '',
      gender: normGender(pick(r, 'gender')),
      year: normYear(pick(r, 'year')),
      major: str(r.major) || (hasCommittee ? str(r.department) : ''),
      member_status: str(pick(r, 'member_status'))
    };
  },

  Events: (r: RawRow): EventRecord => {
    const start = normalizeDate(pick(r, 'date', 'start_date')) || '';
    const end = normalizeDate(pick(r, 'end_date')) || start;
    const rawStatus = str(pick(r, 'status')).toLowerCase();
    const rawImg = str(pick(r, 'image_url'));
    return {
      event_id: str(pick(r, 'event_id', 'project_id')),
      title: str(pick(r, 'title', 'project_name')),
      date: start,
      end_date: end,
      location: str(pick(r, 'location')),
      description: str(pick(r, 'description')),
      budget_planned: num(pick(r, 'budget_planned', 'total_income')),
      status: EVENT_STATUS[rawStatus] || 'Scheduled',
      image_url: /^https:\/\//i.test(rawImg) ? rawImg : ''
    };
  },

  Attendance: (r: RawRow, idx = 0): AttendanceRecord => {
    const eventId = str(pick(r, 'event_id', 'project_id'));
    const memberId = str(pick(r, 'member_id', 'student_id'));
    const rawId = str(pick(r, 'attendance_id'));
    const projectRole = str(pick(r, 'project_role', 'role'));
    const pTypeRaw = str(pick(r, 'participant_type'));
    const isStaff = STAFF_TYPE_RE.test(pTypeRaw) || STAFF_ROLE_RE.test(projectRole);
    const deptYear = splitDeptYear(pick(r, 'department / year', 'department/year'));
    const major = str(pick(r, 'major', 'department')) || deptYear.major;
    const year = normYear(pick(r, 'year')) || deptYear.year;
    const rawStatus = str(pick(r, 'status')).toLowerCase();
    const status = (['Present', 'Absent', 'Late'] as const).find((s) => s.toLowerCase() === rawStatus) || 'Absent';

    return {
      attendance_id: rawId || (eventId && memberId ? `ATT-${idx + 1}` : ''),
      event_id: eventId,
      member_id: memberId,
      full_name: str(pick(r, 'full_name', 'name')),
      check_in_time: str(pick(r, 'check_in_time')),
      status,
      participant_type: isStaff ? 'Staff' : 'Participant',
      project_role: projectRole,
      gender: normGender(pick(r, 'gender')),
      year,
      major
    };
  },

  Budget: (r: RawRow): BudgetRecord => {
    const rawType = str(pick(r, 'type'));
    const type: 'Income' | 'Expense' = /^income$/i.test(rawType) ? 'Income' : 'Expense';
    const category = str(pick(r, 'category', 'expense_type')) || (type === 'Income' ? 'Club Allocation' : 'Other');
    return {
      expense_id: str(pick(r, 'expense_id', 'tx_id')),
      event_id: str(pick(r, 'event_id', 'project_id')),
      type,
      category,
      amount: num(pick(r, 'amount')),
      date: normalizeDate(pick(r, 'date')) || '',
      receipt_ref: str(pick(r, 'receipt_ref'))
    };
  }
};

export const KEY_FIELD: Record<TabName, string> = {
  Members: 'member_id',
  Events: 'event_id',
  Attendance: 'attendance_id',
  Budget: 'expense_id'
};

export function rowsToObjects(values: unknown[][]): RawRow[] {
  if (!Array.isArray(values) || values.length < 2) return [];
  const header = values[0].map((h) => str(h).toLowerCase());
  return values.slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])));
}

export interface BatchValueRange {
  range?: string;
  values?: unknown[][];
}

export function parseBatchResponse(json: { valueRanges?: BatchValueRange[] }): SheetData {
  const out: Partial<Record<TabName, unknown[][]>> = {};
  for (const vr of json.valueRanges || []) {
    const tab = TABS.find((t) => (vr.range || '').replace(/^'/, '').startsWith(t));
    if (tab) out[tab] = vr.values || [];
  }
  const data = {} as SheetData;
  for (const tab of TABS) {
    if (!out[tab]) throw new Error(`Sheet tab "${tab}" was not found in the spreadsheet`);
    const normalizer = NORMALIZERS[tab] as unknown as (r: RawRow, idx: number) => Record<string, unknown>;
    const key = KEY_FIELD[tab];
    (data as unknown as Record<TabName, unknown[]>)[tab] = rowsToObjects(out[tab]!)
      .map((r, i) => normalizer(r, i))
      .filter((r) => Boolean(r[key]));
  }
  return data;
}

export interface SourceResult {
  data: SheetData;
  source: 'mock' | 'google';
  stale: boolean;
  fetchedAt: number;
  error?: string;
}

export interface SourceOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createSource({ env = process.env, fetchImpl = fetch, now = () => Date.now() }: SourceOptions = {}) {
  const key = env.GOOGLE_API_KEY;
  const sheetId = env.GOOGLE_SHEET_ID;
  const ttl = Math.max(0, Number(env.SHEET_CACHE_SECONDS ?? 30)) * 1000;
  const tz = env.TZ_NAME || 'Asia/Bangkok';
  let cache: SourceResult | null = null;
  let inflight: Promise<SourceResult> | null = null;

  async function fetchGoogle(): Promise<SheetData> {
    const params = TABS.map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId!)}/values:batchGet?${params}&key=${encodeURIComponent(key!)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Google Sheets API responded ${res.status}`);
    return parseBatchResponse((await res.json()) as { valueRanges?: BatchValueRange[] });
  }

  async function load(): Promise<Omit<SourceResult, 'fetchedAt'>> {
    if (!key || !sheetId) {
      return { data: generateMock(todayInTz(tz, new Date(now()))), source: 'mock', stale: false };
    }
    return { data: await fetchGoogle(), source: 'google', stale: false };
  }

  async function getData({ force = false } = {}): Promise<SourceResult> {
    if (cache && !force && now() - cache.fetchedAt < ttl) return cache;
    if (!inflight) {
      inflight = load()
        .then((r) => {
          cache = { ...r, fetchedAt: now() };
          return cache;
        })
        .catch((err: Error) => {
          if (cache) {
            cache = { ...cache, stale: true, error: err.message };
            return cache;
          }
          throw err;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  return { getData, mode: key && sheetId ? ('google' as const) : ('mock' as const) };
}
