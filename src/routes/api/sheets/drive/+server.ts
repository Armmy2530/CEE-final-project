import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals, request, url }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  const rt = locals.runtime;

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = (url.searchParams.get('access_token') || '').trim();
  const storedOAuthToken = (rt.db.getSetting('google_provider_token') || '').trim();
  const envToken = (rt.env.GOOGLE_DRIVE_ACCESS_TOKEN || '').trim();
  const token = bearer || queryToken || storedOAuthToken || envToken;
  const usingStoredToken = Boolean(!bearer && !queryToken && storedOAuthToken);

  let recentSheets: unknown[] = [];
  try {
    const raw = rt.db.getSetting('recent_sheets');
    if (raw) recentSheets = JSON.parse(raw);
  } catch {
    recentSheets = [];
  }

  const googleClientId = (rt.env.PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  const supabaseOAuthAvailable = Boolean((rt.env.SUPABASE_URL || '').trim());
  const googleEmail = rt.db.getSetting('google_connected_email') || '';

  if (!token) {
    return jsonOk({
      files: [],
      recentSheets,
      hasDriveAccess: false,
      googleClientId,
      supabaseOAuthAvailable,
      googleEmail
    });
  }

  const driveUrl =
    'https://www.googleapis.com/drive/v3/files' +
    `?q=${encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}` +
    `&fields=${encodeURIComponent('files(id,name,modifiedTime,webViewLink,owners)')}` +
    '&orderBy=modifiedTime+desc&pageSize=25';

  try {
    const res = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      if (res.status === 401 && usingStoredToken) {
        const now = Date.now();
        rt.db.setSetting('google_provider_token', '', now);
        await rt.saveSettingToSupabase('google_provider_token', '', now);
        return jsonOk({
          files: [],
          recentSheets,
          hasDriveAccess: false,
          tokenExpired: true,
          googleClientId,
          supabaseOAuthAvailable,
          googleEmail
        });
      }
      return jsonFail(
        res.status === 401 ? 401 : 502,
        `Google Drive API responded ${res.status}. Verify your OAuth token has drive.readonly access.`
      );
    }
    const json = (await res.json()) as { files?: unknown[] };
    return jsonOk({
      files: json.files || [],
      recentSheets,
      hasDriveAccess: true,
      googleClientId,
      supabaseOAuthAvailable,
      googleEmail
    });
  } catch (e) {
    return jsonFail(502, `Could not reach Google Drive: ${(e as Error).message}`);
  }
};
