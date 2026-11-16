import { addDayStr, pad2, projectDaysOf } from './format';
import type { ProjectSummary } from './types';

export type CalViewMode = 'month' | 'week';

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const;

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const;

export type CalDayEvent = ProjectSummary & {
  dayNo: number;
  dayCount: number;
};

export interface CalMonthCell {
  key: string;
  dayNum: number;
  other: boolean;
  today: boolean;
  selected: boolean;
  evs: CalDayEvent[];
}

export interface CalWeekDay {
  key: string;
  dowLabel: string;
  dayNum: number;
  monthShort: string;
  today: boolean;
  selected: boolean;
  evs: CalDayEvent[];
}

export interface CalWeekSpan {
  event: ProjectSummary;
  startCol: number;
  spanCols: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  startDayNo: number;
  endDayNo: number;
  totalDays: number;
  dayRangeText: string;
}

export function parseIsoUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatIsoUtc(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function diffIsoDays(fromIso: string, toIso: string): number {
  const a = parseIsoUtc(fromIso).getTime();
  const b = parseIsoUtc(toIso).getTime();
  return Math.round((b - a) / 86400000);
}

export function buildByDateMap(events: ProjectSummary[]): Record<string, CalDayEvent[]> {
  const map: Record<string, CalDayEvent[]> = {};
  const sorted = events
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.event_id.localeCompare(b.event_id));
  for (const e of sorted) {
    const days = projectDaysOf(e);
    days.forEach((day, i) => {
      if (!map[day]) map[day] = [];
      map[day].push({ ...e, dayNo: i + 1, dayCount: days.length });
    });
  }
  return map;
}

export function getMonthTitle(calMonth: string): string {
  if (!calMonth) return '';
  const [y, mo] = calMonth.split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return '';
  return `${MONTHS_FULL[mo - 1]} ${y}`;
}

export function shiftMonthStr(calMonth: string, delta: number): string {
  const [y, mo] = calMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
}

export function buildMonthGrid(
  calMonth: string,
  today: string,
  selected: string | null,
  byDate: Record<string, CalDayEvent[]>
): CalMonthCell[] {
  if (!calMonth) return [];
  const [y, moNum] = calMonth.split('-').map(Number);
  const mo = moNum - 1;
  const first = new Date(Date.UTC(y, mo, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86400000);
  const cells: CalMonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start.getTime() + i * 86400000);
    if (i === 35 && dt.getUTCMonth() !== mo) break;
    const key = formatIsoUtc(dt);
    cells.push({
      key,
      dayNum: dt.getUTCDate(),
      other: dt.getUTCMonth() !== mo,
      today: key === today,
      selected: key === selected,
      evs: byDate[key] || []
    });
  }
  return cells;
}

export function getWeekStart(dateStr: string): string {
  const dt = parseIsoUtc(dateStr);
  const sunday = new Date(dt.getTime() - dt.getUTCDay() * 86400000);
  return formatIsoUtc(sunday);
}

export function getWeekRange(dateStr: string): { start: string; end: string } {
  const start = getWeekStart(dateStr);
  return { start, end: addDayStr(start, 6) };
}

export function shiftWeekStr(weekStart: string, deltaWeeks: number): string {
  return addDayStr(getWeekStart(weekStart), deltaWeeks * 7);
}

export function getWeekTitle(weekStart: string): string {
  if (!weekStart) return '';
  const { start, end } = getWeekRange(weekStart);
  const d1 = parseIsoUtc(start);
  const d2 = parseIsoUtc(end);
  const y1 = d1.getUTCFullYear();
  const y2 = d2.getUTCFullYear();
  const m1 = d1.getUTCMonth();
  const m2 = d2.getUTCMonth();
  const day1 = d1.getUTCDate();
  const day2 = d2.getUTCDate();

  if (y1 === y2 && m1 === m2) {
    return `${day1} \u2013 ${day2} ${MONTHS_SHORT[m2]} ${y2}`;
  }
  if (y1 === y2) {
    return `${day1} ${MONTHS_SHORT[m1]} \u2013 ${day2} ${MONTHS_SHORT[m2]} ${y2}`;
  }
  return `${day1} ${MONTHS_SHORT[m1]} ${y1} \u2013 ${day2} ${MONTHS_SHORT[m2]} ${y2}`;
}

export function buildWeekDays(
  weekStart: string,
  today: string,
  selected: string | null,
  byDate: Record<string, CalDayEvent[]>
): CalWeekDay[] {
  if (!weekStart) return [];
  const start = getWeekStart(weekStart);
  const days: CalWeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const key = addDayStr(start, i);
    const dt = parseIsoUtc(key);
    days.push({
      key,
      dowLabel: DOW_LABELS[i],
      dayNum: dt.getUTCDate(),
      monthShort: MONTHS_SHORT[dt.getUTCMonth()],
      today: key === today,
      selected: key === selected,
      evs: byDate[key] || []
    });
  }
  return days;
}

export function buildWeekSpans(weekStart: string, events: ProjectSummary[]): CalWeekSpan[] {
  if (!weekStart) return [];
  const { start: ws, end: we } = getWeekRange(weekStart);

  const raw: Array<Omit<CalWeekSpan, 'lane'>> = [];
  for (const event of events) {
    const days = projectDaysOf(event);
    if (days.length <= 1) continue;
    const evStart = days[0];
    const evEnd = days[days.length - 1];
    if (evEnd < ws || evStart > we) continue;

    const clippedStart = evStart < ws ? ws : evStart;
    const clippedEnd = evEnd > we ? we : evEnd;
    const continuesBefore = evStart < ws;
    const continuesAfter = evEnd > we;
    const startCol = diffIsoDays(ws, clippedStart) + 1;
    const endCol = diffIsoDays(ws, clippedEnd) + 1;
    const spanCols = endCol - startCol + 1;
    const startDayNo = diffIsoDays(evStart, clippedStart) + 1;
    const endDayNo = diffIsoDays(evStart, clippedEnd) + 1;
    const totalDays = days.length;
    const dayRangeText =
      startDayNo === endDayNo
        ? `Day ${startDayNo} of ${totalDays}`
        : `Day ${startDayNo}\u2013${endDayNo} of ${totalDays}`;

    raw.push({
      event,
      startCol,
      spanCols,
      continuesBefore,
      continuesAfter,
      startDayNo,
      endDayNo,
      totalDays,
      dayRangeText
    });
  }

  raw.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.spanCols - a.spanCols ||
      a.event.date.localeCompare(b.event.date) ||
      a.event.event_id.localeCompare(b.event.event_id)
  );

  const laneEndCols: number[] = [];
  return raw.map((item) => {
    const itemEndCol = item.startCol + item.spanCols - 1;
    let lane = laneEndCols.findIndex((endCol) => endCol < item.startCol);
    if (lane === -1) {
      lane = laneEndCols.length;
      laneEndCols.push(itemEndCol);
    } else {
      laneEndCols[lane] = itemEndCol;
    }
    return { ...item, lane };
  });
}
