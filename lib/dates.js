'use strict';
// Date helpers. All dates are handled as 'YYYY-MM-DD' strings in the club's timezone.

function todayInTz(tz = 'Asia/Bangkok', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

const pad = (n) => String(n).padStart(2, '0');

// Accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, optionally followed by a time.
// Buddhist-era years (>2400) are converted to Gregorian.
function normalizeDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  let y, m, d, match;
  if ((match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) {
    [, y, m, d] = match;
  } else if ((match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) {
    [, d, m, y] = match;
  } else {
    return null;
  }
  y = Number(y); m = Number(m); d = Number(d);
  if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function dayNumber(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// Whole days from a to b (positive when b is after a).
function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

function addDays(str, n) {
  const dt = new Date((dayNumber(str) + n) * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

module.exports = { todayInTz, normalizeDate, daysBetween, addDays };
