import type { DbBackend } from '../types';
import type {
  DbSettingRow,
  DbUserRow,
  PublicUser,
  SessionUser,
  ThemeMode,
  UserRole
} from './auth-crypto';
import type { MemberRecord } from './sheets';

export class StoreUnavailableError extends Error {
  readonly status = 503;

  constructor(message = 'Supabase database is temporarily unavailable. Please try again shortly.') {
    super(message);
    this.name = 'StoreUnavailableError';
  }
}

export interface AppStore {
  readonly backend: DbBackend;
  readonly isMemory: boolean;
  seedFromMembers(members: Array<Pick<MemberRecord, 'member_id' | 'full_name'>>): Promise<void>;
  getUser(id: string): Promise<DbUserRow | null>;
  listUsers(): Promise<PublicUser[]>;
  listAllUserRows(): Promise<DbUserRow[]>;
  upsertUserFromRemote(u: DbUserRow): Promise<void>;
  createUser(member_id: string, full_name: string, role: UserRole): Promise<void>;
  deleteUser(id: string): Promise<'not_found' | 'last_admin' | 'ok'>;
  setPassword(id: string, password: string): Promise<void>;
  resetPassword(id: string): Promise<void>;
  setTheme(id: string, theme: ThemeMode): Promise<void>;
  verifyPassword(id: string, password: string): Promise<SessionUser | null>;
  createSession(member_id: string): Promise<string>;
  getSession(token: string | undefined | null): Promise<SessionUser | null>;
  deleteSession(token: string | undefined | null): Promise<void>;
  reassignSessions(fromMemberId: string, toMemberId: string): Promise<void>;
  getLinkedGoogleEmail(memberId: string): Promise<string | null>;
  getSetting(key: string): Promise<string | null>;
  getSettingRow(key: string): Promise<DbSettingRow | null>;
  setSetting(key: string, value: string, updatedAt?: number): Promise<void>;
  deleteSetting(key: string): Promise<void>;
  listSettings(): Promise<DbSettingRow[]>;
  close(): void;
}
