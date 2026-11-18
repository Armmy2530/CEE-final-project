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

  const rawIntent = url.searchParams.get('intent');
  const intent = rawIntent === 'drive' ? 'drive' : rawIntent === 'link' ? 'link' : 'login';
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
  const emailLower = email.toLowerCase();
  if (!supaId && !email) {
    return jsonFail(401, 'Invalid or expired Supabase OAuth token');
  }

  const now = Date.now();

  // Signed-in user linking their Google account (or admin connecting Google Drive)
  if (event.locals.user) {
    if (!emailLower) {
      return jsonFail(400, 'Google account did not return an email address.');
    }

    const memberId = event.locals.user.member_id;
    const prevEmail = ((await rt.db.getSetting(`user_google_email:${memberId}`)) || '')
      .trim()
      .toLowerCase();
    if (prevEmail && prevEmail !== emailLower) {
      await rt.db.deleteSetting(`google_user_map:${prevEmail}`);
    }

    const prevMember = ((await rt.db.getSetting(`google_user_map:${emailLower}`)) || '').trim();
    if (prevMember && prevMember !== memberId) {
      await rt.db.deleteSetting(`user_google_email:${prevMember}`);
    }

    await rt.db.setSetting(`google_user_map:${emailLower}`, memberId, now);
    await rt.db.setSetting(`user_google_email:${memberId}`, emailLower, now);

    const isAdmin = event.locals.user.role === 'admin';
    if (providerToken && isAdmin) {
      await rt.db.setSetting('google_provider_token', providerToken, now);
      await rt.db.setSetting('google_connected_email', emailLower, now);
    }

    const updatedUser: SessionUser = {
      ...event.locals.user,
      linkedGoogleEmail: emailLower
    };
    return jsonOk({
      user: updatedUser,
      hasDriveAccess: Boolean(providerToken && isAdmin),
      googleEmail: emailLower
    });
  }

  // Signed-out user attempting Google Sign-In: MUST match an existing linked club account
  const mappedMemberId = emailLower
    ? ((await rt.db.getSetting(`google_user_map:${emailLower}`)) || '').trim()
    : '';
  const userRow = mappedMemberId ? await rt.resolveUser(mappedMemberId) : null;

  if (!userRow) {
    return jsonFail(
      403,
      `No club account is linked to ${email || 'this Google account'}. Sign in with your Member ID first, then click "Link Google account" in your profile menu.`
    );
  }

  if (emailLower && (await rt.getLinkedGoogleEmail(userRow.member_id)) !== emailLower) {
    await rt.db.setSetting(`user_google_email:${userRow.member_id}`, emailLower, now);
  }

  const isAdmin = userRow.role === 'admin';
  if (providerToken && isAdmin) {
    await rt.db.setSetting('google_provider_token', providerToken, now);
    await rt.db.setSetting('google_connected_email', emailLower, now);
  }

  const sessionToken = await rt.db.createSession(userRow.member_id);
  setSessionCookie(event, sessionToken);

  const sessionUser: SessionUser = {
    member_id: userRow.member_id,
    full_name: userRow.full_name,
    role: userRow.role,
    theme: userRow.theme,
    linkedGoogleEmail: emailLower || (await rt.getLinkedGoogleEmail(userRow.member_id))
  };

  return jsonOk({
    user: sessionUser,
    hasDriveAccess: Boolean(providerToken && isAdmin),
    googleEmail: emailLower
  });
};

export const DELETE: RequestHandler = async (event) => {
  if (!event.locals.user) return jsonFail(401, 'Not signed in');
  const rt = event.locals.runtime;
  await rt.ensureSeeded();

  const memberId = event.locals.user.member_id;
  const linkedEmail = ((await rt.db.getSetting(`user_google_email:${memberId}`)) || '')
    .trim()
    .toLowerCase();

  await rt.db.deleteSetting(`user_google_email:${memberId}`);

  if (linkedEmail) {
    await rt.db.deleteSetting(`google_user_map:${linkedEmail}`);
  }

  for (const s of await rt.db.listSettings()) {
    if (s.key.startsWith('google_user_map:') && s.value.trim().toLowerCase() === memberId.toLowerCase()) {
      await rt.db.deleteSetting(s.key);
    }
  }

  const updatedUser: SessionUser = {
    ...event.locals.user,
    linkedGoogleEmail: null
  };
  return jsonOk({ ok: true, user: updatedUser });
};
