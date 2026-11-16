# Club Dashboard

Web dashboard for a student club committee built with **Bun + SvelteKit 2 (Svelte 5) + `bun:sqlite` + Google Sheets API v4 + OpenRouter AI**. Reads one Google Sheet (or the normalized `sample-sheets/*.csv` mock dataset) and provides summary metrics, interactive SVG charts, a Google Calendar-style Month & Week calendar, project details, automatic budget/upcoming alerts, database-persisted Light/Dark themes, 3-mode account authentication, and an OpenRouter AI chatbox.

> All data in this repo is **mock data** (`MOCK-66-0001`–`MOCK-66-0067`, `AC-001`–`AC-020`) with fictional names. Do not put real names, student IDs, phone numbers, or photos in public sheets.

## Features

| Area | What it does |
|---|---|
| Summary | Metric cards (total members, total events, actual budget spent vs planned/income) and interactive SVG charts (attendance per event, planned vs actual budget with hover tooltips, legend toggles, status filter, and "view as table"). |
| Calendar | Google Calendar-style **Month & Week** switcher (`Today`, `‹`, `›`), multi-day spanning banners (`Day x–y of n`), 7-column daily agendas, and click-to-project navigation straight into Project Data details. |
| Project data | Relevance **search box** (ranks by project name, tolerates typos, Thai + English) + **Sort** (`Best match`, `Newest`, `Oldest`, `A–Z`) + project cards. Detail view shows venue, status (`ดำเนินการ` / `ปิดโครงการ` / `ยกเลิก`), multi-day schedule (`Day 1 ... Day n`), staff & participant counts, **Attendance breakdown** (`Gender / Year / Major` for the project's year), and **Budget** actual vs planned expenses. |
| Accounts & Auth | 3-mode auth (**Sign in**, **First time? Set password**, **Sign up**) with server-enforced roles: **Admin** (`MOCK-66-0001`) and **Normal user** (`MOCK-66-0002`–`MOCK-66-0067`). Admins also get a **Users** tab to create users, reset passwords, and delete users. |
| Theme | Light / Dark toggle persisted in **SQLite (`bun:sqlite`)** per account (`PATCH /api/me/theme`), rendered via SSR `data-theme` + inline `<head>` script for zero-flash first paint, and synced to `localStorage` for offline/unauthenticated visits. |
| Alerts | Automatic in-app alerts (bell + toast): budget spending at **&ge; 80%** of plan (warning / &ge; 100% critical) and `Scheduled` events starting within **3 days**. |
| AI chatbox | Bottom-right assistant powered by **OpenRouter AI** (`google/gemini-2.5-flash` default, configurable via `OPENROUTER_MODEL`) with privacy-safe club/project/category aggregates, plus an enhanced Thai & English offline answerer when no API key is configured. |
| Data source | Single batched Google Sheets API v4 (`values:batchGet`) call for `Members`, `Events`, `Attendance`, and `Budget`, cached for 30 s with stale-on-error fallback and 60 s UI refresh. Falls back to `sample-sheets/*.csv` automatically when Google keys are unset. |

## Tech Stack

- **Runtime & DB:** Bun + `bun:sqlite` (with automatic startup migration for legacy `users` tables)
- **Framework:** SvelteKit 2 + Svelte 5 (runes) + TypeScript + `svelte-adapter-bun`
- **Data & AI:** Google Sheets API v4 + OpenRouter Chat Completions API
- **Testing:** `bun test` + `tsc --noEmit`

## Run Locally

```bash
cp .env.example .env     # optional: works out of the box with sample-sheets/*.csv mock data
bun install              # install dependencies
bun run dev              # start Vite + SvelteKit dev server
```

Production build & run:

```bash
bun run build            # build standalone Bun server into ./build
bun start                # run production server (bun ./build/index.js)
```

Tests & verification:

```bash
bun test                 # run automated unit & API integration tests
bun run check            # run svelte-kit sync && tsc --noEmit
python3 scripts/build-mock-sheets.py   # regenerate canonical sample-sheets/*.csv from Mock-Data
```

Mock accounts (seeded from `Members` on first start into `data/app.db`):
- **`MOCK-66-0001`** is **Admin**.
- **`MOCK-66-0002`** – **`MOCK-66-0067`** are **Members**.
- Open the app, select **First time? Set password**, enter the member ID and a password (8+ characters), or create a new account via **Sign up**.

## Connect Google Sheets

1. Create a Google Sheet with tabs named `Members`, `Events`, `Attendance`, and `Budget` (you can import the CSVs from `sample-sheets/` directly).
2. Share the sheet as **Anyone with the link &rarr; Viewer**.
3. In Google Cloud Console, enable **Google Sheets API** and create a restricted API key.
4. Set `GOOGLE_API_KEY` and `GOOGLE_SHEET_ID` in `.env` (alongside optional `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`).

| Tab | Columns (header row, any order; extra columns are ignored) |
|---|---|
| `Members` | `member_id`, `full_name`, `department`, `role`, `email`, `joined_date`, `gender`, `year`, `major`, `member_status` |
| `Events` | `event_id`, `title`, `date`, `end_date`, `location`, `description`, `budget_planned`, `status`, `image_url` |
| `Attendance` | `attendance_id`, `event_id`, `member_id`, `full_name`, `check_in_time`, `status`, `participant_type`, `project_role`, `gender`, `year`, `major` |
| `Budget` | `expense_id`, `event_id`, `type` (`Income`/`Expense`), `category`, `amount`, `date`, `receipt_ref` |

## Security Notes

- Passwords use `node:crypto` `scrypt` with per-user 16-byte random salts. Sessions use 32-byte random tokens stored as SHA-256 hashes in `HttpOnly` + `SameSite=Lax` cookies.
- Login/setup/registration and chat endpoints are rate-limited; write requests require `application/json` and same-origin validation; strict CSP (`mode: 'auto'`) and security headers are applied in `src/hooks.server.ts` and `svelte.config.js`.
- The AI chatbox sends only aggregate club/event statistics—never member emails or phone numbers.

## Architecture Decision Records

See [`docs/adr/`](./docs/adr/README.md) for full architecture decision records:

- [ADR-0001: Mock Data Normalization into 4 Canonical CSV Tabs](./docs/adr/0001-mock-data-normalization.md)
- [ADR-0002: Bun + SvelteKit (Svelte 5) Full-Stack Architecture](./docs/adr/0002-bun-sveltekit-architecture.md)
- [ADR-0003: OpenRouter AI Chatbox Integration & Enriched Club Context](./docs/adr/0003-openrouter-ai-chat.md)
- [ADR-0004: Google Calendar-Style Week & Month Views with Project Navigation](./docs/adr/0004-calendar-week-and-month-views.md)
- [ADR-0005: Club Dashboard Rebranding & DB-Persisted Theme Preference](./docs/adr/0005-branding-and-db-theme-preference.md)

## Project Layout

```text
src/
  app.html                 HTML shell + CSP-nonced zero-flash theme script
  app.css                  Design tokens (warm cream/amber Light & Dark modes)
  hooks.server.ts          Auth session, CSRF/JSON guards, SSR theme injection, headers
  lib/
    calendar.ts            Pure Month & Week calendar grid and span-packing helpers
    search.ts              Project-name relevance search (Thai + English, typo-tolerant)
    format.ts              Shared formatting and API fetch utilities
    types.ts               Shared TypeScript domain interfaces
    components/            Svelte 5 UI components (AuthView, Topbar, SummaryView,
                           Calendar, BarChart, ProjectsView, UsersView, ChatWidget, ToastContainer)
    server/                db.ts (bun:sqlite + migration), sheets.ts, mock.ts,
                           dashboard.ts, alerts.ts, chat.ts, dates.ts, http.ts, runtime.ts
  routes/
    +layout.server.ts      SSR session & theme loader
    +layout.svelte         Theme context & localStorage sync
    +page.svelte           Root app shell & page routing
    api/                   REST endpoints (/health, /auth/*, /me, /me/theme, /dashboard, /chat, /admin/users/*)
docs/adr/                  Architecture Decision Records (0001–0005)
sample-sheets/             Normalized canonical CSVs (Members, Events, Attendance, Budget)
scripts/                   build-mock-sheets.py, export-sample-sheets.js
tests/                     Bun unit & API integration test suite
```

License: MIT
