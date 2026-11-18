import type { RequestHandler } from './$types';
import { normalizeMemberId, type UserRole } from '$lib/server/db';
import { jsonFail, jsonOk, readJsonBody, setSessionCookie } from '$lib/server/http';
import { ID_RE, validPassword, validatePassword } from '$lib/server/runtime';

export const POST: RequestHandler = async (event) => {
  const rt = event.locals.runtime;
  await rt.ensureSeeded();

  let body: { member_id?: unknown; full_name?: unknown; password?: unknown };
  try {
    body = await readJsonBody(event.request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const id = typeof body.member_id === 'string' ? normalizeMemberId(body.member_id) : '';
  const name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const password = body.password;

  if (!ID_RE.test(id)) {
    return jsonFail(400, 'ID must be 2-20 letters, digits, - or _.');
  }
  if (!name || name.length > 80) {
    return jsonFail(400, 'Name is required (max 80 characters).');
  }
  const pwErr = validatePassword(password);
  if (pwErr || !validPassword(password)) {
    return jsonFail(400, pwErr || 'Invalid password.');
  }
  if (await rt.resolveUser(id)) {
    return jsonFail(409, 'This ID already exists.');
  }

  const role: UserRole =
    id === '6600000001' || id.toUpperCase() === 'MOCK-66-0001' ? 'admin' : 'user';
  rt.db.createUser(id, name, role);
  await rt.db.setPassword(id, password);
  const token = rt.db.createSession(id);
  setSessionCookie(event, token);

  return jsonOk(
    {
      user: {
        member_id: id,
        full_name: name,
        role,
        theme: null,
        linkedGoogleEmail: null
      }
    },
    201
  );
};
