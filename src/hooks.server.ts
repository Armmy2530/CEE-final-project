import type { Handle } from '@sveltejs/kit';
import { jsonFail } from '$lib/server/http';
import { getRuntime, StoreUnavailableError } from '$lib/server/runtime';

function withSecurityHeaders(res: Response): Response {
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'same-origin');
  res.headers.set('x-frame-options', 'DENY');
  return res;
}

export const handle: Handle = async ({ event, resolve }) => {
  const runtime = getRuntime();
  event.locals.runtime = runtime;

  const isApi = event.url.pathname.startsWith('/api/');
  const unsafe = event.request.method !== 'GET' && event.request.method !== 'HEAD';

  if (isApi && unsafe) {
    const ct = event.request.headers.get('content-type') || '';
    if (!ct.startsWith('application/json') && event.request.method !== 'DELETE') {
      return withSecurityHeaders(jsonFail(415, 'JSON required'));
    }
    const origin = event.request.headers.get('origin');
    const host = event.request.headers.get('host') || event.url.host;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== host) {
        return withSecurityHeaders(jsonFail(403, 'Bad origin'));
      }
    }
  }

  try {
    await runtime.ensureSeeded();
    const token = event.cookies.get('sid');
    event.locals.user = await runtime.resolveSession(token);

    const cookieTheme = event.cookies.get('theme');
    const hasThemePref = Boolean(
      event.locals.user?.theme || cookieTheme === 'light' || cookieTheme === 'dark'
    );
    const theme = event.locals.user?.theme || (cookieTheme === 'dark' ? 'dark' : 'light');

    const response = await resolve(event, {
      transformPageChunk: ({ html }) =>
        html
          .replace('%sveltekit.theme%', theme)
          .replace('%sveltekit.themePref%', hasThemePref ? '1' : '0')
    });

    return withSecurityHeaders(response);
  } catch (err) {
    if (err instanceof StoreUnavailableError) {
      if (isApi) {
        return withSecurityHeaders(jsonFail(err.status, err.message));
      }
      return withSecurityHeaders(
        new Response(err.message, {
          status: err.status,
          headers: { 'content-type': 'text/plain; charset=utf-8' }
        })
      );
    }
    throw err;
  }
};
