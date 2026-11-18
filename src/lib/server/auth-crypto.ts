import crypto from 'node:crypto';
import type { PublicUser, SessionUser, ThemeMode, UserRole } from '../types';

export type { PublicUser, SessionUser, ThemeMode, UserRole };

export interface DbUserRow {
  member_id: string;
  full_name: string;
  role: UserRole;
  pw_hash: string | null;
  pw_salt: string | null;
  theme: ThemeMode | null;
  created_at: number;
}

export interface DbSettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface DbSessionRow {
  token_hash: string;
  member_id: string;
  expires_at: number;
}

export const SESSION_MS = 7 * 24 * 3600 * 1000;

export const hashSessionToken = (s: string): string =>
  crypto.createHash('sha256').update(s).digest('hex');

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function normalizeMemberId(id: string): string {
  const trimmed = id.trim();
  if (/^(mock-|st)/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1 },
      (e, k) => (e ? reject(e) : resolve(k))
    )
  );
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt);
  return { hash: derived.toString('hex'), salt };
}

export async function verifyPasswordHash(
  password: string,
  pwHash: string | null,
  pwSalt: string | null
): Promise<boolean> {
  // Always spend the same work, even for unknown users, to avoid timing leaks.
  const salt = pwSalt || 'x'.repeat(32);
  const hash = await scrypt(password, salt);
  if (!pwHash) return false;
  const expected = Buffer.from(pwHash, 'hex');
  if (expected.length !== hash.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}
