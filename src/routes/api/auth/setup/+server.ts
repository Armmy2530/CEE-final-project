import type { RequestHandler } from './$types';
import { normalizeMemberId } from '$lib/server/db';
import { getClientIp, jsonFail, jsonOk, readJsonBody, setSessionCookie } from '$lib/server/http';
import { validPassword } from '$lib/server/runtime';

export const POST: RequestHandler = async (event) => {
  const rt = event.locals.runtime;
  await rt.ensureSeeded();

  let body: { member_id?: unknown; password?: unknown };
  try {
    body = await readJsonBody(event.request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const ip = getClientIp(event);
  if (!rt.loginLimit.take(`setup:${ip}`)) {
    return jsonFail(429, 'Too many attempts. Try again later.');
  }

  const { member_id, password } = body;
  if (!validPassword(password)) {
    return jsonFail(400, 'Password must be at least 8 characters.');
  }

  const id = typeof member_id === 'string' ? normalizeMemberId(member_id) : '';
  const u = id ? rt.db.getUser(id) : null;
  if (!u || u.pw_hash) {
    return jsonFail(400, 'This ID is not registered or already has a password. Ask an admin to reset it.');
  }

  await rt.db.setPassword(u.member_id, password);
  const token = rt.db.createSession(u.member_id);
  setSessionCookie(event, token);

  return jsonOk({
    user: {
      member_id: u.member_id,
      full_name: u.full_name,
      role: u.role,
      theme: u.theme
    }
  });
};
