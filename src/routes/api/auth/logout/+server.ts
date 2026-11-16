import type { RequestHandler } from './$types';
import { clearSessionCookie, jsonOk } from '$lib/server/http';

export const POST: RequestHandler = async (event) => {
  const token = event.cookies.get('sid');
  event.locals.runtime.db.deleteSession(token);
  clearSessionCookie(event);
  return jsonOk({ ok: true });
};
