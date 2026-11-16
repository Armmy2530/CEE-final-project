# ADR-0005: Club Dashboard Rebranding & DB-Persisted Theme Preference

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** Branding (`src/app.html`, `src/lib/components/AuthView.svelte`, `src/lib/components/Topbar.svelte`, `package.json`, `README.md`), SQLite schema & migration (`src/lib/server/db.ts`), 3-layer theme synchronization (`src/app.html`, `src/hooks.server.ts`, `src/routes/+layout.server.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/api/me/theme/+server.ts`), and tests (`tests/app.test.ts`).

## Context

The dashboard was originally titled `ACADEMIC AC` across the browser `<title>`, login card, navigation topbar, package metadata, and README. To present a cleaner, club-agnostic identity while retaining the warm cream/amber visual design system (`src/app.css`), the user requested renaming the brand to **`Club Dashboard`**.

At the same time, Light/Dark theme preferences in the initial prototype existed solely in browser `localStorage`, which created two gaps:

1. **No cross-session / per-account persistence:** Logging in from a different browser or device reset the user's chosen theme, and unauthenticated or SSR responses could briefly render the wrong `data-theme` before client hydration.
2. **Legacy SQLite compatibility:** Any pre-existing `data/app.db` file created before the `theme` column was introduced would fail `SELECT ... theme` or `UPDATE users SET theme = ?` queries unless safely migrated at startup.

## Decision

1. **Brand Rename to `Club Dashboard`:**
   - Update `<title>` in `src/app.html` to `Club Dashboard`.
   - Update `<span class="brand-name">` in `src/lib/components/AuthView.svelte` and `src/lib/components/Topbar.svelte` to `Club Dashboard` while preserving the existing logo mark and warm cream/amber design tokens.
   - Update `package.json` (`description`) and `README.md` to reflect **Club Dashboard**, the **Bun + SvelteKit 2 (Svelte 5) + `bun:sqlite` + Google Sheets API v4 + OpenRouter AI** stack, and the ADR index.

2. **Database Schema & Safe Legacy Migration (`src/lib/server/db.ts`):**
   - Store `theme TEXT CHECK (theme IN ('light','dark'))` on the `users` table in `bun:sqlite`.
   - On `openDb(file)`, inspect `PRAGMA table_info(users)` and automatically execute `ALTER TABLE users ADD COLUMN theme TEXT CHECK (theme IN ('light','dark'))` if the `theme` column is missing, ensuring older `data/app.db` files migrate cleanly without manual intervention or data loss.

3. **Three-Layer Theme Synchronization:**
   - **Layer 1 — Zero-Flash First Paint (`src/app.html` + `src/hooks.server.ts`):**
     - `hooks.server.ts` resolves the SSR `data-theme` attribute from `event.locals.user?.theme` first, falling back to the `theme` cookie (`'light' | 'dark'`), and sets `%sveltekit.theme%` and `%sveltekit.themePref%` (`'1'` when an authoritative DB or cookie preference exists, `'0'` otherwise).
     - An inline CSP-nonced `<script nonce="%sveltekit.nonce%">` in `<head>` of `src/app.html` checks `data-theme-pref`; when `'0'`, it synchronously applies `localStorage.getItem('theme')` or `prefers-color-scheme: dark` before first paint so unauthenticated visits never flash the wrong theme.
   - **Layer 2 — Unauthenticated / Offline Persistence (`src/routes/+layout.svelte`):**
     - `themeCtx.set(t)` updates `document.documentElement[data-theme]` and persists `t` into `localStorage` (`theme`) for immediate client reactivity and unauthenticated/offline visits.
   - **Layer 3 — Per-Account Database Persistence (`PATCH /api/me/theme` + `enterApp`):**
     - Toggling the theme while signed in invokes `handleSetTheme` in `src/routes/+page.svelte`, calling `PATCH /api/me/theme` to validate (`'light' | 'dark'`), persist `users.theme` via `db.setTheme(...)`, and set the `theme` cookie.
     - On sign-in, setup, or registration, `enterApp(user)` in `src/routes/+page.svelte` hydrates `themeCtx.set(user.theme)` whenever the user has a saved database preference.

## Consequences

- **Positive:** Brand identity is unified as **Club Dashboard** across HTML `<title>`, UI headers, OpenRouter `X-Title`, package metadata, and documentation while preserving the established aesthetic.
- **Positive:** Pre-existing `data/app.db` files without a `theme` column upgrade automatically on startup with zero data loss.
- **Positive:** Authenticated users keep their Light/Dark preference across devices via SQLite + SSR, while unauthenticated visitors get zero-flash first paint via the CSP-nonced `<head>` script and `localStorage`.
- **Note:** Because `src/app.html` uses `%sveltekit.nonce%` with `csp.mode = 'auto'`, routes remain SSR-rendered rather than static-prerendered.
