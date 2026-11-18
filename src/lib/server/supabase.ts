import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeMemberId,
  SESSION_MS,
  verifyPasswordHash,
  type DbSettingRow,
  type DbUserRow,
  type PublicUser,
  type SessionUser,
  type ThemeMode,
  type UserRole
} from './auth-crypto';
import type { MemberRecord } from './sheets';
import { StoreUnavailableError, type AppStore } from './store';
import type { SupabaseStatus } from '../types';

export interface SupabaseSessionRow {
  token_hash: string;
  member_id: string;
  created_at: number;
  expires_at: number;
}

export interface SupabaseClientOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

function escapeIlike(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function createSupabaseClient({
  env = process.env,
  fetchImpl = fetch
}: SupabaseClientOptions = {}) {
  const baseUrl = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  const schema = (env.SUPABASE_SCHEMA || 'public-cee-v2').trim() || 'public-cee-v2';
  const enabled = Boolean(baseUrl && apiKey);

  let status: SupabaseStatus = enabled ? 'unreachable' : 'disabled';
  let loggedSchemaMissing = false;
  let loggedUnreachable = false;

  function markSchemaMissing() {
    status = 'schema_missing';
    if (!loggedSchemaMissing) {
      loggedSchemaMissing = true;
      console.warn(
        `[supabase] Schema "${schema}" not exposed yet — run supabase/schema.sql in Supabase SQL Editor. Using local SQLite fallback.`
      );
    }
  }

  function markUnreachable(reason: string) {
    status = 'unreachable';
    if (!loggedUnreachable) {
      loggedUnreachable = true;
      console.warn(`[supabase] Unreachable (${reason}). Using local SQLite fallback.`);
    }
  }

  function isSchemaError(httpStatus: number, text: string): boolean {
    if (httpStatus === 404 || httpStatus === 406 || httpStatus === 400) {
      return (
        text.includes('PGRST106') ||
        text.includes('42P01') ||
        /invalid schema/i.test(text) ||
        /schema .* does not exist/i.test(text) ||
        /relation .* does not exist/i.test(text)
      );
    }
    return false;
  }

  async function request<T>(
    method: 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'DELETE',
    pathAndQuery: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ ok: boolean; status: number; data: T | null; errorText?: string }> {
    if (!enabled) return { ok: false, status: 0, data: null, errorText: 'Supabase disabled' };

    const headers: Record<string, string> = {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders
    };

    if (method === 'GET' || method === 'HEAD') {
      headers['Accept-Profile'] = schema;
    } else {
      headers['Content-Profile'] = schema;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetchImpl(`${baseUrl}/rest/v1/${pathAndQuery}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000)
      });

      const text = method === 'HEAD' ? '' : await res.text();

      if (!res.ok) {
        if (isSchemaError(res.status, text)) {
          markSchemaMissing();
        } else if (res.status >= 500) {
          console.warn(`[supabase] ${method} ${pathAndQuery} failed (${res.status}): ${text.slice(0, 200)}`);
        }
        return { ok: false, status: res.status, data: null, errorText: text };
      }

      status = 'connected';
      if (!text) return { ok: true, status: res.status, data: null };
      try {
        return { ok: true, status: res.status, data: JSON.parse(text) as T };
      } catch {
        return { ok: true, status: res.status, data: null };
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`[supabase] ${method} ${pathAndQuery} error:`, msg);
      return { ok: false, status: 0, data: null, errorText: msg };
    }
  }

  async function requestStrict<T>(
    method: 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'DELETE',
    pathAndQuery: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T | null> {
    const r = await request<T>(method, pathAndQuery, body, extraHeaders);
    if (!r.ok) {
      throw new StoreUnavailableError(
        `Supabase request failed (${r.status || 'network'}): ${r.errorText?.slice(0, 120) || 'unavailable'}`
      );
    }
    return r.data;
  }

  function normalizeRemoteUser(row: Record<string, unknown>): DbUserRow {
    const role: UserRole = row.role === 'admin' ? 'admin' : 'user';
    const theme: ThemeMode | null =
      row.theme === 'light' || row.theme === 'dark' ? row.theme : null;
    return {
      member_id: String(row.member_id || ''),
      full_name: String(row.full_name || ''),
      role,
      pw_hash: row.pw_hash ? String(row.pw_hash) : null,
      pw_salt: row.pw_salt ? String(row.pw_salt) : null,
      theme,
      created_at: Number(row.created_at) || Date.now()
    };
  }

  async function probe(): Promise<SupabaseStatus> {
    if (!enabled) {
      status = 'disabled';
      return status;
    }
    const r = await request<unknown[]>('GET', 'users?select=member_id&limit=1');
    if (r.ok) {
      status = 'connected';
    } else if (status !== 'schema_missing') {
      markUnreachable(r.errorText || `HTTP ${r.status}`);
    }
    return status;
  }

  async function listUsers(): Promise<DbUserRow[] | null> {
    const r = await request<Array<Record<string, unknown>>>(
      'GET',
      'users?select=member_id,full_name,role,pw_hash,pw_salt,theme,created_at&order=created_at.asc'
    );
    if (!r.ok || !Array.isArray(r.data)) return null;
    return r.data.map(normalizeRemoteUser).filter((u) => Boolean(u.member_id));
  }

  async function getUser(memberId: string): Promise<DbUserRow | null> {
    const r = await request<Array<Record<string, unknown>>>(
      'GET',
      `users?select=member_id,full_name,role,pw_hash,pw_salt,theme,created_at&member_id=ilike.${encodeURIComponent(escapeIlike(memberId.trim()))}&limit=1`
    );
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
    return normalizeRemoteUser(r.data[0]);
  }

  async function upsertUsers(users: DbUserRow[], ignoreDuplicates = false): Promise<boolean> {
    if (!enabled || !users.length || status === 'schema_missing') return false;
    const payload = users.map((u) => ({
      member_id: u.member_id,
      full_name: u.full_name,
      role: u.role,
      pw_hash: u.pw_hash,
      pw_salt: u.pw_salt,
      theme: u.theme,
      created_at: Number(u.created_at) || Date.now()
    }));
    const prefer = ignoreDuplicates
      ? 'resolution=ignore-duplicates,return=minimal'
      : 'resolution=merge-duplicates,return=minimal';
    const r = await request('POST', 'users?on_conflict=member_id', payload, { Prefer: prefer });
    return r.ok;
  }

  async function deleteUser(memberId: string): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request('DELETE', `users?member_id=eq.${encodeURIComponent(memberId)}`);
    return r.ok;
  }

  async function listSessions(nowMs = Date.now()): Promise<SupabaseSessionRow[] | null> {
    const r = await request<Array<Record<string, unknown>>>(
      'GET',
      `sessions?select=token_hash,member_id,created_at,expires_at&expires_at=gt.${Math.floor(nowMs)}`
    );
    if (!r.ok || !Array.isArray(r.data)) return null;
    return r.data.map((s) => ({
      token_hash: String(s.token_hash || ''),
      member_id: String(s.member_id || ''),
      created_at: Number(s.created_at) || Date.now(),
      expires_at: Number(s.expires_at) || 0
    }));
  }

  async function getSession(
    tokenHash: string,
    nowMs = Date.now()
  ): Promise<{ user: SessionUser; row: DbUserRow; expires_at: number } | null> {
    if (!enabled || status === 'schema_missing') return null;
    const r = await request<Array<Record<string, unknown>>>(
      'GET',
      `sessions?select=token_hash,member_id,expires_at&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${Math.floor(nowMs)}&limit=1`
    );
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
    const s = r.data[0];
    const memberId = String(s.member_id || '');
    if (!memberId) return null;
    const userRow = await getUser(memberId);
    if (!userRow) return null;
    return {
      user: {
        member_id: userRow.member_id,
        full_name: userRow.full_name,
        role: userRow.role,
        theme: userRow.theme,
        linkedGoogleEmail: null
      },
      row: userRow,
      expires_at: Number(s.expires_at) || 0
    };
  }

  async function upsertSession(session: SupabaseSessionRow): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request('POST', 'sessions?on_conflict=token_hash', session, {
      Prefer: 'resolution=merge-duplicates,return=minimal'
    });
    return r.ok;
  }

  async function deleteSession(tokenHash: string): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request('DELETE', `sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`);
    return r.ok;
  }

  async function deleteUserSessions(memberId: string): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request('DELETE', `sessions?member_id=eq.${encodeURIComponent(memberId)}`);
    return r.ok;
  }

  async function reassignSessions(fromMemberId: string, toMemberId: string): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request(
      'PATCH',
      `sessions?member_id=eq.${encodeURIComponent(fromMemberId)}`,
      { member_id: toMemberId },
      { Prefer: 'return=minimal' }
    );
    return r.ok;
  }

  async function listSettings(): Promise<DbSettingRow[] | null> {
    const r = await request<Array<Record<string, unknown>>>(
      'GET',
      'app_settings?select=key,value,updated_at'
    );
    if (!r.ok || !Array.isArray(r.data)) return null;
    return r.data.map((row) => ({
      key: String(row.key || ''),
      value: String(row.value || ''),
      updated_at: Number(row.updated_at) || Date.now()
    }));
  }

  async function getSettingRow(key: string): Promise<DbSettingRow | null> {
    const r = await request<Array<Record<string, unknown>>>(
      'GET',
      `app_settings?select=key,value,updated_at&key=eq.${encodeURIComponent(key)}&limit=1`
    );
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
    const row = r.data[0];
    return {
      key: String(row.key || ''),
      value: String(row.value || ''),
      updated_at: Number(row.updated_at) || Date.now()
    };
  }

  async function upsertSetting(key: string, value: string, updatedAt = Date.now()): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request(
      'POST',
      'app_settings?on_conflict=key',
      { key, value, updated_at: updatedAt },
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );
    return r.ok;
  }

  async function deleteSetting(key: string): Promise<boolean> {
    if (!enabled || status === 'schema_missing') return false;
    const r = await request('DELETE', `app_settings?key=eq.${encodeURIComponent(key)}`);
    return r.ok;
  }

  function toStore(): AppStore {
    const store: AppStore = {
      backend: 'supabase',
      isMemory: false,
      async seedFromMembers(members: Array<Pick<MemberRecord, 'member_id' | 'full_name'>>) {
        if (!members.length) return;
        const existingRows =
          (await requestStrict<Array<{ member_id: string; role: string }>>(
            'GET',
            'users?select=member_id,role&order=created_at.asc,member_id.asc'
          )) || [];
        const existingByLower = new Map(
          existingRows.map((r) => [r.member_id.trim().toLowerCase(), r])
        );
        const now = Date.now();

        const missing: DbUserRow[] = [];
        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          if (!existingByLower.has(m.member_id.trim().toLowerCase())) {
            missing.push({
              member_id: m.member_id,
              full_name: m.full_name,
              role: i === 0 ? 'admin' : 'user',
              pw_hash: null,
              pw_salt: null,
              theme: null,
              created_at: now
            });
          }
        }

        if (missing.length) {
          await requestStrict(
            'POST',
            'users?on_conflict=member_id',
            missing.map((u) => ({
              member_id: u.member_id,
              full_name: u.full_name,
              role: u.role,
              pw_hash: null,
              pw_salt: null,
              theme: null,
              created_at: u.created_at
            })),
            { Prefer: 'resolution=ignore-duplicates,return=minimal' }
          );
        }

        const primaryId = members[0].member_id;
        const existingPrimary = existingByLower.get(primaryId.trim().toLowerCase());
        if (existingPrimary && existingPrimary.role !== 'admin') {
          await requestStrict(
            'PATCH',
            `users?member_id=eq.${encodeURIComponent(existingPrimary.member_id)}`,
            { role: 'admin' },
            { Prefer: 'return=minimal' }
          );
        }

        const hasAdmin =
          existingRows.some((r) => r.role === 'admin') ||
          Boolean(members[0]?.member_id);
        if (!hasAdmin) {
          const first = existingRows[0];
          if (first) {
            await requestStrict(
              'PATCH',
              `users?member_id=eq.${encodeURIComponent(first.member_id)}`,
              { role: 'admin' },
              { Prefer: 'return=minimal' }
            );
          }
        }
      },
      async getUser(id) {
        const rows =
          (await requestStrict<Array<Record<string, unknown>>>(
            'GET',
            `users?select=member_id,full_name,role,pw_hash,pw_salt,theme,created_at&member_id=ilike.${encodeURIComponent(escapeIlike(id.trim()))}&limit=1`
          )) || [];
        return rows.length ? normalizeRemoteUser(rows[0]) : null;
      },
      async listUsers(): Promise<PublicUser[]> {
        const rows =
          (await requestStrict<Array<Record<string, unknown>>>(
            'GET',
            'users?select=member_id,full_name,role,pw_hash,theme,created_at&order=role.asc,member_id.asc'
          )) || [];
        return rows
          .map((u) => ({
            member_id: String(u.member_id || ''),
            full_name: String(u.full_name || ''),
            role: (u.role === 'admin' ? 'admin' : 'user') as UserRole,
            has_password: Boolean(u.pw_hash),
            theme: (u.theme === 'light' || u.theme === 'dark' ? u.theme : null) as ThemeMode | null,
            created_at: Number(u.created_at) || Date.now()
          }))
          .filter((u) => Boolean(u.member_id));
      },
      async listAllUserRows(): Promise<DbUserRow[]> {
        const rows =
          (await requestStrict<Array<Record<string, unknown>>>(
            'GET',
            'users?select=member_id,full_name,role,pw_hash,pw_salt,theme,created_at&order=created_at.asc,member_id.asc'
          )) || [];
        return rows.map(normalizeRemoteUser).filter((u) => Boolean(u.member_id));
      },
      async upsertUserFromRemote(u) {
        await requestStrict(
          'POST',
          'users?on_conflict=member_id',
          [
            {
              member_id: normalizeMemberId(u.member_id),
              full_name: u.full_name,
              role: u.role,
              pw_hash: u.pw_hash ?? null,
              pw_salt: u.pw_salt ?? null,
              theme: u.theme ?? null,
              created_at: Number(u.created_at) || Date.now()
            }
          ],
          { Prefer: 'resolution=merge-duplicates,return=minimal' }
        );
      },
      async createUser(member_id, full_name, role) {
        await requestStrict(
          'POST',
          'users',
          {
            member_id: normalizeMemberId(member_id),
            full_name,
            role,
            pw_hash: null,
            pw_salt: null,
            theme: null,
            created_at: Date.now()
          },
          { Prefer: 'return=minimal' }
        );
      },
      async deleteUser(id) {
        const u = await store.getUser(id);
        if (!u) return 'not_found';
        if (u.role === 'admin') {
          const admins =
            (await requestStrict<Array<{ member_id: string }>>(
              'GET',
              'users?select=member_id&role=eq.admin'
            )) || [];
          if (admins.length <= 1) return 'last_admin';
        }
        await requestStrict(
          'DELETE',
          `users?member_id=eq.${encodeURIComponent(u.member_id)}`
        );
        return 'ok';
      },
      async setPassword(id, password) {
        const u = await store.getUser(id);
        const targetId = u ? u.member_id : id.trim();
        const { hash, salt } = await hashPassword(password);
        await requestStrict(
          'PATCH',
          `users?member_id=eq.${encodeURIComponent(targetId)}`,
          { pw_hash: hash, pw_salt: salt },
          { Prefer: 'return=minimal' }
        );
        await requestStrict(
          'DELETE',
          `sessions?member_id=eq.${encodeURIComponent(targetId)}`
        );
      },
      async resetPassword(id) {
        const u = await store.getUser(id);
        const targetId = u ? u.member_id : id.trim();
        await requestStrict(
          'PATCH',
          `users?member_id=eq.${encodeURIComponent(targetId)}`,
          { pw_hash: null, pw_salt: null },
          { Prefer: 'return=minimal' }
        );
        await requestStrict(
          'DELETE',
          `sessions?member_id=eq.${encodeURIComponent(targetId)}`
        );
      },
      async setTheme(id, theme) {
        const u = await store.getUser(id);
        const targetId = u ? u.member_id : id.trim();
        await requestStrict(
          'PATCH',
          `users?member_id=eq.${encodeURIComponent(targetId)}`,
          { theme },
          { Prefer: 'return=minimal' }
        );
      },
      async verifyPassword(id, password) {
        const u = await store.getUser(id);
        const ok = await verifyPasswordHash(password, u?.pw_hash ?? null, u?.pw_salt ?? null);
        if (!u || !ok) return null;
        return {
          member_id: u.member_id,
          full_name: u.full_name,
          role: u.role,
          theme: u.theme,
          linkedGoogleEmail: await store.getLinkedGoogleEmail(u.member_id)
        };
      },
      async createSession(member_id) {
        const token = generateSessionToken();
        const now = Date.now();
        await requestStrict(
          'POST',
          'sessions?on_conflict=token_hash',
          {
            token_hash: hashSessionToken(token),
            member_id,
            created_at: now,
            expires_at: now + SESSION_MS
          },
          { Prefer: 'resolution=merge-duplicates,return=minimal' }
        );
        return token;
      },
      async getSession(token) {
        if (!token) return null;
        const tokenHash = hashSessionToken(token);
        const now = Math.floor(Date.now());
        const rows =
          (await requestStrict<Array<Record<string, unknown>>>(
            'GET',
            `sessions?select=token_hash,member_id,expires_at,users(member_id,full_name,role,theme)&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${now}&limit=1`
          )) || [];
        if (!rows.length) return null;
        const row = rows[0];
        const embedded = Array.isArray(row.users)
          ? (row.users[0] as Record<string, unknown> | undefined)
          : (row.users as Record<string, unknown> | undefined);
        let userMeta: Omit<SessionUser, 'linkedGoogleEmail'> | null = null;
        if (embedded && embedded.member_id) {
          userMeta = {
            member_id: String(embedded.member_id),
            full_name: String(embedded.full_name || ''),
            role: embedded.role === 'admin' ? 'admin' : 'user',
            theme:
              embedded.theme === 'light' || embedded.theme === 'dark' ? embedded.theme : null
          };
        } else {
          const memberId = String(row.member_id || '');
          if (!memberId) return null;
          const u = await store.getUser(memberId);
          if (!u) return null;
          userMeta = {
            member_id: u.member_id,
            full_name: u.full_name,
            role: u.role,
            theme: u.theme
          };
        }
        return {
          ...userMeta,
          linkedGoogleEmail: await store.getLinkedGoogleEmail(userMeta.member_id)
        };
      },
      async deleteSession(token) {
        if (!token) return;
        await requestStrict(
          'DELETE',
          `sessions?token_hash=eq.${encodeURIComponent(hashSessionToken(token))}`
        );
      },
      async reassignSessions(fromMemberId, toMemberId) {
        await requestStrict(
          'PATCH',
          `sessions?member_id=eq.${encodeURIComponent(fromMemberId)}`,
          { member_id: toMemberId },
          { Prefer: 'return=minimal' }
        );
      },
      async getLinkedGoogleEmail(memberId) {
        const val = await store.getSetting(`user_google_email:${memberId}`);
        const clean = (val || '').trim().toLowerCase();
        return clean || null;
      },
      async getSettingRow(key) {
        const rows =
          (await requestStrict<Array<Record<string, unknown>>>(
            'GET',
            `app_settings?select=key,value,updated_at&key=eq.${encodeURIComponent(key)}&limit=1`
          )) || [];
        if (!rows.length) return null;
        const r = rows[0];
        return {
          key: String(r.key || ''),
          value: String(r.value || ''),
          updated_at: Number(r.updated_at) || Date.now()
        };
      },
      async getSetting(key) {
        const row = await store.getSettingRow(key);
        return row ? row.value : null;
      },
      async setSetting(key, value, updatedAt = Date.now()) {
        await requestStrict(
          'POST',
          'app_settings?on_conflict=key',
          { key, value, updated_at: updatedAt },
          { Prefer: 'resolution=merge-duplicates,return=minimal' }
        );
      },
      async deleteSetting(key) {
        await requestStrict(
          'DELETE',
          `app_settings?key=eq.${encodeURIComponent(key)}`
        );
      },
      async listSettings() {
        const rows =
          (await requestStrict<Array<Record<string, unknown>>>(
            'GET',
            'app_settings?select=key,value,updated_at'
          )) || [];
        return rows.map((row) => ({
          key: String(row.key || ''),
          value: String(row.value || ''),
          updated_at: Number(row.updated_at) || Date.now()
        }));
      },
      close() {}
    };
    return store;
  }

  return {
    schema,
    isEnabled: () => enabled,
    getStatus: (): SupabaseStatus => status,
    probe,
    listUsers,
    getUser,
    upsertUsers,
    deleteUser,
    listSessions,
    getSession,
    upsertSession,
    deleteSession,
    deleteUserSessions,
    reassignSessions,
    listSettings,
    getSettingRow,
    upsertSetting,
    deleteSetting,
    toStore
  };
}

export type SupabaseClient = ReturnType<typeof createSupabaseClient>;

export function createSupabaseStore(supa: SupabaseClient): AppStore {
  if (typeof supa.toStore === 'function') {
    return supa.toStore();
  }
  const must = (ok: boolean, op: string) => {
    if (!ok) throw new StoreUnavailableError(`Supabase ${op} failed`);
  };
  const store: AppStore = {
    backend: 'supabase',
    isMemory: false,
    async seedFromMembers(members) {
      if (!members.length) return;
      const existing = await supa.listUsers();
      if (!existing) throw new StoreUnavailableError('Supabase listUsers failed');
      const byLower = new Map(existing.map((u) => [u.member_id.trim().toLowerCase(), u]));
      const now = Date.now();
      const missing: DbUserRow[] = [];
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!byLower.has(m.member_id.trim().toLowerCase())) {
          missing.push({
            member_id: m.member_id,
            full_name: m.full_name,
            role: i === 0 ? 'admin' : 'user',
            pw_hash: null,
            pw_salt: null,
            theme: null,
            created_at: now
          });
        }
      }
      if (missing.length) must(await supa.upsertUsers(missing, true), 'seedFromMembers');
      const primary = byLower.get(members[0].member_id.trim().toLowerCase());
      if (primary && primary.role !== 'admin') {
        must(await supa.upsertUsers([{ ...primary, role: 'admin' }], false), 'promoteAdmin');
      }
    },
    async getUser(id) {
      return supa.getUser(id);
    },
    async listUsers() {
      const rows = await supa.listUsers();
      if (!rows) throw new StoreUnavailableError('Supabase listUsers failed');
      return rows
        .map((u) => ({
          member_id: u.member_id,
          full_name: u.full_name,
          role: u.role,
          has_password: Boolean(u.pw_hash),
          theme: u.theme,
          created_at: u.created_at
        }))
        .sort((a, b) => a.role.localeCompare(b.role) || a.member_id.localeCompare(b.member_id));
    },
    async listAllUserRows() {
      const rows = await supa.listUsers();
      if (!rows) throw new StoreUnavailableError('Supabase listUsers failed');
      return rows;
    },
    async upsertUserFromRemote(u) {
      must(await supa.upsertUsers([u], false), 'upsertUserFromRemote');
    },
    async createUser(member_id, full_name, role) {
      must(
        await supa.upsertUsers(
          [
            {
              member_id: normalizeMemberId(member_id),
              full_name,
              role,
              pw_hash: null,
              pw_salt: null,
              theme: null,
              created_at: Date.now()
            }
          ],
          false
        ),
        'createUser'
      );
    },
    async deleteUser(id) {
      const u = await supa.getUser(id);
      if (!u) return 'not_found';
      if (u.role === 'admin') {
        const all = await supa.listUsers();
        if (!all) throw new StoreUnavailableError('Supabase listUsers failed');
        if (all.filter((x) => x.role === 'admin').length <= 1) return 'last_admin';
      }
      must(await supa.deleteUser(u.member_id), 'deleteUser');
      return 'ok';
    },
    async setPassword(id, password) {
      const u = await supa.getUser(id);
      if (!u) throw new StoreUnavailableError('User not found for password update');
      const { hash, salt } = await hashPassword(password);
      must(await supa.upsertUsers([{ ...u, pw_hash: hash, pw_salt: salt }], false), 'setPassword');
      must(await supa.deleteUserSessions(u.member_id), 'deleteUserSessions');
    },
    async resetPassword(id) {
      const u = await supa.getUser(id);
      if (!u) return;
      must(await supa.upsertUsers([{ ...u, pw_hash: null, pw_salt: null }], false), 'resetPassword');
      must(await supa.deleteUserSessions(u.member_id), 'deleteUserSessions');
    },
    async setTheme(id, theme) {
      const u = await supa.getUser(id);
      if (!u) return;
      must(await supa.upsertUsers([{ ...u, theme }], false), 'setTheme');
    },
    async verifyPassword(id, password) {
      const u = await supa.getUser(id);
      const ok = await verifyPasswordHash(password, u?.pw_hash ?? null, u?.pw_salt ?? null);
      if (!u || !ok) return null;
      return {
        member_id: u.member_id,
        full_name: u.full_name,
        role: u.role,
        theme: u.theme,
        linkedGoogleEmail: await store.getLinkedGoogleEmail(u.member_id)
      };
    },
    async createSession(member_id) {
      const token = generateSessionToken();
      const now = Date.now();
      must(
        await supa.upsertSession({
          token_hash: hashSessionToken(token),
          member_id,
          created_at: now,
          expires_at: now + SESSION_MS
        }),
        'createSession'
      );
      return token;
    },
    async getSession(token) {
      if (!token) return null;
      const res = await supa.getSession(hashSessionToken(token));
      if (!res) return null;
      return {
        ...res.user,
        linkedGoogleEmail: await store.getLinkedGoogleEmail(res.user.member_id)
      };
    },
    async deleteSession(token) {
      if (!token) return;
      must(await supa.deleteSession(hashSessionToken(token)), 'deleteSession');
    },
    async reassignSessions(fromMemberId, toMemberId) {
      must(await supa.reassignSessions(fromMemberId, toMemberId), 'reassignSessions');
    },
    async getLinkedGoogleEmail(memberId) {
      const val = await store.getSetting(`user_google_email:${memberId}`);
      const clean = (val || '').trim().toLowerCase();
      return clean || null;
    },
    async getSettingRow(key) {
      if (supa.getSettingRow) return supa.getSettingRow(key);
      const all = await supa.listSettings();
      if (!all) throw new StoreUnavailableError('Supabase listSettings failed');
      return all.find((s) => s.key === key) || null;
    },
    async getSetting(key) {
      const row = await store.getSettingRow(key);
      return row ? row.value : null;
    },
    async setSetting(key, value, updatedAt = Date.now()) {
      must(await supa.upsertSetting(key, value, updatedAt), 'upsertSetting');
    },
    async deleteSetting(key) {
      must(await supa.deleteSetting(key), 'deleteSetting');
    },
    async listSettings() {
      const rows = await supa.listSettings();
      if (!rows) throw new StoreUnavailableError('Supabase listSettings failed');
      return rows;
    },
    close() {}
  };
  return store;
}
