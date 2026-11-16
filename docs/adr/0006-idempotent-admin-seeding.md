# ADR-0006: Idempotent Member Seeding, Admin Promotion & Node/Bun Runtime Compatibility

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** Cross-runtime CSV resolution (`src/lib/server/mock.ts`), SQLite driver compatibility & idempotent seeding (`src/lib/server/db.ts`), runtime seeding coalescing (`src/lib/server/runtime.ts`), request-level seeding (`src/hooks.server.ts`, `src/routes/api/me/+server.ts`), case-insensitive member ID normalization (`src/routes/api/auth/*`, `src/routes/api/admin/users/+server.ts`), Vite execution scripts (`package.json`), and regression tests (`tests/app.test.ts`).

## Context

When starting the development server or authenticating for the first time, two interacting bugs prevented `MOCK-66-0001` from receiving `admin` privileges and prevented the 67 club members from being seeded into `data/app.db`:

1. **Node vs. Bun runtime failure during `ensureSeeded()`:**
   - `package.json` invoked `bun --bun vite dev`, which resolved `.bin/vite` (`#!/usr/bin/env node`), allowing Vite/SSR to execute under Node.js in environments without Bun prioritized in `PATH`.
   - Under Node.js, `src/lib/server/mock.ts` referenced Bun's non-standard `import.meta.dir` (`undefined` in Node), causing `path.resolve(import.meta.dir, ...)` inside `resolveSampleSheetsDir()` to throw `TypeError` inside `ensureSeeded()`. `ensureSeeded()` caught and logged the error, leaving the `users` table empty.
   - `src/lib/server/db.ts` statically imported `bun:sqlite`, which is unavailable if the server module is loaded under Node.js.

2. **Non-idempotent seeding & early Sign-up admin lockout:**
   - `seedFromMembers` returned early whenever `SELECT COUNT(*) FROM users` was `> 0`.
   - If a user clicked **Sign up** (`POST /api/auth/register`) with `MOCK-66-0001` while seeding had not yet run, `/api/auth/register` inserted `MOCK-66-0001` with `role = 'user'`. Every subsequent `seedFromMembers()` call then saw `COUNT(*) === 1 > 0`, skipped seeding `MOCK-66-0002..MOCK-66-0067`, and left `MOCK-66-0001` permanently stuck as `'user'` with zero admins in the database.
   - Additionally, `hooks.server.ts` and `GET /api/me` did not call `ensureSeeded()` before reading the session, so an already-signed-in user would not see their promoted role until logging out or hitting another route.

## Decision

1. **Cross-Runtime Path Resolution & SQLite Driver Loading:**
   - Replace `import.meta.dir` in `src/lib/server/mock.ts` with `path.dirname(fileURLToPath(import.meta.url))` from `node:url` so `resolveSampleSheetsDir()` works identically in both Bun and Node.js.
   - Update `src/lib/server/db.ts` to load `'bun:sqlite'` when `process.versions.bun` is present and fall back to `'node:sqlite'` (`DatabaseSync`) under Node.js via `createRequire(import.meta.url)`, using explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` transactions instead of driver-specific `db.transaction()`.
   - Update `package.json` `dev`, `build`, and `preview` scripts to execute `./node_modules/vite/bin/vite.js` directly with `bun --bun`, bypassing the `#!/usr/bin/env node` wrapper.

2. **Idempotent `seedFromMembers()` & Guaranteed Admin Promotion (`src/lib/server/db.ts`):**
   - Replace the `if (row.n > 0) return;` guard with `INSERT OR IGNORE INTO users (member_id, full_name, role, created_at) VALUES (?,?,?,?)` across all members in `Members` (skipping only if a case-insensitive match already exists).
   - Always execute `UPDATE users SET role = 'admin' WHERE LOWER(member_id) = LOWER(?)` for `members[0].member_id` (`MOCK-66-0001`), and promote the earliest user if `SELECT COUNT(*) FROM users WHERE role = 'admin'` is `0`.
   - In `POST /api/auth/register`, assign `role = 'admin'` when registering `MOCK-66-0001` even if seeding has not yet succeeded.

3. **Case-Insensitive Member ID Normalization & Request-Level Seeding:**
   - Export `normalizeMemberId(id)` in `src/lib/server/db.ts` (trims whitespace and uppercases `MOCK-...` / `ST...` IDs) and match `users` lookups with `LOWER(member_id) = LOWER(?)` across `setup`, `login`, `register`, and `admin/users`.
   - Coalesce concurrent `ensureSeeded()` calls in `src/lib/server/runtime.ts`, setting `seeded = true` only after `seedFromMembers()` succeeds.
   - Call `await runtime.ensureSeeded()` in `src/hooks.server.ts` before `getSession(token)` and in `GET /api/me`, so any existing session immediately reflects admin promotion on the next page refresh without logging out.

## Consequences

- **Positive:** `MOCK-66-0001` is guaranteed to hold `role = 'admin'` and all 67 club members from `sample-sheets/Members.csv` are seeded regardless of whether someone clicks **Sign up** first or runs under Bun or Node.
- **Positive:** Pre-existing `data/app.db` files with an early-registered `MOCK-66-0001` user self-heal automatically on the next request while preserving existing passwords, themes, and sessions.
- **Positive:** `bun run dev`, `bun run build`, and `bun run preview` reliably execute under the Bun runtime.
