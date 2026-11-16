# ADR-0008: Svelte-Markdown Chat, 1-Button Theme Toggle, Calendar UX Overhaul, Supabase (`public-cee-v2`), & Google Drive Sheet Selector

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** AI chat rendering (`src/lib/components/ChatWidget.svelte`, `src/app.css`), theme toggle (`src/lib/components/Topbar.svelte`), calendar split-panel UX (`src/lib/components/Calendar.svelte`), hybrid Supabase PostgreSQL + SQLite persistence (`supabase/schema.sql`, `src/lib/server/supabase.ts`, `src/lib/server/db.ts`, `src/lib/server/runtime.ts`), and interactive Google Drive / Google Sheets selector (`src/lib/components/SheetPickerModal.svelte`, `src/lib/server/sheets.ts`, `/api/sheets/*`).

## Context

Following the Clubhouse UI redesign (ADR-0007), several usability and deployment enhancements were needed for production readiness:

1. **Markdown Chat Responses:** Assistant replies from OpenRouter AI and offline lookups often include bullet lists, bold headings, and inline code, which rendered as raw plain text in `ChatWidget.svelte`.
2. **Compact Theme Switcher:** The topbar used a 2-button `.theme-toggle` group instead of a clean single-button toggle.
3. **Calendar Readability:** The calendar placed the selected-day panel below the grid and rendered Week view as 7 cramped narrow columns, making multi-event days difficult to scan.
4. **Cloud Persistence on Ephemeral Hosts:** Local SQLite (`data/app.db`) does not survive container rebuilds on stateless hosts unless backed by a persistent database. The project needed hybrid PostgreSQL persistence in Supabase under the dedicated `"public-cee-v2"` schema while keeping `:memory:` SQLite fast and deterministic for tests.
5. **Runtime Google Sheet Selection:** Switching between built-in Mock-Data CSVs and a live Google Sheet required editing `.env` and configuring a `GOOGLE_API_KEY`. Users needed an interactive UI to browse Google Drive or paste any public Google Sheet link directly.

## Decision

1. **`@humanspeak/svelte-markdown` in `ChatWidget.svelte`:**
   - Install `@humanspeak/svelte-markdown` and render non-typing assistant messages inside `<div class="chat-bubble md-body"><SvelteMarkdown source={m.text} /></div>`.
   - Style `.chat-bubble.md-body` paragraphs, bold text, lists, and inline/block code to match Clubhouse typography.

2. **Single-Button Theme Toggle (`#themeToggle`) in `Topbar.svelte`:**
   - Replace the 2-button `.theme-toggle` group (`#themeLight` / `#themeDark`) with a single `.icon-button.theme-button` (`#themeToggle`) toggling `light` ↔ `dark` with `aria-pressed` and accessible labels.

3. **Calendar Split-Panel Readability Overhaul (`Calendar.svelte` & `src/app.css`):**
   - Introduce a desktop split layout (`.cal-split`: `minmax(0, 1fr)` grid + `340px` sticky `#calDetail` inspector) so selecting any day immediately displays its events alongside the grid.
   - Add status color legend pills (`Scheduled`, `Completed`, `Cancelled`), a period event summary pill, and a quick-jump month `<select>` in the calendar header.
   - Upgrade Month view (`#calGrid`) to a unified `1px` bordered grid (`min-height: 112px`), `26px` day badges (`.cal-num.is-today`), event count pills, and high-contrast `.chip` bars with compact `D{n}` multi-day tags.
   - Replace the cramped 7-column Week view agenda with a spacious horizontal Weekly Agenda List (`.cal-week-agenda-list`) paired with an `All 7 days` / `Days with events` filter toggle.

4. **Hybrid Supabase PostgreSQL (`public-cee-v2`) + SQLite Persistence:**
   - Provide `supabase/schema.sql` defining `"public-cee-v2".users`, `"public-cee-v2".sessions`, and `"public-cee-v2".app_settings`, plus PostgREST schema exposure grants.
   - Implement a PostgREST client in `src/lib/server/supabase.ts` using `Accept-Profile: public-cee-v2` and `Content-Profile: public-cee-v2`, with graceful `PGRST106` / `42P01` schema-missing fallback to local SQLite.
   - Add `app_settings` (`getSetting` / `setSetting`) to `src/lib/server/db.ts` and wire write-through sync + startup/on-the-fly hydration in `src/lib/server/runtime.ts`, `src/hooks.server.ts`, and auth routes.

5. **Interactive Google Drive / Google Sheets Selector (`SheetPickerModal.svelte` & `/api/sheets/*`):**
   - Upgrade `src/lib/server/sheets.ts` with `extractSheetId`, runtime `getConfig()` / `setConfig()`, `validateGoogleSheet()`, and keyless public `gviz/tq?tqx=out:csv&sheet=...` fallback when `GOOGLE_API_KEY` is absent or returns 400/403.
   - Add `/api/sheets/config` (`GET`/`POST`), `/api/sheets/drive` (`GET`), and `/api/sheets/export-csv` (`GET`), persisting active and recent sheets in `app_settings` (`sheet_config`, `recent_sheets`).
   - Add `SheetPickerModal.svelte` wired from the sidebar `.source-card`, `SummaryView`, and `ProjectsView`.

## Consequences

- **Positive:** AI answers render rich formatted Markdown; calendar scanning and day inspection require zero scrolling; users can switch data sources via Google Drive or public sheet links without touching `.env`; accounts, sessions, themes, and sheet configs persist across restarts when Supabase `"public-cee-v2"` is configured.
- **Positive:** Test suites using `:memory:` SQLite remain 100% offline, deterministic, and fast.
- **Migration Note:** Before enabling Supabase persistence on a new Supabase project, run `supabase/schema.sql` in the Supabase SQL Editor to create and expose `"public-cee-v2"`.
