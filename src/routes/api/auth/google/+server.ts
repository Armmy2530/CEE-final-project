import type { RequestHandler } from './$types';
import type { SessionUser } from '$lib/server/db';
import { jsonFail, jsonOk, readJsonBody, setSessionCookie } from '$lib/server/http';

const GOOGLE_OAUTH_SCOPES =
  'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly';

interface SupabaseAuthUser {
  id?: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const supaUrl = (locals.runtime.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!supaUrl) {
    return jsonFail(400, 'SUPABASE_URL is not configured in .env');
  }

  const intent = url.searchParams.get('intent') === 'drive' ? 'drive' : 'login';
  const explicitRedirect = (url.searchParams.get('redirect_to') || '').trim();
  const callbackUrl = explicitRedirect || `${url.origin}/auth/callback?intent=${intent}`;

  const authUrl = new URL(`${supaUrl}/auth/v1/authorize`);
  authUrl.searchParams.set('provider', 'google');
  authUrl.searchParams.set('redirect_to', callbackUrl);
  authUrl.searchParams.set('scopes', GOOGLE_OAUTH_SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const authorizeUrl = authUrl.toString();
  if (url.searchParams.get('json') === '1') {
    return jsonOk({ url: authorizeUrl });
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl,
      'cache-control': 'no-store'
    }
  });
};

export const POST: RequestHandler = async (event) => {
  const rt = event.locals.runtime;
  await rt.ensureSeeded();

  const supaUrl = (rt.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!supaUrl) {
    return jsonFail(400, 'SUPABASE_URL is not configured in .env');
  }

  let body: {
    access_token?: unknown;
    provider_token?: unknown;
    provider_refresh_token?: unknown;
    intent?: unknown;
  };
  try {
    body = await readJsonBody(event.request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
  const providerToken = typeof body.provider_token === 'string' ? body.provider_token.trim() : '';
  if (!accessToken) {
    return jsonFail(400, 'Missing Supabase access_token');
  }

  const apiKey = (
    rt.env.SUPABASE_PUBLISHABLE_KEY ||
    rt.env.SUPABASE_SECRET_KEY ||
    rt.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();

  let supaUser: SupabaseAuthUser;
  try {
    const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        ...(apiKey ? { apikey: apiKey } : {}),
        Authorization: `Bearer ${accessToken}`
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!userRes.ok) {
      return jsonFail(401, 'Invalid or expired Supabase OAuth token');
    }
    supaUser = (await userRes.json()) as SupabaseAuthUser;
  } catch {
    return jsonFail(401, 'Invalid or expired Supabase OAuth token');
  }

  const supaId = String(supaUser?.id || '').trim();
  const email = String(supaUser?.email || '').trim();
  if (!supaId && !email) {
    return jsonFail(401, 'Invalid or expired Supabase OAuth token');
  }

  if (providerToken) {
    const now = Date.now();
    rt.db.setSetting('google_provider_token', providerToken, now);
    await rt.saveSettingToSupabase('google_provider_token', providerToken, now);
    rt.db.setSetting('google_connected_email', email, now);
    await rt.saveSettingToSupabase('google_connected_email', email, now);
  }

  if (event.locals.user) {
    await rt.flushSync();
    return jsonOk({
      user: event.locals.user,
      hasDriveAccess: Boolean(providerToken),
      googleEmail: email
    });
  }

  let userRow = null;
  if (email) {
    const mappedId = rt.db.getSetting(`google_user_map:${email.toLowerCase()}`);
    if (mappedId) {
      userRow = await rt.resolveUser(mappedId);
    }
  }

  if (!userRow) {
    const suffix =
      (supaId || email || 'USER')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 6)
        .toUpperCase() || 'USER';
    const memberId = `GOOGLE-${suffix}`;
    userRow = await rt.resolveUser(memberId);
    if (!userRow) {
      const displayName =
        (
          supaUser.user_metadata?.full_name ||
          supaUser.user_metadata?.name ||
          (email ? email.split('@')[0] : '') ||
          'Google User'
        )
          .trim()
          .slice(0, 80) || 'Google User';
      rt.db.createUser(memberId, displayName, 'admin');
      userRow = rt.db.getUser(memberId);
    }
    if (email && userRow) {
      rt.db.setSetting(`google_user_map:${email.toLowerCase()}`, userRow.member_id);
    }
  }

  if (!userRow) {
    return jsonFail(500, 'Could not provision Google OAuth user');
  }

  const sessionToken = rt.db.createSession(userRow.member_id);
  await rt.flushSync();
  setSessionCookie(event, sessionToken);

  const sessionUser: SessionUser = {
    member_id: userRow.member_id,
    full_name: userRow.full_name,
    role: userRow.role,
    theme: userRow.theme
  };

  return jsonOk({
    user: sessionUser,
    hasDriveAccess: Boolean(providerToken),
    googleEmail: email
  });
};
