'use strict';
// Writes CSV files (mock data, dates relative to today) you can import into the 5 tabs of
// your Google Sheet: File > Import > Upload > "Replace current sheet".
const fs = require('node:fs');
const path = require('node:path');
const { generateMock } = require('../lib/mock');
const { todayInTz } = require('../lib/dates');

const data = generateMock(todayInTz(process.env.TZ_NAME || 'Asia/Bangkok'));
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const dir = path.join(__dirname, '..', 'sample-sheets');
fs.mkdirSync(dir, { recursive: true });
for (const [tab, rows] of Object.entries(data)) {
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `${tab}.csv`), csv);
  console.log('wrote', `sample-sheets/${tab}.csv`, rows.length, 'rows');
}
