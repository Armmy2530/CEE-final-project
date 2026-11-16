import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  if (locals.user.role !== 'admin') return jsonFail(403, 'Admins only');

  const id = decodeURIComponent(params.id);
  if (!locals.runtime.db.getUser(id)) return jsonFail(404, 'User not found.');

  locals.runtime.db.resetPassword(id);
  return jsonOk({ users: locals.runtime.db.listUsers() });
};
