import type { ProjectSummary } from './types';

export const baht = (n: number): string => `฿${Math.round(n).toLocaleString('en-US')}`;
export const pct = (x: number | null | undefined): string => (x == null ? '–' : `${Math.round(x * 100)}%`);

export function fmtDate(s: string): string {
  const p = s.split('-');
  if (p.length !== 3) return s;
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

export function fmtRange(ev: Pick<ProjectSummary, 'date' | 'end_date'>): string {
  return ev.end_date && ev.end_date !== ev.date ? `${fmtDate(ev.date)} – ${fmtDate(ev.end_date)}` : fmtDate(ev.date);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function addDayStr(s: string, n: number): string {
  const p = s.split('-');
  const dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function projectDaysOf(ev: Pick<ProjectSummary, 'date' | 'end_date'>): string[] {
  const out: string[] = [];
  let d = ev.date;
  let n = 0;
  while (d && d <= (ev.end_date || ev.date) && n < 120) {
    out.push(d);
    d = addDayStr(d, 1);
    n++;
  }
  return out;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export async function apiFetch<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opt: RequestInit = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET' && method !== 'HEAD') {
    opt.headers = { 'content-type': 'application/json' };
    opt.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(url, opt);
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    const err = new Error(json.error || 'Request failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json;
}
