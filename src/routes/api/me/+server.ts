import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals, cookies }) => {
  await locals.runtime.ensureSeeded();
  const token = cookies.get('sid');
  const user = token ? await locals.runtime.resolveSession(token) : locals.user;
  if (!user) return jsonFail(401, 'Not signed in');
  locals.user = user;
  return jsonOk({ user });
};
