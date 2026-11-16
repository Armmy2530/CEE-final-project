import type { DbSettingRow, DbUserRow, SessionUser, ThemeMode, UserRole } from './db';
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

  let status: SupabaseStatus = enabled ? 'connected' : 'disabled';
  let loggedSchemaMissing = false;

  function markSchemaMissing() {
    status = 'schema_missing';
    if (!loggedSchemaMissing) {
      loggedSchemaMissing = true;
      console.warn(
        `[supabase] Schema "${schema}" not exposed yet — run supabase/schema.sql in Supabase SQL Editor. Using local SQLite fallback.`
      );
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
    if (!enabled) return { ok: false, status: 0, data: null };

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
      console.warn(`[supabase] ${method} ${pathAndQuery} error:`, (err as Error).message);
      return { ok: false, status: 0, data: null, errorText: (err as Error).message };
    }
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
      `users?select=member_id,full_name,role,pw_hash,pw_salt,theme,created_at&member_id=ilike.${encodeURIComponent(memberId.trim())}&limit=1`
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
      theme: u.theme || 'dark',
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
    upsertSetting,
    deleteSetting
  };
}

export type SupabaseClient = ReturnType<typeof createSupabaseClient>;
