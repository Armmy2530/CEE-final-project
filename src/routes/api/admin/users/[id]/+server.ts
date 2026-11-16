import type { RequestHandler } from './$types';
import { jsonFail, jsonOk } from '$lib/server/http';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  if (locals.user.role !== 'admin') return jsonFail(403, 'Admins only');

  const id = decodeURIComponent(params.id);
  if (id === locals.user.member_id) return jsonFail(400, 'You cannot delete your own account.');

  const r = locals.runtime.db.deleteUser(id);
  if (r === 'not_found') return jsonFail(404, 'User not found.');
  if (r === 'last_admin') return jsonFail(400, 'Cannot delete the last admin.');

  return jsonOk({ users: locals.runtime.db.listUsers() });
};
