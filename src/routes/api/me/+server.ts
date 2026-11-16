import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  return jsonOk({ user: locals.user });
};
