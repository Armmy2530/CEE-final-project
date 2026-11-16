import type { RequestHandler } from './$types';
import { jsonOk } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals }) => {
  return jsonOk({ ok: true, dataSource: locals.runtime.source.mode });
};
