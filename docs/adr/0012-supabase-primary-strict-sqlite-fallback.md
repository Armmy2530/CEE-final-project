# ADR-0012: Supabase Primary Store with Strict 503 & Local SQLite Startup Fallback

- **Status:** Accepted
- **Date:** 2026-11-18
- **Supersedes / Updates:** Storage strategy in ADR-0008 §4 (replaces hybrid SQLite + Supabase dual-write sync)
- **Scope:** Persistence abstraction (`src/lib/server/store.ts`, `src/lib/server/auth-crypto.ts`), Supabase strict adapter (`src/lib/server/supabase.ts`), SQLite fallback adapter (`src/lib/server/db.ts`), single-store runtime initialization (`src/lib/server/runtime.ts`), centralized HTTP 503 error mapping (`src/hooks.server.ts`), UI status badge (`src/lib/components/SheetPickerModal.svelte`, `src/lib/types.ts`), and integration tests (`tests/app.test.ts`).

## Context

Under ADR-0008, the server always opened local SQLite (`data/app.db`) as its primary operational database and mirrored mutations asynchronously to Supabase (`public-cee-v2`) via `trackSync` and `syncWithSupabase`. While helpful during initial prototyping, this hybrid dual-write model introduced two operational problems:

1. **Split-Brain Risk & Write Amplification:** Writing locally first and syncing asynchronously risked divergence between SQLite and Supabase across container restarts or concurrent requests.
2. **Silent Local Fallback on Cloud Outages:** If Supabase failed mid-request after startup, falling back to an ephemeral container's SQLite file could silently fork user accounts, password resets, or session invalidations.

The desired production architecture uses **Supabase exclusively** whenever it is configured and healthy at startup, reserves **local SQLite** strictly as an offline/local development fallback at startup, and returns an explicit **HTTP 503** error whenever a selected Supabase store fails during a request.

## Decision

1. **Async `AppStore` Interface & Shared Auth Crypto (`store.ts`, `auth-crypto.ts`):**
   - Extract password hashing (`scrypt`), session token hashing (`SHA-256`), ID normalization, and DB row types into `src/lib/server/auth-crypto.ts`.
   - Define a backend-agnostic async `AppStore` interface and `StoreUnavailableError` (`status = 503`) in `src/lib/server/store.ts`.

2. **Strict `SupabaseStore` Adapter (`src/lib/server/supabase.ts`):**
   - Fix `probe()` so `status` starts as `'unreachable'` when credentials are present and only transitions to `'connected'` on a `2xx` response, `'schema_missing'` on PostgREST `PGRST106` / `42P01`, or `'unreachable'` on network / 5xx failure.
   - Add `toStore()` and `createSupabaseStore(supa)` backed by `requestStrict()`, which throws `StoreUnavailableError` on any network timeout or non-`2xx` HTTP response.
   - Escape `%`, `_`, and `\` in PostgREST `ilike` filters and resolve sessions with a single embedded query (`sessions?select=...,users(...)`).

3. **SQLite Startup-Fallback Adapter (`src/lib/server/db.ts`):**
   - Preserve synchronous `openDb()` for unit tests and wrap it via `createSqliteStore(rawDb): AppStore` for local runtime fallback.

4. **Single-Store Startup Selection (`src/lib/server/runtime.ts`):**
   - Remove `pendingSyncs`, `trackSync`, `syncWithSupabase`, `saveSettingToSupabase`, `deleteSettingFromSupabase`, and `flushSync`.
   - Implement lazy `initStore()`: probe Supabase once at startup when configured; if `'connected'`, lock `activeStore` to `SupabaseStore` and **never open local SQLite**. Only open SQLite if Supabase is `'disabled'`, `'schema_missing'`, or `'unreachable'` at startup (or `:memory:` is configured for tests).
   - Once `SupabaseStore` is selected, runtime remains strictly bound to Supabase (`strict when selected`) for all subsequent requests.

5. **Centralized HTTP 503 Handling & Status Reporting (`src/hooks.server.ts`, `src/lib/components/SheetPickerModal.svelte`):**
   - Catch `StoreUnavailableError` in `hooks.server.ts` around `ensureSeeded()`, `resolveSession()`, and `resolve()` to return HTTP `503` (JSON for `/api/*`, plain text for SSR routes) with security headers.
   - Add `'unreachable'` to `SupabaseStatus` (`src/lib/types.ts`) and surface `Local SQLite (Supabase unreachable)` in `SheetPickerModal.svelte`.

## Consequences

- **Positive:** Single source of truth in production (zero SQLite/Supabase split-brain), faster container startup without bidirectional sync sweeps, explicit `503` errors during Supabase outages instead of silent local writes, and zero-config local fallback using SQLite when offline or unconfigured.
- **Trade-off:** All route handlers (`src/routes/api/**`) and runtime helpers (`resolveUser`, `getLinkedGoogleEmail`, `withLinkedGoogleEmail`) now `await` asynchronous `AppStore` calls.
- **Test Coverage:** Integration tests in `tests/app.test.ts` use an in-memory PostgREST fetch mock verifying Supabase exclusivity, strict HTTP `503` without SQLite failover on mid-request errors, and SQLite startup fallback on `schema_missing` and `unreachable`.
