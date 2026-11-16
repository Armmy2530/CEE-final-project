'use strict';
// Aggregates raw sheet tabs into the dashboard payload.
const { buildAlerts } = require('./alerts');

const ATTENDED = new Set(['Present', 'Late']);

function countBy(items, keyFn) {
  const out = {};
  for (const it of items) { const k = keyFn(it) || 'Unknown'; out[k] = (out[k] || 0) + 1; }
  return out;
}

function buildProject(ev, data, membersById, today) {
  const year = today.slice(0, 4);
  const spent = data.Budget.filter((b) => b.event_id === ev.event_id);
  const records = data.Attendance.filter((a) => a.event_id === ev.event_id);
  const actual = spent.reduce((s, b) => s + b.amount, 0);
  const person = (a) => {
    const m = membersById.get(a.member_id) || {};
    return { member_id: a.member_id, name: m.full_name || a.member_id, department: m.department || '', status: a.status };
  };
  const staff = records.filter((a) => a.participant_type === 'Staff').map(person);
  const participants = records.filter((a) => a.participant_type !== 'Staff').map(person);

  // "This year's data only": attendance dated in the current calendar year, people who actually came.
  const thisYear = records.filter((a) => ATTENDED.has(a.status) && (a.check_in_time || ev.date).slice(0, 4) === year);
  const attendedMembers = thisYear.map((a) => membersById.get(a.member_id) || {});
  const breakdown = {
    gender: countBy(attendedMembers, (m) => m.gender),
    year: countBy(attendedMembers, (m) => (m.year ? `Year ${m.year}` : '')),
    major: countBy(attendedMembers, (m) => m.major),
  };

  const registered = participants.length;
  const attendedParticipants = participants.filter((p) => ATTENDED.has(p.status)).length;
  return {
    ...ev,
    actual,
    pct: ev.budget_planned > 0 ? actual / ev.budget_planned : null,
    attendees: records.filter((a) => ATTENDED.has(a.status)).length,
    records: records.length,
    days: Math.max(1, (Date.parse(`${ev.end_date || ev.date}T00:00:00Z`) - Date.parse(`${ev.date}T00:00:00Z`)) / 86400000 + 1),
    staff,
    participants,
    stats: {
      staff: staff.length,
      participants: registered,
      attended: attendedParticipants,
      attendanceRate: registered ? attendedParticipants / registered : null,
    },
    breakdown,
    breakdownYear: year,
    expenses: spent.map((b) => ({ category: b.category, amount: b.amount, date: b.date })),
  };
}

function buildDashboard(data, today) {
  const members = data.Members;
  const membersById = new Map(members.map((m) => [m.member_id, m]));
  const perEvent = data.Events.map((ev) => buildProject(ev, data, membersById, today));

  const byStatus = {};
  for (const ev of perEvent) byStatus[ev.status] = (byStatus[ev.status] || 0) + 1;

  const actualTotal = data.Budget.reduce((s, b) => s + b.amount, 0);
  const activeEvents = perEvent.filter((e) => e.status !== 'Cancelled');
  const plannedActive = activeEvents.reduce((s, e) => s + e.budget_planned, 0);
  const actualActive = activeEvents.reduce((s, e) => s + e.actual, 0);
  const plannedAll = perEvent.reduce((s, e) => s + e.budget_planned, 0);

  const byCategory = {};
  for (const b of data.Budget) byCategory[b.category] = (byCategory[b.category] || 0) + b.amount;

  const deptCounts = {};
  for (const m of members) deptCounts[m.department] = (deptCounts[m.department] || 0) + 1;

  return {
    today,
    metrics: {
      members: members.length,
      events: perEvent.length,
      eventsByStatus: byStatus,
      budgetActual: actualTotal,
      budgetPlanned: plannedAll,
      budgetPct: plannedAll > 0 ? actualTotal / plannedAll : null,
    },
    events: perEvent,
    budgetByCategory: byCategory,
    membersByDepartment: deptCounts,
    alerts: buildAlerts({ events: perEvent, totals: { planned: plannedActive, actual: actualActive } }, today),
  };
}

module.exports = { buildDashboard };
