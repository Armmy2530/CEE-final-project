// Loads and normalizes the canonical sample-sheets/*.csv (Mock-Data) dataset.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, daysBetween } from './dates';
import { KEY_FIELD, NORMALIZERS, parseCsv, rowsToObjects, TABS, type RawRow, type SheetData, type TabName } from './sheets';

export { parseCsv };

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveSampleSheetsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'sample-sheets'),
    path.resolve(THIS_DIR, '../../../sample-sheets'),
    path.resolve(THIS_DIR, '../../sample-sheets')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Events.csv'))) return dir;
  }
  throw new Error('Could not locate sample-sheets directory');
}

let cachedBase: SheetData | null = null;

function loadNormalizedCsvs(): SheetData {
  if (cachedBase) {
    return {
      Members: cachedBase.Members.map((r) => ({ ...r })),
      Events: cachedBase.Events.map((r) => ({ ...r })),
      Attendance: cachedBase.Attendance.map((r) => ({ ...r })),
      Budget: cachedBase.Budget.map((r) => ({ ...r }))
    };
  }

  const dir = resolveSampleSheetsDir();
  const data = {} as SheetData;

  for (const tab of TABS) {
    const csvPath = path.join(dir, `${tab}.csv`);
    const text = fs.readFileSync(csvPath, 'utf8');
    const matrix = parseCsv(text);
    const objects = rowsToObjects(matrix);
    const normalizer = NORMALIZERS[tab] as unknown as (r: RawRow, idx: number) => Record<string, unknown>;
    const key = KEY_FIELD[tab];
    (data as unknown as Record<TabName, unknown[]>)[tab] = objects
      .map((r, idx) => normalizer(r, idx))
      .filter((r) => Boolean(r[key]));
  }

  cachedBase = data;
  return {
    Members: data.Members.map((r) => ({ ...r })),
    Events: data.Events.map((r) => ({ ...r })),
    Attendance: data.Attendance.map((r) => ({ ...r })),
    Budget: data.Budget.map((r) => ({ ...r }))
  };
}

export function generateMock(today = '2026-11-16'): SheetData {
  const data = loadNormalizedCsvs();

  // Keep sample-sheets/Events.csv dates untouched when an upcoming Scheduled event already
  // falls within 0..3 days of `today` (e.g. AC-016 on 2026-11-18 for today=2026-11-16).
  const hasUpcoming = data.Events.some(
    (ev) => ev.status === 'Scheduled' && ev.date && daysBetween(today, ev.date) >= 0 && daysBetween(today, ev.date) <= 3
  );

  if (!hasUpcoming) {
    const ac16 = data.Events.find((ev) => ev.event_id === 'AC-016');
    if (ac16) {
      ac16.date = addDays(today, 2);
      ac16.end_date = addDays(today, 4);
    }
    const ac17 = data.Events.find((ev) => ev.event_id === 'AC-017');
    if (ac17) {
      ac17.date = addDays(today, 3);
      ac17.end_date = addDays(today, 4);
    }
  }

  return data;
}
