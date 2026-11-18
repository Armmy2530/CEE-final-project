import path from 'node:path';
import { buildDashboard, type DashboardPayload } from './dashboard';
import { todayInTz } from './dates';
import {
  openDb,
  type AppDb,
  type DbUserRow,
  type SessionUser
} from './db';
import { createSqliteStore } from './db';
import { createSource, type MemberRecord, type SheetConfig } from './sheets';
import { StoreUnavailableError, type AppStore } from './store';
import { createSupabaseClient, createSupabaseStore, type SupabaseClient } from './supabase';
import type { DbBackend, SupabaseStatus } from '../types';
import {
  STUDENT_ID_RE,
  validPassword,
  validatePassword,
  validateStudentId
} from '../validation';

export const ID_RE = STUDENT_ID_RE;
export { STUDENT_ID_RE, validPassword, validatePassword, validateStudentId };
export { StoreUnavailableError, type AppStore };

export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    take(key: string): boolean {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) {
        hits.set(key, { n: 1, reset: now + windowMs });
        return true;
      }
      h.n += 1;
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      }
      return h.n <= max;
    },
    clear(key: string) {
      hits.delete(key);
    }
  };
}

export interface RuntimeOptions {
  env?: Record<string, string | undefined>;
  db?: AppDb;
  source?: ReturnType<typeof createSource> | Pick<ReturnType<typeof createSource>, 'getData' | 'mode'>;
  supabase?: SupabaseClient;
}

