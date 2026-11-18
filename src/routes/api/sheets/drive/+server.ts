import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

interface GoogleDriveErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
      extendedHelp?: string;
    }>;
    details?: Array<{
      reason?: string;
      metadata?: {
        activationUrl?: string;
      };
      links?: Array<{
        description?: string;
        url?: string;
      }>;
    }>;
  };
}

function parseDriveError(rawText: string): {
  message: string;
  isServiceDisabled: boolean;
  activationUrl: string;
} {
  let parsed: GoogleDriveErrorPayload | null = null;
  try {
    parsed = JSON.parse(rawText) as GoogleDriveErrorPayload;
  } catch {
    parsed = null;
  }

  const errObj = parsed?.error;
  const message = typeof errObj?.message === 'string' ? errObj.message.trim() : '';
  const errors = Array.isArray(errObj?.errors) ? errObj.errors : [];
  const details = Array.isArray(errObj?.details) ? errObj.details : [];

  const isServiceDisabled =
    details.some((d) => d?.reason === 'SERVICE_DISABLED') ||
    errors.some((e) => e?.reason === 'accessNotConfigured') ||
    /has not been used in project .* before or it is disabled/i.test(message) ||
    /SERVICE_DISABLED/i.test(message);

  let activationUrl = '';
  for (const d of details) {
    if (typeof d?.metadata?.activationUrl === 'string' && d.metadata.activationUrl.trim()) {
      activationUrl = d.metadata.activationUrl.trim();
      break;
    }
    if (Array.isArray(d?.links)) {
      const link = d.links.find(
        (l) => typeof l?.url === 'string' && /console\.(developers|cloud)\.google\.com/i.test(l.url)
      );
      if (link?.url) {
        activationUrl = link.url.trim();
        break;
      }
    }
  }
  if (!activationUrl) {
    const ext = errors.find((e) => typeof e?.extendedHelp === 'string' && e.extendedHelp.trim());
    if (ext?.extendedHelp) activationUrl = ext.extendedHelp.trim();
  }
  if (!activationUrl && message) {
    const match = message.match(
      /https:\/\/console\.(?:developers|cloud)\.google\.com\/apis\/api\/drive\.googleapis\.com\/overview\?[^\s,)'"]+/i
    );
    if (match) activationUrl = match[0];
  }

  return { message, isServiceDisabled, activationUrl };
}

export const GET: RequestHandler = async ({ locals, request, url }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  if (locals.user.role !== 'admin') {
    return jsonFail(403, 'Only admins can browse Google Drive spreadsheets');
  }
  const rt = locals.runtime;

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = (url.searchParams.get('access_token') || '').trim();
  const [providerTokenRaw, recentRaw, googleEmailRaw] = await Promise.all([
    rt.db.getSetting('google_provider_token'),
    rt.db.getSetting('recent_sheets'),
    rt.db.getSetting('google_connected_email')
  ]);
  const storedOAuthToken = (providerTokenRaw || '').trim();
  const envToken = (rt.env.GOOGLE_DRIVE_ACCESS_TOKEN || '').trim();
  const token = bearer || queryToken || storedOAuthToken || envToken;
  const usingStoredToken = Boolean(!bearer && !queryToken && storedOAuthToken);

  let recentSheets: unknown[] = [];
  try {
    if (recentRaw) recentSheets = JSON.parse(recentRaw);
  } catch {
    recentSheets = [];
  }

  const googleClientId = (rt.env.PUBLIC_GOOGLE_CLIENT_ID || '').trim();
  const supabaseOAuthAvailable = Boolean((rt.env.SUPABASE_URL || '').trim());
  const googleEmail = googleEmailRaw || '';

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
        await rt.db.setSetting('google_provider_token', '', now);
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

      const rawText = await res.text().catch(() => '');
      const parsed = parseDriveError(rawText);

      if (parsed.isServiceDisabled || (res.status === 403 && parsed.activationUrl)) {
        return jsonOk(
          {
            error:
              parsed.message ||
              'Google Drive API is disabled for this Google Cloud project. Enable it in Google Cloud Console and retry.',
            code: 'SERVICE_DISABLED',
            ...(parsed.activationUrl ? { activationUrl: parsed.activationUrl } : {})
          },
          403
        );
      }

      if (res.status === 403 && parsed.message) {
        return jsonFail(403, `Google Drive API responded 403: ${parsed.message}`);
      }

      return jsonFail(
        res.status === 401 ? 401 : 502,
        parsed.message
          ? `Google Drive API responded ${res.status}: ${parsed.message}`
          : `Google Drive API responded ${res.status}. Verify your OAuth token has drive.readonly access.`
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
