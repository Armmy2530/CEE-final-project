import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { jsonFail } from '$lib/server/http';
import { resolveSampleSheetsDir } from '$lib/server/mock';
import { TABS, type TabName } from '$lib/server/sheets';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  const tab = url.searchParams.get('tab') as TabName | null;
  if (!tab || !TABS.includes(tab)) {
    return jsonFail(400, `Invalid tab. Must be one of: ${TABS.join(', ')}`);
  }

  const dir = resolveSampleSheetsDir();
  const csvPath = path.join(dir, `${tab}.csv`);
  const content = fs.readFileSync(csvPath, 'utf8');

  return new Response(content, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tab}.csv"`,
      'cache-control': 'no-store'
    }
  });
};
