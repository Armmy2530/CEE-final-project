import type { RequestHandler } from './$types';
import { getClientIp, jsonFail, jsonOk, readJsonBody, setSessionCookie } from '$lib/server/http';
import { ID_RE, validPassword } from '$lib/server/runtime';

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

  const ip = getClientIp(event);
  if (!rt.loginLimit.take(`register:${ip}`)) {
    return jsonFail(429, 'Too many attempts. Try again later.');
  }

  const id = typeof body.member_id === 'string' ? body.member_id.trim() : '';
  const name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const password = body.password;

  if (!ID_RE.test(id)) {
    return jsonFail(400, 'ID must be 2-20 letters, digits, - or _.');
  }
  if (!name || name.length > 80) {
    return jsonFail(400, 'Name is required (max 80 characters).');
  }
  if (!validPassword(password)) {
    return jsonFail(400, 'Password must be at least 8 characters.');
  }
  if (rt.db.getUser(id)) {
    return jsonFail(409, 'This ID already exists.');
  }

  rt.db.createUser(id, name, 'user');
  await rt.db.setPassword(id, password);
  const token = rt.db.createSession(id);
  setSessionCookie(event, token);

  return jsonOk(
    {
      user: {
        member_id: id,
        full_name: name,
        role: 'user',
        theme: null
      }
    },
    201
  );
};
