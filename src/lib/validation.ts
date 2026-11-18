export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) {
    return 'Password must be 8-100 characters.';
  }
  if (!/\d/.test(password)) {
    return 'Password must contain at least one number.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter.';
  }
  return null;
}

export const validPassword = (p: unknown): p is string => validatePassword(p) === null;
