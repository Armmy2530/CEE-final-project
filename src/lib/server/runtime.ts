import path from 'node:path';
import { buildDashboard, type DashboardPayload } from './dashboard';
import { todayInTz } from './dates';
import {
  hashSessionToken,
  openDb,
  type AppDb,
  type DbUserRow,
  type SessionUser,
  type ThemeMode,
  type UserRole
} from './db';
import { createSource, type SheetConfig } from './sheets';
import { createSupabaseClient, type SupabaseClient } from './supabase';
import type { DbBackend, SupabaseStatus } from '../types';

export const ID_RE = /^[A-Za-z0-9_-]{2,20}$/;
export const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 100;

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
  const rawDb = db || openDb(env.DB_PATH || path.join(process.cwd(), 'data', 'app.db'));
  const sheetSource = (source ||
    createSource({
      env,
      getAccessToken: () => rawDb.getSetting('google_provider_token')
    })) as ReturnType<typeof createSource>;
  const tz = env.TZ_NAME || 'Asia/Bangkok';
  const loginLimit = createLimiter(8, 15 * 60 * 1000);
  const chatLimit = createLimiter(20, 60 * 1000);

  const shouldEnableSupabase =
    Boolean(supabase) ||
    (Boolean(env.SUPABASE_URL) &&
      Boolean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY) &&
      env.DB_PATH !== ':memory:' &&
      !rawDb.isMemory);

  const supa: SupabaseClient =
    supabase ||
    createSupabaseClient({
      env: shouldEnableSupabase ? env : {}
    });

  // Restore saved sheet_config from local SQLite on startup if present
  try {
    const savedSheet = rawDb.getSetting('sheet_config');
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
  } catch {
    // ignore malformed saved sheet_config
  }

  const pendingSyncs = new Set<Promise<unknown>>();
  function trackSync(p: Promise<unknown>) {
    pendingSyncs.add(p);
    p.finally(() => pendingSyncs.delete(p));
  }

  function isSupaConnected(): boolean {
    return supa.isEnabled() && supa.getStatus() === 'connected';
  }

  function getSupabaseStatus(): SupabaseStatus {
    return supa.getStatus();
  }

  function getDbBackend(): DbBackend {
    return isSupaConnected() ? 'supabase' : 'sqlite';
  }

  const database: AppDb = {
    ...rawDb,
    createUser(member_id: string, full_name: string, role: UserRole) {
      rawDb.createUser(member_id, full_name, role);
      const row = rawDb.getUser(member_id);
      if (row && isSupaConnected()) {
        trackSync(supa.upsertUsers([row], false));
      }
    },
    deleteUser(id: string) {
      const target = rawDb.getUser(id);
      const res = rawDb.deleteUser(id);
      if (res === 'ok' && target && isSupaConnected()) {
        trackSync(supa.deleteUser(target.member_id));
      }
      return res;
    },
    async setPassword(id: string, password: string) {
      await rawDb.setPassword(id, password);
      const row = rawDb.getUser(id);
      if (row && isSupaConnected()) {
        await supa.upsertUsers([row], false);
        await supa.deleteUserSessions(row.member_id);
      }
    },
    resetPassword(id: string) {
      rawDb.resetPassword(id);
      const row = rawDb.getUser(id);
      if (row && isSupaConnected()) {
        trackSync(
          (async () => {
            await supa.upsertUsers([row], false);
            await supa.deleteUserSessions(row.member_id);
          })()
        );
      }
    },
    setTheme(id: string, theme: ThemeMode) {
      rawDb.setTheme(id, theme);
      const row = rawDb.getUser(id);
      if (row && isSupaConnected()) {
        trackSync(supa.upsertUsers([row], false));
      }
    },
    createSession(member_id: string): string {
      const token = rawDb.createSession(member_id);
      if (isSupaConnected()) {
        const now = Date.now();
        trackSync(
          supa.upsertSession({
            token_hash: hashSessionToken(token),
            member_id,
            created_at: now,
            expires_at: now + rawDb.SESSION_MS
          })
        );
      }
      return token;
    },
    deleteSession(token: string | undefined | null) {
      rawDb.deleteSession(token);
      if (token && isSupaConnected()) {
        trackSync(supa.deleteSession(hashSessionToken(token)));
      }
    },
    setSetting(key: string, value: string, updatedAt = Date.now()) {
      rawDb.setSetting(key, value, updatedAt);
      if (isSupaConnected()) {
        trackSync(supa.upsertSetting(key, value, updatedAt));
      }
    },
    deleteSetting(key: string) {
      rawDb.deleteSetting(key);
      if (isSupaConnected()) {
        trackSync(supa.deleteSetting?.(key) ?? Promise.resolve(false));
      }
    }
  };

  let seeded = false;
  let seeding: Promise<void> | null = null;
  let supabaseSynced = false;

  async function syncWithSupabase(primaryAdminId?: string) {
    if (!supa.isEnabled() || supabaseSynced) return;
    const status = await supa.probe();
    if (status !== 'connected') return;

    supabaseSynced = true;

    const [remoteUsers, remoteSessions, remoteSettings] = await Promise.all([
      supa.listUsers(),
      supa.listSessions(),
      supa.listSettings()
    ]);

    if (remoteUsers && remoteUsers.length) {
      for (const ru of remoteUsers) {
        rawDb.upsertUserFromRemote(ru);
      }
    }
    if (primaryAdminId) {
      rawDb.seedFromMembers([{ member_id: primaryAdminId, full_name: '' }]);
    }

    if (remoteSessions && remoteSessions.length) {
      for (const rs of remoteSessions) {
        if (rawDb.getUser(rs.member_id)) {
          rawDb.upsertSessionFromRemote(rs.token_hash, rs.member_id, rs.expires_at);
        }
      }
    }

    if (remoteSettings && remoteSettings.length) {
      for (const rs of remoteSettings) {
        const local = rawDb.getSettingRow(rs.key);
        if (!local || rs.updated_at > local.updated_at) {
          rawDb.setSetting(rs.key, rs.value, rs.updated_at);
          if (rs.key === 'sheet_config' && typeof sheetSource.setConfig === 'function') {
            try {
              const parsed = JSON.parse(rs.value) as Partial<SheetConfig>;
              if (parsed && (parsed.mode === 'mock' || parsed.mode === 'google')) {
                sheetSource.setConfig({
                  mode: parsed.mode,
                  sheetId: String(parsed.sheetId || ''),
                  sheetTitle: parsed.sheetTitle ? String(parsed.sheetTitle) : undefined
                });
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }

    // Push local seeded users & settings up to Supabase
    const localUsers = rawDb.listAllUserRows();
    if (localUsers.length) {
      await supa.upsertUsers(localUsers, true);
      if (primaryAdminId) {
        const adminRow = rawDb.getUser(primaryAdminId);
        if (adminRow) await supa.upsertUsers([adminRow], false);
      }
    }

    const remoteSettingKeys = new Set((remoteSettings || []).map((s) => s.key));
    for (const ls of rawDb.listSettings()) {
      if (!remoteSettingKeys.has(ls.key)) {
        await supa.upsertSetting(ls.key, ls.value, ls.updated_at);
      }
    }
  }

  async function cleanupLegacyGoogleUsers(primaryAdminId = 'MOCK-66-0001') {
    const targetAdmin = rawDb.getUser(primaryAdminId) || rawDb.getUser('MOCK-66-0001');
    if (!targetAdmin) return;

    const legacyUsers = rawDb
      .listAllUserRows()
      .filter((u) => /^GOOGLE-/i.test(u.member_id))
      .map((u) => u.member_id);

    const legacyIds = new Set<string>(legacyUsers);
    for (const s of rawDb.listSettings()) {
      if (s.key.startsWith('google_user_map:') && /^GOOGLE-/i.test(s.value.trim())) {
        legacyIds.add(s.value.trim());
      }
    }

    if (!legacyIds.size) return;

    const now = Date.now();
    for (const legacyId of legacyIds) {
      rawDb.reassignSessions(legacyId, targetAdmin.member_id);
      if (isSupaConnected()) {
        await supa.reassignSessions?.(legacyId, targetAdmin.member_id);
      }

      for (const s of rawDb.listSettings()) {
        if (
          s.key.startsWith('google_user_map:') &&
          s.value.trim().toUpperCase() === legacyId.toUpperCase()
        ) {
          const emailLower = s.key.slice('google_user_map:'.length).trim().toLowerCase();
          if (emailLower) {
            database.setSetting(`google_user_map:${emailLower}`, targetAdmin.member_id, now);
            database.setSetting(`user_google_email:${targetAdmin.member_id}`, emailLower, now);
            if (isSupaConnected()) {
              await supa.upsertSetting(`google_user_map:${emailLower}`, targetAdmin.member_id, now);
              await supa.upsertSetting(`user_google_email:${targetAdmin.member_id}`, emailLower, now);
            }
          }
        }
      }

      rawDb.deleteUser(legacyId);
      if (isSupaConnected()) {
        await supa.deleteUser(legacyId);
      }
    }
  }

  async function ensureSeeded() {
    if (seeded) return;
    if (seeding) return seeding;
    seeding = (async () => {
      try {
        const r = await sheetSource.getData();
        database.seedFromMembers(r.data.Members);
        const primaryAdminId = r.data.Members[0]?.member_id;
        await syncWithSupabase(primaryAdminId);
        await cleanupLegacyGoogleUsers(primaryAdminId);
        seeded = true;
      } catch (e) {
        console.error('seed:', (e as Error).message);
      } finally {
        seeding = null;
      }
    })();
    return seeding;
  }

  function getLinkedGoogleEmail(memberId: string): string | null {
    return database.getLinkedGoogleEmail(memberId);
  }

  function withLinkedGoogleEmail(
    u: Omit<SessionUser, 'linkedGoogleEmail'> & { linkedGoogleEmail?: string | null }
  ): SessionUser {
    return {
      member_id: u.member_id,
      full_name: u.full_name,
      role: u.role,
      theme: u.theme,
      linkedGoogleEmail: getLinkedGoogleEmail(u.member_id)
    };
  }

  async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
    if (!token) return null;
    const local = database.getSession(token);
    if (local) return withLinkedGoogleEmail(local);
    if (isSupaConnected()) {
      const remote = await supa.getSession(hashSessionToken(token));
      if (remote) {
        rawDb.upsertUserFromRemote(remote.row);
        rawDb.upsertSessionFromRemote(hashSessionToken(token), remote.row.member_id, remote.expires_at);
        return withLinkedGoogleEmail(remote.user);
      }
    }
    return null;
  }

  async function resolveUser(id: string): Promise<DbUserRow | null> {
    const local = database.getUser(id);
    if (local) return local;
    if (isSupaConnected()) {
      const remote = await supa.getUser(id);
      if (remote) {
        rawDb.upsertUserFromRemote(remote);
        return rawDb.getUser(id);
      }
    }
    return null;
  }

  async function getDashboard(force = false): Promise<DashboardPayload> {
    const r = await sheetSource.getData({ force });
    if (!seeded) {
      database.seedFromMembers(r.data.Members);
      const primaryAdminId = r.data.Members[0]?.member_id;
      await syncWithSupabase(primaryAdminId);
      await cleanupLegacyGoogleUsers(primaryAdminId);
      seeded = true;
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
        dbBackend: getDbBackend(),
        supabaseStatus: getSupabaseStatus()
      }
    };
  }

  async function saveSettingToSupabase(key: string, value: string, updatedAt = Date.now()): Promise<boolean> {
    if (!isSupaConnected()) return false;
    return await supa.upsertSetting(key, value, updatedAt);
  }

  async function deleteSettingFromSupabase(key: string): Promise<boolean> {
    if (!isSupaConnected()) return false;
    return (await supa.deleteSetting?.(key)) ?? false;
  }

  function setSetting(key: string, value: string, updatedAt = Date.now()) {
    database.setSetting(key, value, updatedAt);
  }

  async function flushSync() {
    if (pendingSyncs.size) {
      await Promise.allSettled(Array.from(pendingSyncs));
    }
  }

  return {
    env,
    db: database,
    source: sheetSource,
    supabase: supa,
    tz,
    loginLimit,
    chatLimit,
    ensureSeeded,
    cleanupLegacyGoogleUsers,
    getLinkedGoogleEmail,
    withLinkedGoogleEmail,
    resolveSession,
    resolveUser,
    getDashboard,
    getDbBackend,
    getSupabaseStatus,
    saveSettingToSupabase,
    deleteSettingFromSupabase,
    setSetting,
    flushSync
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
