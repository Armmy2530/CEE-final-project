import path from 'node:path';
import { buildDashboard, type DashboardPayload } from './dashboard';
import { todayInTz } from './dates';
import { openDb, type AppDb } from './db';
import { createSource } from './sheets';

export const ID_RE = /^[A-Za-z0-9_-]{2,20}$/;
export const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 100;

export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    take(key: string): boolean {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) {
        hits.set(key, { n: 1, reset: now + windowMs });
        return true;
      }
      h.n += 1;
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      }
      return h.n <= max;
    },
    clear(key: string) {
      hits.delete(key);
    }
  };
}

export interface RuntimeOptions {
  env?: Record<string, string | undefined>;
  db?: AppDb;
  source?: ReturnType<typeof createSource>;
}

export function createRuntime({ env = process.env, db, source }: RuntimeOptions = {}) {
  const database = db || openDb(env.DB_PATH || path.join(process.cwd(), 'data', 'app.db'));
  const sheetSource = source || createSource({ env });
  const tz = env.TZ_NAME || 'Asia/Bangkok';
  const loginLimit = createLimiter(8, 15 * 60 * 1000);
  const chatLimit = createLimiter(20, 60 * 1000);
  let seeded = false;

  async function ensureSeeded() {
    if (seeded) return;
    try {
      const r = await sheetSource.getData();
      database.seedFromMembers(r.data.Members);
      seeded = true;
    } catch (e) {
      console.error('seed:', (e as Error).message);
    }
  }

  async function getDashboard(force = false): Promise<DashboardPayload> {
    const r = await sheetSource.getData({ force });
    if (!seeded) {
      database.seedFromMembers(r.data.Members);
      seeded = true;
    }
    return {
      ...buildDashboard(r.data, todayInTz(tz)),
      meta: { source: r.source, fetchedAt: r.fetchedAt, stale: Boolean(r.stale) }
    };
  }

  return {
    env,
    db: database,
    source: sheetSource,
    tz,
    loginLimit,
    chatLimit,
    ensureSeeded,
    getDashboard
  };
}

export type AppRuntime = ReturnType<typeof createRuntime>;

let singleton: AppRuntime | null = null;

export function getRuntime(): AppRuntime {
  if (!singleton) singleton = createRuntime();
  return singleton;
}

export function setRuntimeForTesting(rt: AppRuntime | null) {
  singleton = rt;
}
