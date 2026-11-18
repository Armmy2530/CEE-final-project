import type { RequestHandler } from './$types';
import { normalizeMemberId } from '$lib/server/db';
import { jsonFail, jsonOk, readJsonBody } from '$lib/server/http';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  if (locals.user.role !== 'admin') return jsonFail(403, 'Admins only');

  let body: { role?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const role = body.role;
  if (role !== 'admin' && role !== 'user') {
    return jsonFail(400, 'Role must be admin or user.');
  }

  const id = normalizeMemberId(decodeURIComponent(params.id));
  if (id.toLowerCase() === locals.user.member_id.toLowerCase()) {
    return jsonFail(400, 'You cannot change your own role.');
  }

  const r = await locals.runtime.db.setRole(id, role);
  if (r === 'not_found') return jsonFail(404, 'User not found.');
  if (r === 'last_admin') return jsonFail(400, 'Cannot demote the last admin.');

  return jsonOk({ users: await locals.runtime.db.listUsers() });
};
