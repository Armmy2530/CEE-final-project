import type { RequestHandler } from './$types';
import { isSecureRequest, jsonFail, jsonOk, readJsonBody } from '$lib/server/http';

export const PATCH: RequestHandler = async (event) => {
  if (!event.locals.user) return jsonFail(401, 'Not signed in');

  let body: { theme?: unknown };
  try {
    body = await readJsonBody(event.request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  if (body.theme !== 'light' && body.theme !== 'dark') {
    return jsonFail(400, 'Theme must be light or dark.');
  }

  event.locals.runtime.db.setTheme(event.locals.user.member_id, body.theme);
  event.cookies.set('theme', body.theme, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: isSecureRequest(event)
  });

  return jsonOk({ theme: body.theme });
};
