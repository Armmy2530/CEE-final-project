// Project-name search with relevance ranking.

// Lower-case, NFKC, strip Latin accents only (never Thai tone marks), collapse spaces.
export function norm(s: unknown): string {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function isSubsequence(t: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < t.length; j++) if (s[j] === t[i]) i++;
  return i === t.length;
}

// Score one query token against a (normalized) name. 0 = no match.
function scoreToken(tok: string, name: string, words: string[]): number {
  if (name === tok) return 100;
  if (name.indexOf(tok) === 0) return 92;
  for (let w = 0; w < words.length; w++) {
    if (words[w].indexOf(tok) === 0) return 82 - Math.min(w, 5);
  }
  const pos = name.indexOf(tok);
  if (pos > 0) return 66 - Math.min(pos, 20) / 2;
  if (tok.length >= 3) {
    const maxD = tok.length <= 5 ? 1 : 2;
    let best = maxD + 1;
    for (let w = 0; w < words.length; w++) {
      const d = Math.min(lev(tok, words[w], maxD), lev(tok, words[w].slice(0, tok.length), maxD));
      if (d < best) best = d;
    }
    if (best <= maxD) return 48 - best * 10;
  }
  if (tok.length >= 3 && isSubsequence(tok, name)) return 20;
  return 0;
}

// Returns 0 when the query does not match; higher = more relevant.
export function score(query: string, name: string): number {
  const q = norm(query);
  const n = norm(name);
  if (!q) return 1;
  const words = n.split(' ');
  const toks = q.split(' ');
  let total = 0;
  for (let i = 0; i < toks.length; i++) {
    const s = scoreToken(toks[i], n, words);
    if (!s) return 0; // every word of the query must match something
    total += s;
  }
  let avg = total / toks.length;
  if (n.indexOf(q) === 0) avg += 6; // whole phrase at the start of the name
  else if (n.indexOf(q) > 0) avg += 3;
  return avg;
}

// Best match first, ties by newest date.
export function rank<T>(
  items: T[],
  query: string,
  getName: (item: T) => string = (x) => String((x as Record<string, unknown>).title ?? ''),
  getDate: (item: T) => string = (x) => String((x as Record<string, unknown>).date ?? '')
): T[] {
  if (!norm(query)) return items.slice();
  return items
    .map((it) => ({ it, s: score(query, getName(it)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || (getDate(b.it) > getDate(a.it) ? 1 : -1))
    .map((r) => r.it);
}

export const ProjectSearch = { norm, score, rank };
