import type { RequestHandler } from './$types';
import { normalizeMemberId } from '$lib/server/db';
import { jsonFail, jsonOk, readJsonBody, setSessionCookie } from '$lib/server/http';

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

  const { member_id, password } = body;
  const id = typeof member_id === 'string' ? normalizeMemberId(member_id) : '';

  if (id) await rt.resolveUser(id);
  const u = id && typeof password === 'string' ? await rt.db.verifyPassword(id, password) : null;

  if (!u) {
    const exists = id ? await rt.db.getUser(id) : null;
    return jsonFail(
      401,
      exists && !exists.pw_hash
        ? 'This account has no password yet. Use "Sign up" to create your password.'
        : 'Wrong ID or password.'
    );
  }

  const token = await rt.db.createSession(u.member_id);
  setSessionCookie(event, token);

  return jsonOk({ user: u });
};
