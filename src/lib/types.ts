export type UserRole = 'admin' | 'user';
export type ThemeMode = 'light' | 'dark';

export interface SessionUser {
  member_id: string;
  full_name: string;
  role: UserRole;
  theme: ThemeMode | null;
}

export interface PublicUser {
  member_id: string;
  full_name: string;
  role: UserRole;
  has_password: boolean;
  theme: ThemeMode | null;
  created_at: number;
}

export interface AlertItem {
  id: string;
  type: 'budget' | 'upcoming';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  event_id: string | null;
}

export interface ProjectPerson {
  member_id: string;
  name: string;
  department: string;
  role: string;
  status: 'Present' | 'Absent' | 'Late';
}

export interface ProjectSummary {
  event_id: string;
  title: string;
  date: string;
  end_date: string;
  location: string;
  description: string;
  budget_planned: number;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  image_url: string;
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
  breakdown: {
    gender: Record<string, number>;
    year: Record<string, number>;
    major: Record<string, number>;
  };
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
  alerts: AlertItem[];
  meta?: {
    source: 'mock' | 'google';
    fetchedAt: number;
    stale: boolean;
  };
}
