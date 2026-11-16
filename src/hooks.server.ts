import type { Handle } from '@sveltejs/kit';
import { jsonFail } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';

export const handle: Handle = async ({ event, resolve }) => {
  const runtime = getRuntime();
  event.locals.runtime = runtime;

  await runtime.ensureSeeded();
  const token = event.cookies.get('sid');
  event.locals.user = await runtime.resolveSession(token);

  const isApi = event.url.pathname.startsWith('/api/');
  const unsafe = event.request.method !== 'GET' && event.request.method !== 'HEAD';

  if (isApi && unsafe) {
    const ct = event.request.headers.get('content-type') || '';
    if (!ct.startsWith('application/json') && event.request.method !== 'DELETE') {
      const res = jsonFail(415, 'JSON required');
      res.headers.set('x-content-type-options', 'nosniff');
      res.headers.set('referrer-policy', 'same-origin');
      res.headers.set('x-frame-options', 'DENY');
      return res;
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
        const res = jsonFail(403, 'Bad origin');
        res.headers.set('x-content-type-options', 'nosniff');
        res.headers.set('referrer-policy', 'same-origin');
        res.headers.set('x-frame-options', 'DENY');
        return res;
      }
    }
  }

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

  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'same-origin');
  response.headers.set('x-frame-options', 'DENY');
  return response;
};
