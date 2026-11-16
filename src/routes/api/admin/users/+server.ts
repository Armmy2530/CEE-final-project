import type { RequestHandler } from './$types';
import { normalizeMemberId } from '$lib/server/db';
import { jsonFail, jsonOk, readJsonBody } from '$lib/server/http';
import { ID_RE } from '$lib/server/runtime';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  if (locals.user.role !== 'admin') return jsonFail(403, 'Admins only');
  return jsonOk({ users: locals.runtime.db.listUsers() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');
  if (locals.user.role !== 'admin') return jsonFail(403, 'Admins only');

  let body: { member_id?: unknown; full_name?: unknown; role?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const id = typeof body.member_id === 'string' ? normalizeMemberId(body.member_id) : '';
  const name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const role = body.role;

  if (!ID_RE.test(id)) return jsonFail(400, 'ID must be 2-20 letters, digits, - or _.');
  if (!name || name.length > 80) return jsonFail(400, 'Name is required (max 80 characters).');
  if (role !== 'admin' && role !== 'user') return jsonFail(400, 'Role must be admin or user.');
  if (locals.runtime.db.getUser(id)) return jsonFail(409, 'This ID already exists.');

  locals.runtime.db.createUser(id, name, role);
  return jsonOk({ users: locals.runtime.db.listUsers() }, 201);
};
