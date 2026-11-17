import { addDayStr, pad2, projectDaysOf } from './format';
import type { ProjectSummary } from './types';

export type CalViewMode = 'month' | 'week' | 'day';

export interface EventPaletteColor {
  index: number;
  cssClass: string;
  name: string;
  hex: string;
  bgLight: string;
  textLight: string;
  borderLight: string;
  bgDark: string;
  textDark: string;
  borderDark: string;
}

export const EVENT_PALETTE: readonly EventPaletteColor[] = [
  {
    index: 0,
    cssClass: 'ev-palette-0',
    name: 'Terracotta',
    hex: '#c95d3a',
    bgLight: '#fbeae4',
    textLight: '#7c2f17',
    borderLight: '#c95d3a',
    bgDark: '#4c281e',
    textDark: '#f8c3b0',
    borderDark: '#e07b59'
  },
  {
    index: 1,
    cssClass: 'ev-palette-1',
    name: 'Sage',
    hex: '#3d7a5a',
    bgLight: '#e6f3ec',
    textLight: '#1f4b34',
    borderLight: '#3d7a5a',
    bgDark: '#1f3d2d',
    textDark: '#a7dec0',
    borderDark: '#59a67d'
  },
  {
    index: 2,
    cssClass: 'ev-palette-2',
    name: 'Ocean',
    hex: '#2e6f95',
    bgLight: '#e5f1f8',
    textLight: '#17445e',
    borderLight: '#2e6f95',
    bgDark: '#1b3547',
    textDark: '#a6d4ee',
    borderDark: '#4f99c4'
  },
  {
    index: 3,
    cssClass: 'ev-palette-3',
    name: 'Plum',
    hex: '#7a4d8b',
    bgLight: '#f2eaf6',
    textLight: '#492756',
    borderLight: '#7a4d8b',
    bgDark: '#382442',
    textDark: '#dab7e8',
    borderDark: '#a773bc'
  },
  {
    index: 4,
    cssClass: 'ev-palette-4',
    name: 'Amber',
    hex: '#b87324',
    bgLight: '#fbf0e1',
    textLight: '#6b3e0d',
    borderLight: '#b87324',
    bgDark: '#452e16',
    textDark: '#f4ca92',
    borderDark: '#dc9441'
  },
  {
    index: 5,
    cssClass: 'ev-palette-5',
    name: 'Teal',
    hex: '#2a7b76',
    bgLight: '#e4f4f3',
    textLight: '#144c49',
    borderLight: '#2a7b76',
    bgDark: '#193b39',
    textDark: '#9fe0db',
    borderDark: '#4baea8'
  },
  {
    index: 6,
    cssClass: 'ev-palette-6',
    name: 'Rose',
    hex: '#b54865',
    bgLight: '#fae9ee',
    textLight: '#6e1e34',
    borderLight: '#b54865',
    bgDark: '#46212c',
    textDark: '#f4b2c4',
    borderDark: '#d86d8a'
  },
  {
    index: 7,
    cssClass: 'ev-palette-7',
    name: 'Indigo',
    hex: '#4a5899',
    bgLight: '#eaedf8',
    textLight: '#273163',
    borderLight: '#4a5899',
    bgDark: '#252c4b',
    textDark: '#b8c3f2',
    borderDark: '#7082d4'
  }
] as const;

export interface SvarCalendarEvent {
  id: string;
  text: string;
  title: string;
  start: Date;
  end: Date;
  allDay: true;
  colorIndex: number;
  color: string;
  css: string;
  raw: ProjectSummary;
  event_id: string;
  status: ProjectSummary['status'];
  days: number;
  start_date: string;
  end_date: string;
  budget_planned: number;
  budget_actual: number;
  attendee_count: number;
  location: string;
  category: ProjectSummary['category'];
  note: string;
}

export function getEventColorIndex(eventId: string): number {
  const match = String(eventId || '').match(/(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (Number.isFinite(num) && num > 0) {
      return (num - 1) % EVENT_PALETTE.length;
    }
  }
  let hash = 0;
  const str = String(eventId || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % EVENT_PALETTE.length;
}

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

export function formatLocalIso(dt: Date): string {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function shiftDayStr(dateStr: string, deltaDays: number): string {
  return addDayStr(dateStr, deltaDays);
}

export function getDayTitle(dateStr: string): string {
  if (!dateStr) return '';
  const dt = parseIsoUtc(dateStr);
  return `${DOW_LABELS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS_SHORT[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function toSvarEvents(events: ProjectSummary[]): SvarCalendarEvent[] {
  return events
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.event_id.localeCompare(b.event_id))
    .map((ev) => {
      const startIso = ev.date;
      const endIso = ev.end_date && ev.end_date >= startIso ? ev.end_date : startIso;
      const exclusiveEndIso = addDayStr(endIso, 1);
      const colorIndex = getEventColorIndex(ev.event_id);
      const palette = EVENT_PALETTE[colorIndex];
      const statusSlug = ev.status.toLowerCase();
      return {
        id: ev.event_id,
        text: ev.title,
        title: ev.title,
        start: parseLocalDate(startIso),
        end: parseLocalDate(exclusiveEndIso),
        allDay: true,
        colorIndex,
        color: palette.hex,
        css: `${palette.cssClass} st-${statusSlug}${ev.days > 1 ? ' ev-multiday' : ''}`,
        raw: ev,
        event_id: ev.event_id,
        status: ev.status,
        days: ev.days,
        start_date: startIso,
        end_date: endIso,
        budget_planned: ev.budget_planned,
        budget_actual: ev.actual,
        attendee_count: ev.attendees,
        location: ev.location,
        category: ev.category,
        note: ev.description
      };
    });
}

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
