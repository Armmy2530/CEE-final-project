import type { RequestHandler } from './$types';
import { jsonFail, jsonOk, readJsonBody } from '$lib/server/http';
import { extractSheetId, type SheetConfig } from '$lib/server/sheets';

export interface RecentSheetItem {
  sheetId: string;
  sheetTitle: string;
  connectedAt: number;
}

function readRecentSheets(raw: string | null): RecentSheetItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.sheetId === 'string' && x.sheetId.trim())
      .map((x) => ({
        sheetId: String(x.sheetId).trim(),
        sheetTitle: String(x.sheetTitle || x.sheetId).trim(),
        connectedAt: Number(x.connectedAt) || 0
      }));
  } catch {
    return [];
  }
}

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  const rt = locals.runtime;
  const cfg = rt.source.getConfig();
  const recentSheets = readRecentSheets(rt.db.getSetting('recent_sheets'));

  return jsonOk({
    mode: cfg.mode,
    sheetId: cfg.sheetId,
    sheetTitle: cfg.sheetTitle || '',
    hasGoogleApiKey: Boolean((rt.env.GOOGLE_API_KEY || '').trim()),
    googleClientId: (rt.env.PUBLIC_GOOGLE_CLIENT_ID || '').trim(),
    supabaseOAuthAvailable: Boolean((rt.env.SUPABASE_URL || '').trim()),
    hasDriveToken: Boolean((rt.db.getSetting('google_provider_token') || '').trim()),
    googleEmail: rt.db.getSetting('google_connected_email') || '',
    supabaseStatus: rt.getSupabaseStatus(),
    dbBackend: rt.getDbBackend(),
    recentSheets
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  const rt = locals.runtime;

  let body: { mode?: unknown; sheetUrlOrId?: unknown; sheetTitle?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const recentSheets = readRecentSheets(rt.db.getSetting('recent_sheets'));

  if (body.mode === 'mock') {
    const nextConfig: SheetConfig = { mode: 'mock', sheetId: '' };
    rt.source.setConfig(nextConfig);
    rt.db.setSetting('sheet_config', JSON.stringify(nextConfig));
    const res = await rt.source.getData({ force: true });
    return jsonOk({
      ok: true,
      config: rt.source.getConfig(),
      recentSheets,
      summary: {
        members: res.data.Members.length,
        events: res.data.Events.length,
        attendance: res.data.Attendance.length,
        budget: res.data.Budget.length
      }
    });
  }

  if (body.mode === 'google') {
    const rawInput = typeof body.sheetUrlOrId === 'string' ? body.sheetUrlOrId : '';
    const sheetId = extractSheetId(rawInput);
    if (!sheetId) {
      return jsonFail(400, 'Please enter a valid Google Sheet URL or Spreadsheet ID.');
    }
    const cleanTitle =
      typeof body.sheetTitle === 'string' ? body.sheetTitle.trim().slice(0, 120) : '';

    let validatedData;
    try {
      validatedData = await rt.source.validateGoogleSheet(sheetId);
    } catch (e) {
      return jsonFail(400, (e as Error).message || 'Could not load data from that Google Sheet.');
    }

    const nextConfig: SheetConfig = {
      mode: 'google',
      sheetId,
      sheetTitle: cleanTitle || undefined
    };
    rt.source.setConfig(nextConfig);
    rt.db.setSetting('sheet_config', JSON.stringify(nextConfig));

    const updatedRecent: RecentSheetItem[] = [
      {
        sheetId,
        sheetTitle: cleanTitle || `Google Sheet (${sheetId.slice(0, 8)}…)`,
        connectedAt: Date.now()
      },
      ...recentSheets.filter((s) => s.sheetId !== sheetId)
    ].slice(0, 8);
    rt.db.setSetting('recent_sheets', JSON.stringify(updatedRecent));

    // Warm the cache with the freshly validated sheet
    await rt.source.getData({ force: true });

    return jsonOk({
      ok: true,
      config: rt.source.getConfig(),
      recentSheets: updatedRecent,
      summary: {
        members: validatedData.Members.length,
        events: validatedData.Events.length,
        attendance: validatedData.Attendance.length,
        budget: validatedData.Budget.length
      }
    });
  }

  return jsonFail(400, 'Mode must be mock or google.');
};
