import type { RequestEvent } from '@sveltejs/kit';
import { SESSION_MS } from './db';

export function jsonOk(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

export function jsonFail(status: number, error: string, headers: Record<string, string> = {}): Response {
  return jsonOk({ error }, status, headers);
}

export async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 20000) {
    throw Object.assign(new Error('too large'), { code: 413 });
  }
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw Object.assign(new Error('bad json'), { code: 400 });
  }
}

export function isSecureRequest(event: RequestEvent): boolean {
  return event.url.protocol === 'https:' || event.request.headers.get('x-forwarded-proto') === 'https';
}

export function setSessionCookie(event: RequestEvent, token: string) {
  event.cookies.set('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS / 1000,
    secure: isSecureRequest(event)
  });
}

export function clearSessionCookie(event: RequestEvent) {
  event.cookies.set('sid', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: isSecureRequest(event)
  });
}

export function getClientIp(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  }
}
