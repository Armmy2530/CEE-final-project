export const STUDENT_ID_RE = /^\d{10}$/;

export function validateStudentId(rawId: unknown): string | null {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) {
    return 'Student ID is required (must be exactly 10 digits, e.g. 6600000001).';
  }
  if (!/^\d+$/.test(id)) {
    return 'Student ID must contain digits only (0-9), with exactly 10 digits (e.g. 6600000001).';
  }
  if (id.length !== 10) {
    return `Student ID must be exactly 10 digits (currently ${id.length} ${id.length === 1 ? 'digit' : 'digits'}, e.g. 6600000001).`;
  }
  return null;
}

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
