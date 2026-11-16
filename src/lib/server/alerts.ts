// Automated alert engine. Pure function: ({ events, totals }, today) -> alerts.
//  - budget: actual spending >= 80% of the planned budget (per event, and overall)
//  - upcoming: a Scheduled event happens within the next 3 days
import { daysBetween } from './dates';

export const BUDGET_THRESHOLD = 0.8;
export const UPCOMING_DAYS = 3;

export interface AlertEventInput {
  event_id: string;
  title: string;
  date: string;
  location: string;
  budget_planned: number;
  actual: number;
  status: string;
}

export interface Alert {
  id: string;
  type: 'budget' | 'upcoming';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  event_id: string | null;
}

const baht = (n: number): string => `฿${Math.round(n).toLocaleString('en-US')}`;
const SEVERITY_ORDER: Record<Alert['severity'], number> = { critical: 0, warning: 1, info: 2 };

export function buildAlerts(
  { events, totals }: { events: AlertEventInput[]; totals: { planned: number; actual: number } },
  today: string
): Alert[] {
  const alerts: Alert[] = [];

  for (const ev of events) {
    if (ev.status === 'Cancelled') continue;
    if (ev.budget_planned > 0) {
      const pct = ev.actual / ev.budget_planned;
      if (pct >= BUDGET_THRESHOLD) {
        const over = pct >= 1;
        alerts.push({
          id: `budget:${ev.event_id}`,
          type: 'budget',
          severity: over ? 'critical' : 'warning',
          title: over ? `Over budget: ${ev.title}` : `Budget at ${Math.round(pct * 100)}%: ${ev.title}`,
          message: `${baht(ev.actual)} spent of ${baht(ev.budget_planned)} planned (${Math.round(pct * 100)}%).`,
          event_id: ev.event_id
        });
      }
    }
    if (ev.status === 'Scheduled') {
      const diff = daysBetween(today, ev.date);
      if (diff >= 0 && diff <= UPCOMING_DAYS) {
        const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`;
        alerts.push({
          id: `upcoming:${ev.event_id}`,
          type: 'upcoming',
          severity: 'info',
          title: `Upcoming ${when}: ${ev.title}`,
          message: `${ev.date}${ev.location ? ' at ' + ev.location : ''}.`,
          event_id: ev.event_id
        });
      }
    }
  }

  if (totals.planned > 0 && totals.actual / totals.planned >= BUDGET_THRESHOLD) {
    const pct = totals.actual / totals.planned;
    alerts.push({
      id: 'budget:overall',
      type: 'budget',
      severity: pct >= 1 ? 'critical' : 'warning',
      title: `Overall budget at ${Math.round(pct * 100)}%`,
      message: `${baht(totals.actual)} spent of ${baht(totals.planned)} planned across active events.`,
      event_id: null
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
