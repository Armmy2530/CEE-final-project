import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  const rt = locals.runtime;
  const force =
    url.searchParams.get('refresh') === '1' && rt.chatLimit.take(`refresh:${locals.user.member_id}`);
  try {
    return jsonOk(await rt.getDashboard(force));
  } catch (e) {
    console.error('dashboard:', (e as Error).message);
    return jsonFail(502, 'Could not load data from Google Sheets.');
  }
};
