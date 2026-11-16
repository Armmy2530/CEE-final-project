// Date helpers. All dates are handled as 'YYYY-MM-DD' strings in the club's timezone.

export function todayInTz(tz = 'Asia/Bangkok', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

const pad = (n: number): string => String(n).padStart(2, '0');

// Accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, optionally followed by a time.
// Buddhist-era years (>2400) are converted to Gregorian.
export function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  let yStr: string;
  let mStr: string;
  let dStr: string;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) {
    [, yStr, mStr, dStr] = match;
  } else if ((match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) {
    [, dStr, mStr, yStr] = match;
  } else {
    return null;
  }
  let y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function dayNumber(str: string): number {
  const [y, m, d] = str.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// Whole days from a to b (positive when b is after a).
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function addDays(str: string, n: number): string {
  const dt = new Date((dayNumber(str) + n) * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