export function createRuntime({ env = process.env, db, source, supabase }: RuntimeOptions = {}) {
  let rawDb: AppDb | null = db || null;
  const tz = env.TZ_NAME || 'Asia/Bangkok';
  const loginLimit = createLimiter(8, 15 * 60 * 1000);
  const chatLimit = createLimiter(20, 60 * 1000);

  const shouldEnableSupabase =
    Boolean(supabase) ||
    (Boolean(env.SUPABASE_URL) &&
      Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY) &&
      env.DB_PATH !== ':memory:' &&
      !db?.isMemory);

  const supa: SupabaseClient =
    supabase ||
    createSupabaseClient({
      env: shouldEnableSupabase ? env : {}
    });

  let activeStore: AppStore | null = null;
  let initPromise: Promise<AppStore> | null = null;
  let sheetConfigRestored = false;
  let closed = false;

  function getOrOpenSqlite(): AppDb {
    if (!rawDb) {
      rawDb = openDb(env.DB_PATH || path.join(process.cwd(), 'data', 'app.db'));
    }
    return rawDb;
  }

  let sheetSource: ReturnType<typeof createSource>;

  async function restoreSheetConfig(store: AppStore) {
    if (sheetConfigRestored) return;
    try {
      const savedSheet = await store.getSetting('sheet_config');
      sheetConfigRestored = true;
      if (savedSheet && typeof sheetSource.setConfig === 'function') {
        const parsed = JSON.parse(savedSheet) as Partial<SheetConfig>;
        if (parsed && (parsed.mode === 'mock' || parsed.mode === 'google')) {
          sheetSource.setConfig({
            mode: parsed.mode,
            sheetId: String(parsed.sheetId || ''),
            sheetTitle: parsed.sheetTitle ? String(parsed.sheetTitle) : undefined
          });
        }
      }
    } catch (e) {
      if (e instanceof StoreUnavailableError) throw e;
      sheetConfigRestored = true;
    }
  }

  async function initStore(): Promise<AppStore> {
    if (activeStore) return activeStore;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let store: AppStore;
      if (supa.isEnabled()) {
        const status = await supa.probe();
        if (status === 'connected') {
          store = createSupabaseStore(supa);
        } else {
          store = createSqliteStore(getOrOpenSqlite());
        }
      } else {
        store = createSqliteStore(getOrOpenSqlite());
      }
      activeStore = store;
      await restoreSheetConfig(store);
      return store;
    })().finally(() => {
      initPromise = null;
    });
    return initPromise;
  }

  const database: AppStore = {
    get backend(): DbBackend {
      return getDbBackend();
    },
    get isMemory(): boolean {
      return activeStore ? activeStore.isMemory : Boolean(rawDb?.isMemory);
    },
    async seedFromMembers(members) {
      return (await initStore()).seedFromMembers(members);
    },
    async getUser(id) {
      return (await initStore()).getUser(id);
    },
    async listUsers() {
      return (await initStore()).listUsers();
    },
    async listAllUserRows() {
      return (await initStore()).listAllUserRows();
    },
    async upsertUserFromRemote(u) {
      return (await initStore()).upsertUserFromRemote(u);
    },
    async createUser(member_id, full_name, role) {
      return (await initStore()).createUser(member_id, full_name, role);
    },
    async setRole(id, role) {
      return (await initStore()).setRole(id, role);
    },
    async deleteUser(id) {
      return (await initStore()).deleteUser(id);
    },
    async setPassword(id, password) {
      return (await initStore()).setPassword(id, password);
    },
    async resetPassword(id) {
      return (await initStore()).resetPassword(id);
    },
    async setTheme(id, theme) {
      return (await initStore()).setTheme(id, theme);
    },
    async verifyPassword(id, password) {
      return (await initStore()).verifyPassword(id, password);
    },
    async createSession(member_id) {
      return (await initStore()).createSession(member_id);
    },
    async getSession(token) {
      return (await initStore()).getSession(token);
    },
    async deleteSession(token) {
      return (await initStore()).deleteSession(token);
    },
    async reassignSessions(fromMemberId, toMemberId) {
      return (await initStore()).reassignSessions(fromMemberId, toMemberId);
    },
    async getLinkedGoogleEmail(memberId) {
      return (await initStore()).getLinkedGoogleEmail(memberId);
    },
    async getSetting(key) {
      return (await initStore()).getSetting(key);
    },
    async getSettingRow(key) {
      return (await initStore()).getSettingRow(key);
    },
    async setSetting(key, value, updatedAt) {
      return (await initStore()).setSetting(key, value, updatedAt);
    },
    async deleteSetting(key) {
      return (await initStore()).deleteSetting(key);
    },
    async listSettings() {
      return (await initStore()).listSettings();
    },
    close() {
      if (closed) return;
      closed = true;
      if (activeStore) {
        activeStore.close();
      } else {
        rawDb?.close();
      }
    }
  };

  sheetSource = (source ||
    createSource({
      env,
      getAccessToken: () => database.getSetting('google_provider_token')
    })) as ReturnType<typeof createSource>;

  function getSupabaseStatus(): SupabaseStatus {
    return supa.getStatus();
  }

  function getDbBackend(): DbBackend {
    if (activeStore) return activeStore.backend;
    return supa.isEnabled() && supa.getStatus() === 'connected' ? 'supabase' : 'sqlite';
  }

  let seeded = false;
  let seeding: Promise<void> | null = null;

  const LEGACY_MOCK_ID_RE = /^MOCK-66-(\d{4})$/i;

  function mapLegacyMockId(id: string): string | null {
    const match = LEGACY_MOCK_ID_RE.exec(id.trim());
    if (!match) return null;
    const num = Number.parseInt(match[1], 10);
    if (!Number.isFinite(num) || num < 1 || num > 67) return null;
    return String(6600000000 + num);
  }

  async function migrateLegacyMockUsers(store: AppStore) {
    const allUsers = await store.listAllUserRows();
    const legacyRows = allUsers
      .map((u) => ({ oldUser: u, newId: mapLegacyMockId(u.member_id) }))
      .filter((entry): entry is { oldUser: DbUserRow; newId: string } => Boolean(entry.newId));

    const now = Date.now();

    for (const { oldUser, newId } of legacyRows) {
      const existingNew = await store.getUser(newId);
      const isPrimaryAdmin = newId === '6600000001';
      const merged: DbUserRow = existingNew
        ? {
            member_id: newId,
            full_name:
              oldUser.pw_hash || !existingNew.pw_hash
                ? oldUser.full_name || existingNew.full_name
                : existingNew.full_name,
            role:
              oldUser.role === 'admin' || existingNew.role === 'admin' || isPrimaryAdmin
                ? 'admin'
                : 'user',
            pw_hash: existingNew.pw_hash ?? oldUser.pw_hash,
            pw_salt: existingNew.pw_hash ? existingNew.pw_salt : oldUser.pw_salt,
            theme: existingNew.theme ?? oldUser.theme,
            created_at: Math.min(oldUser.created_at, existingNew.created_at)
          }
        : {
            member_id: newId,
            full_name: oldUser.full_name,
            role: isPrimaryAdmin ? 'admin' : oldUser.role,
            pw_hash: oldUser.pw_hash,
            pw_salt: oldUser.pw_salt,
            theme: oldUser.theme,
            created_at: oldUser.created_at
          };

      await store.upsertUserFromRemote(merged);
    }

    for (const { oldUser, newId } of legacyRows) {
      await store.reassignSessions(oldUser.member_id, newId);
    }

    const settings = await store.listSettings();
    for (const s of settings) {
      if (s.key.startsWith('google_user_map:')) {
        const mapped = mapLegacyMockId(s.value);
        if (mapped) {
          await store.setSetting(s.key, mapped, now);
          if (!(await store.getSetting(`user_google_email:${mapped}`))) {
            const emailLower = s.key.slice('google_user_map:'.length).trim().toLowerCase();
            if (emailLower) {
              await store.setSetting(`user_google_email:${mapped}`, emailLower, now);
            }
          }
        }
      } else if (s.key.startsWith('user_google_email:')) {
        const oldMemberId = s.key.slice('user_google_email:'.length);
        const mapped = mapLegacyMockId(oldMemberId);
        if (mapped) {
          const emailLower = s.value.trim().toLowerCase();
          if (emailLower && !(await store.getSetting(`user_google_email:${mapped}`))) {
            await store.setSetting(`user_google_email:${mapped}`, emailLower, now);
            await store.setSetting(`google_user_map:${emailLower}`, mapped, now);
          }
          await store.deleteSetting(s.key);
        }
      }
    }

    for (const { oldUser } of legacyRows) {
      await store.deleteUser(oldUser.member_id);
    }
  }

  async function cleanupLegacyGoogleUsers(primaryAdminId = '6600000001') {
    const store = await initStore();
    const targetAdmin = (await store.getUser(primaryAdminId)) || (await store.getUser('6600000001'));
    if (!targetAdmin) return;

    const allUsers = await store.listAllUserRows();
    const legacyUsers = allUsers
      .filter((u) => /^GOOGLE-/i.test(u.member_id))
      .map((u) => u.member_id);

    const legacyIds = new Set<string>(legacyUsers);
    const settings = await store.listSettings();
    for (const s of settings) {
      if (s.key.startsWith('google_user_map:') && /^GOOGLE-/i.test(s.value.trim())) {
        legacyIds.add(s.value.trim());
      }
    }

    if (!legacyIds.size) return;

    const now = Date.now();
    for (const legacyId of legacyIds) {
      await store.reassignSessions(legacyId, targetAdmin.member_id);

      for (const s of settings) {
        if (
          s.key.startsWith('google_user_map:') &&
          s.value.trim().toUpperCase() === legacyId.toUpperCase()
        ) {
          const emailLower = s.key.slice('google_user_map:'.length).trim().toLowerCase();
          if (emailLower) {
            await store.setSetting(`google_user_map:${emailLower}`, targetAdmin.member_id, now);
            await store.setSetting(`user_google_email:${targetAdmin.member_id}`, emailLower, now);
          }
        }
      }

      await store.deleteUser(legacyId);
    }
  }

  async function seedWithMembers(members: MemberRecord[]) {
    const store = await initStore();
    await migrateLegacyMockUsers(store);
    await store.seedFromMembers(members);
    const primaryAdminId = members[0]?.member_id;
    await cleanupLegacyGoogleUsers(primaryAdminId);
    seeded = true;
  }

  async function ensureSeeded() {
    if (seeded) return;
    if (seeding) return seeding;
    seeding = (async () => {
      try {
        await initStore();
        const r = await sheetSource.getData();
        await seedWithMembers(r.data.Members);
      } catch (e) {
        if (e instanceof StoreUnavailableError) {
          throw e;
        }
        console.error('seed:', (e as Error).message);
      } finally {
        seeding = null;
      }
    })();
    return seeding;
  }

  async function getLinkedGoogleEmail(memberId: string): Promise<string | null> {
    return (await initStore()).getLinkedGoogleEmail(memberId);
  }

  async function withLinkedGoogleEmail(
    u: Omit<SessionUser, 'linkedGoogleEmail'> & { linkedGoogleEmail?: string | null }
  ): Promise<SessionUser> {
    return {
      member_id: u.member_id,
      full_name: u.full_name,
      role: u.role,
      theme: u.theme,
      linkedGoogleEmail: await getLinkedGoogleEmail(u.member_id)
    };
  }

  async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
    if (!token) return null;
    return (await initStore()).getSession(token);
  }

  async function resolveUser(id: string): Promise<DbUserRow | null> {
    return (await initStore()).getUser(id);
  }

  async function getDashboard(force = false): Promise<DashboardPayload> {
    const store = await initStore();
    const r = await sheetSource.getData({ force });
    if (!seeded) {
      await seedWithMembers(r.data.Members);
    }
    const cfg = typeof sheetSource.getConfig === 'function' ? sheetSource.getConfig() : undefined;
    return {
      ...buildDashboard(r.data, todayInTz(tz)),
      meta: {
        source: r.source,
        fetchedAt: r.fetchedAt,
        stale: Boolean(r.stale),
        sheetId: cfg?.mode === 'google' ? cfg.sheetId : undefined,
        sheetTitle: cfg?.mode === 'google' ? cfg.sheetTitle : undefined,
        dbBackend: store.backend,
        supabaseStatus: getSupabaseStatus()
      }
    };
  }

  async function setSetting(key: string, value: string, updatedAt = Date.now()) {
    await database.setSetting(key, value, updatedAt);
  }

  return {
    env,
    db: database,
    source: sheetSource,
    supabase: supa,
    tz,
    loginLimit,
    chatLimit,
    initStore,
    ensureSeeded,
    cleanupLegacyGoogleUsers,
    getLinkedGoogleEmail,
    withLinkedGoogleEmail,
    resolveSession,
    resolveUser,
    getDashboard,
    getDbBackend,
    getSupabaseStatus,
    setSetting
  };
}

export type AppRuntime = ReturnType<typeof createRuntime>;

let singleton: AppRuntime | null = null;

export function getRuntime(): AppRuntime {
  if (!singleton) singleton = createRuntime();
  return singleton;
}

export function setRuntimeForTesting(rt: AppRuntime | null) {
  singleton = rt;
}
