// Aggregates normalized sheet tabs into the dashboard payload.
import { buildAlerts, type Alert } from './alerts';
import type { AttendanceRecord, EventRecord, MemberRecord, SheetData } from './sheets';

const ATTENDED = new Set(['Present', 'Late']);

export interface ProjectPerson {
  member_id: string;
  name: string;
  department: string;
  role: string;
  status: AttendanceRecord['status'];
}

export interface ProjectBreakdown {
  gender: Record<string, number>;
  year: Record<string, number>;
  major: Record<string, number>;
}

export interface ProjectSummary extends EventRecord {
  actual: number;
  pct: number | null;
  attendees: number;
  records: number;
  days: number;
  staff: ProjectPerson[];
  participants: ProjectPerson[];
  stats: {
    staff: number;
    participants: number;
    attended: number;
    attendanceRate: number | null;
  };
  breakdown: ProjectBreakdown;
  breakdownYear: string;
  expenses: Array<{ category: string; amount: number; date: string }>;
}

export interface DashboardPayload {
  today: string;
  metrics: {
    members: number;
    events: number;
    eventsByStatus: Record<string, number>;
    budgetActual: number;
    budgetPlanned: number;
    budgetIncome: number;
    budgetPct: number | null;
  };
  events: ProjectSummary[];
  budgetByCategory: Record<string, number>;
  membersByDepartment: Record<string, number>;
  alerts: Alert[];
  meta?: {
    source: 'mock' | 'google';
    fetchedAt: number;
    stale: boolean;
  };
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = keyFn(it) || 'Unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function buildProject(
  ev: EventRecord,
  data: SheetData,
  membersById: Map<string, MemberRecord>,
  today: string
): ProjectSummary {
  const year = today.slice(0, 4);
  const evYear = (ev.date || '').slice(0, 4) || year;
  const spent = data.Budget.filter((b) => b.event_id === ev.event_id && b.type !== 'Income');
  const records = data.Attendance.filter((a) => a.event_id === ev.event_id);
  const actual = spent.reduce((s, b) => s + b.amount, 0);

  const person = (a: AttendanceRecord): ProjectPerson => {
    const m = membersById.get(a.member_id) || ({} as Partial<MemberRecord>);
    return {
      member_id: a.member_id,
      name: m.full_name || a.full_name || a.member_id,
      department: m.major || m.department || a.major || '',
      role: a.project_role || m.role || '',
      status: a.status
    };
  };

  const staff = records.filter((a) => a.participant_type === 'Staff').map(person);
  const participants = records.filter((a) => a.participant_type !== 'Staff').map(person);

  // Include attended records in today's year, or all attended records in the event's own year
  // so both 2026 and 2027 projects (AC-001..AC-020) retain populated breakdowns.
  const attendedAll = records.filter((a) => ATTENDED.has(a.status));
  const inTodayYear = attendedAll.filter((a) => (a.check_in_time || ev.date).slice(0, 4) === year);
  const allInEventYear =
    attendedAll.length > 0 && attendedAll.every((a) => (a.check_in_time || ev.date).slice(0, 4) === evYear);
  const counted = inTodayYear.length > 0 ? inTodayYear : allInEventYear ? attendedAll : [];
  const breakdownYear = inTodayYear.length > 0 ? year : evYear;

  const attendedPeople = counted.map((a) => {
    const m = membersById.get(a.member_id) || ({} as Partial<MemberRecord>);
    return {
      gender: m.gender || a.gender || '',
      year: m.year || a.year || '',
      major: m.major || a.major || ''
    };
  });

  const breakdown: ProjectBreakdown = {
    gender: countBy(attendedPeople, (p) => p.gender),
    year: countBy(attendedPeople, (p) => (p.year ? `Year ${p.year}` : '')),
    major: countBy(attendedPeople, (p) => p.major)
  };

  const registered = participants.length;
  const attendedParticipants = participants.filter((p) => ATTENDED.has(p.status)).length;

  return {
    ...ev,
    actual,
    pct: ev.budget_planned > 0 ? actual / ev.budget_planned : null,
    attendees: attendedAll.length,
    records: records.length,
    days: Math.max(
      1,
      (Date.parse(`${ev.end_date || ev.date}T00:00:00Z`) - Date.parse(`${ev.date}T00:00:00Z`)) / 86400000 + 1
    ),
    staff,
    participants,
    stats: {
      staff: staff.length,
      participants: registered,
      attended: attendedParticipants,
      attendanceRate: registered ? attendedParticipants / registered : null
    },
    breakdown,
    breakdownYear,
    expenses: spent.map((b) => ({ category: b.category, amount: b.amount, date: b.date }))
  };
}

export function buildDashboard(data: SheetData, today: string): DashboardPayload {
  const members = data.Members;
  const membersById = new Map(members.map((m) => [m.member_id, m]));
  const perEvent = data.Events.map((ev) => buildProject(ev, data, membersById, today));

  const byStatus: Record<string, number> = {};
  for (const ev of perEvent) byStatus[ev.status] = (byStatus[ev.status] || 0) + 1;

  const expenseRows = data.Budget.filter((b) => b.type !== 'Income');
  const incomeRows = data.Budget.filter((b) => b.type === 'Income');

  const actualTotal = expenseRows.reduce((s, b) => s + b.amount, 0);
  const incomeTotal = incomeRows.reduce((s, b) => s + b.amount, 0);
  const activeEvents = perEvent.filter((e) => e.status !== 'Cancelled');
  const plannedActive = activeEvents.reduce((s, e) => s + e.budget_planned, 0);
  const actualActive = activeEvents.reduce((s, e) => s + e.actual, 0);
  const plannedAll = perEvent.reduce((s, e) => s + e.budget_planned, 0);

  const byCategory: Record<string, number> = {};
  for (const b of expenseRows) byCategory[b.category] = (byCategory[b.category] || 0) + b.amount;

  const deptCounts: Record<string, number> = {};
  for (const m of members) deptCounts[m.department] = (deptCounts[m.department] || 0) + 1;

  return {
    today,
    metrics: {
      members: members.length,
      events: perEvent.length,
      eventsByStatus: byStatus,
      budgetActual: actualTotal,
      budgetPlanned: plannedAll,
      budgetIncome: incomeTotal,
      budgetPct: plannedAll > 0 ? actualTotal / plannedAll : null
    },
    events: perEvent,
    budgetByCategory: byCategory,
    membersByDepartment: deptCounts,
    alerts: buildAlerts({ events: perEvent, totals: { planned: plannedActive, actual: actualActive } }, today)
  };
}
