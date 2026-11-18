# Clubhouse (`clubhouse.`) — Club Activity Dashboard

Web dashboard for a student club committee built with **Bun + SvelteKit 2 (Svelte 5) + SQLite / Supabase (`public-cee-v2`) + `@svar-ui/svelte-calendar` + Google Sheets / Drive + OpenRouter AI**. Reads a connected Google Sheet (or the built-in normalized `sample-sheets/` mock dataset) and provides executive summary analytics, an interactive multi-day SVAR Calendar, project/member/budget views, automatic budget and schedule alerts, hybrid SQLite + Supabase persistence, linked Google OAuth sign-in, Light/Dark themes, and a Markdown-rendered AI assistant.

> All bundled data in this repository is **mock data** (`6600000001`–`6600000067` for club members, `6600000068`–`6600000732` for external event attendees, `AC-001`–`AC-020` for events) with fictional names. Do not put real personal data, student IDs, phone numbers, or private photos into public sheets.

![Clubhouse Activity Dashboard](./docs/images/dashboard-preview.png)

## Features

> For a detailed breakdown of every feature—what it is, relevant source files, and how it works internally—see [**Feature Documentation (`docs/FEATURES.md`)**](./docs/FEATURES.md).

| Area | What it does |
|---|---|
| **Summary** | Executive KPI cards (members, active retention, events, planned vs. actual budget), interactive attendance & budget charts with legend toggles, top expense categories, upcoming events, active projects, and CSV report export. |
| **Events calendar** | Powered by **`@svar-ui/svelte-calendar`** (`Willow` / `WillowDark`) with **Month, Week, and Day** views, continuous multi-day (`ต่อเนื่อง`) horizontal spanning bars, deterministic 8-color per-project palette (`EVENT_PALETTE`), filter pills (`All`, `Multi-day ต่อเนื่อง`, `In Progress`, `Completed`, `Cancelled`), contained Month/Event jump dropdowns, viewport-clamped hover tooltips, and a synchronized **Selected Event & Date Inspector** with direct `Inspect Project →` navigation. |
| **Project data** | Relevance search (Thai + English, typo-tolerant), status & category filters, sorting (`Best match`, `Newest`, `Oldest`, `A–Z`), and full project detail pages showing venue, Thai/English status (`ดำเนินการ` / `ปิดโครงการ` / `ยกเลิก`), multi-day schedule, staff vs. participant counts, **Attendance breakdown** (`Gender / Year / Major`), and **Budget** utilization. |
| **Members & Budget** | Dedicated **Members** directory (search, status/department filters, year & major demographics) and **Budget** ledger view (income vs. expense KPIs, category breakdown, project budget health bars, and searchable transaction table). |
| **Accounts & Auth** | 3-mode Student ID authentication (**Sign in**, **First time? Set password**, **Sign up**) with server-enforced roles: **Admin** (`6600000001`) and **Member** (`6600000002`–`6600000067`). Supports **linked-only Google Sign-In** via Supabase OAuth (users link/unlink Google from their profile menu; unlinked Google emails cannot auto-register). Admins get a **Users** tab to create accounts, reset passwords, and delete users. |
| **Google Sheets & Drive Sync** | **Admin-only** interactive Sheet Picker modal (`SheetPickerModal`): browse spreadsheets directly from Google Drive via Supabase Google OAuth (`drive.readonly` + `spreadsheets.readonly` with Drive API `403 SERVICE_DISABLED` activation diagnostics), paste any public Google Sheet URL (keyless `gviz/tq` CSV mode or API v4 `values:batchGet`), switch back to Mock Data, or download the 4-tab `Clubhouse-Google-Sheet-Ready.xlsx` workbook / individual CSV templates (`/api/sheets/export-csv`). Cached for 30 s with stale-on-error fallback. |
| **AI Chatbox** | Bottom-right **Clubhouse Assistant** powered by **OpenRouter AI** (supports reasoning models such as `z-ai/glm-5.3-flash` with `2048` default `max_tokens` and `reasoning` fallback), renders rich Markdown via `@humanspeak/svelte-markdown`, uses privacy-safe club/project/category aggregates (never member emails/phones), and falls back to an offline Thai & English answerer when no API key is configured. |
| **Theme & Alerts** | 1-button Light/Dark toggle (`#themeToggle`) persisted per account in SQLite + Supabase (`PATCH /api/me/theme`) with zero-flash SSR `data-theme` injection. Automatic bell + toast alerts for budget spending **&ge; 80%** (warning) / **&ge; 100%** (critical) and `Scheduled` events starting within **3 days**. |
| **Responsive UI** | Full desktop sidebar rail (`> 1024px`), off-canvas slide-over navigation drawer (`<= 1024px`), fixed mobile bottom navigation bar (`<= 900px`), and responsive stacking across mobile phones and vertical/portrait displays. |

## Tech Stack

- **Runtime & Storage:** Bun + SQLite (`bun:sqlite` with `node:sqlite` fallback) + optional **Supabase PostgreSQL** (`schema: public-cee-v2`) hybrid sync
- **Framework:** SvelteKit 2 + Svelte 5 (runes) + TypeScript + `svelte-adapter-bun`
- **UI & Calendar:** `@svar-ui/svelte-calendar`, `@humanspeak/svelte-markdown`, custom CSS design tokens
- **Integrations:** Google Sheets API v4 / keyless `gviz` CSV, Google Drive API v3, Supabase Google OAuth, OpenRouter Chat Completions API
- **Deployment & Testing:** Docker (`oven/bun:1-alpine`), Render Blueprint (`render.yaml`), `bun test`, `tsc --noEmit`

### Architecture & Tech Stack Diagram

```mermaid
flowchart LR
  subgraph Client["Frontend (Browser)"]
    UI["SvelteKit 2 + Svelte 5 (Runes)<br/>TypeScript · Custom CSS Tokens"]
    CAL["@svar-ui/svelte-calendar<br/>(Month / Week / Day + Inspector)"]
    MD["@humanspeak/svelte-markdown<br/>(Clubhouse AI Chat Widget)"]
    UI --> CAL
    UI --> MD
  end

  subgraph Server["Backend (Bun + svelte-adapter-bun)"]
    HOOKS["hooks.server.ts<br/>Auth · CSP · CSRF · Rate Limit"]
    API["REST API Routes<br/>/api/dashboard · /api/auth/*<br/>/api/sheets/* · /api/chat"]
    ENGINE["Dashboard Aggregator<br/>& Alert Engine"]
    HOOKS --> API --> ENGINE
  end

  subgraph Data["Persistence & Identity"]
    SQLITE[("Local SQLite<br/>bun:sqlite / node:sqlite")]
    SUPA[("Supabase PostgreSQL<br/>schema: public-cee-v2")]
    OAUTH["Supabase Google OAuth<br/>(Linked Sign-In & Drive Scopes)"]
    SQLITE <-->|"Hybrid Sync"| SUPA
  end

  subgraph External["External Services & Data Sources"]
    SHEETS["Google Sheets API v4<br/>/ Keyless gviz CSV"]
    DRIVE["Google Drive API v3<br/>(Admin Sheet Picker)"]
    MOCK["Bundled sample-sheets/<br/>(CSV + 4-tab .xlsx Fallback)"]
    AI["OpenRouter AI API<br/>(with Offline Fallback)"]
  end

  Client <-->|"HTTPS / JSON + HttpOnly Cookie"| HOOKS
  API <--> SQLITE
  API <--> OAUTH
  ENGINE <--> SHEETS
  API <--> DRIVE
  ENGINE -.->|"Fallback"| MOCK
  API <--> AI
```

## Run Locally

```bash
cp .env.example .env     # optional: works out of the box with sample-sheets/ mock data
bun install              # install dependencies
bun run dev              # start Vite + SvelteKit dev server (http://localhost:5173)
```

Production build & run:

```bash
bun run build            # build standalone Bun server into ./build
bun start                # run production server (bun ./build/index.js)
```

Tests, typecheck & mock sheet generation:

```bash
bun test                 # run unit & API integration tests (35 tests)
bun run check            # run svelte-kit sync && tsc --noEmit
python3 scripts/build-mock-sheets.py   # regenerate sample-sheets/*.csv & Clubhouse-Google-Sheet-Ready.xlsx
```

Default mock accounts (seeded idempotently from `Members` on startup into `data/app.db` and synced with Supabase when configured):
- **`6600000001`** — **Admin** (`Sutthikan Panla`)
- **`6600000002` – `6600000067`** — **Members**
- Open the app, select **First time? Set password**, enter a student ID and a password (8+ characters), or register a new account via **Sign up**.

## Connect Google Sheets & Supabase

### 1. Google Sheets
1. Upload [`sample-sheets/Clubhouse-Google-Sheet-Ready.xlsx`](./sample-sheets/Clubhouse-Google-Sheet-Ready.xlsx) to Google Drive and open it as a Google Sheet (or import the 4 CSV files in `sample-sheets/` into tabs named `Members`, `Events`, `Attendance`, and `Budget`).
2. Share the sheet as **Anyone with the link &rarr; Viewer** (or keep it private and sign in as Admin with Google OAuth Drive/Sheets scopes).
3. As an **Admin** (`6600000001`), open **Sync sheet / Connect Sheet** in the dashboard to either pick the file from Google Drive or paste the Google Sheet URL directly — or configure `GOOGLE_SHEET_ID` (and optional `GOOGLE_API_KEY`) in `.env`.

| Tab | Columns (header row, any order; extra columns are ignored) |
|---|---|
| `Members` | `member_id`, `full_name`, `department`, `role`, `email`, `joined_date`, `gender`, `year`, `major`, `member_status` |
| `Events` | `event_id`, `title`, `date`, `end_date`, `location`, `description`, `budget_planned`, `status`, `image_url` |
| `Attendance` | `attendance_id`, `event_id`, `member_id`, `full_name`, `check_in_time`, `status`, `participant_type`, `project_role`, `gender`, `year`, `major` |
| `Budget` | `expense_id`, `event_id`, `type` (`Income`/`Expense`), `category`, `amount`, `date`, `receipt_ref` |

### 2. Supabase Hybrid Persistence & Google OAuth (Optional)
1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor to create the `public-cee-v2` schema (`users`, `sessions`, `app_settings`).
2. In Supabase **Settings &rarr; API &rarr; Exposed schemas**, add `public-cee-v2`.
3. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_SCHEMA=public-cee-v2` in `.env`.
4. To enable **Google Sign-In** (linked accounts) and **Google Drive Sheet Picker**, enable the Google provider in Supabase Auth and whitelist `<your-origin>/auth/callback` under **Authentication &rarr; URL Configuration &rarr; Redirect URLs**.

## Deployment

### Render (Free Docker Web Service)
This repository includes a production [`Dockerfile`](./Dockerfile) and [`render.yaml`](./render.yaml) Blueprint:

1. Push the repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), choose **New + &rarr; Blueprint** (or **Web Service &rarr; Docker**) and select the repo.
3. Configure environment variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SCHEMA=public-cee-v2`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host`, `TZ_NAME=Asia/Bangkok`).
4. Set Health Check Path to `/api/health`.
5. Whitelist `https://<your-render-domain>/auth/callback` in Supabase Auth Redirect URLs.

> Even when Render's free container restarts with an ephemeral filesystem, the app automatically re-hydrates all user accounts, passwords, sessions, theme preferences, Google account links, and sheet settings from **Supabase (`public-cee-v2`)**.

### Local Docker Compose
```bash
# Build and run in Docker on http://localhost:3000
docker compose up -d --build
```

## Security Notes

- Passwords use `node:crypto` `scrypt` with per-user 16-byte random salts. Sessions use 32-byte random tokens stored as SHA-256 hashes in `HttpOnly` + `SameSite=Lax` cookies (`Secure` automatically enabled behind HTTPS / `x-forwarded-proto: https`).
- Login, password setup, registration, and chat endpoints are rate-limited; write endpoints enforce `application/json` and same-origin validation; strict CSP (`mode: 'auto'`) and security headers are applied in [`src/hooks.server.ts`](./src/hooks.server.ts) and [`svelte.config.js`](./svelte.config.js).
- Google Sign-In only authenticates pre-linked accounts; Google Sheet configuration and Drive browsing require `role === 'admin'`.
- The AI chatbox sends only aggregate club/event statistics — never member emails or phone numbers.

## Architecture Decision Records

See [`docs/adr/README.md`](./docs/adr/README.md) for all architecture decision records:

- [ADR-0001: Mock Data Normalization into 4 Canonical CSV Tabs](./docs/adr/0001-mock-data-normalization.md)
- [ADR-0002: Bun + SvelteKit (Svelte 5) Full-Stack Architecture](./docs/adr/0002-bun-sveltekit-architecture.md)
- [ADR-0003: OpenRouter AI Chatbox Integration & Enriched Club Context](./docs/adr/0003-openrouter-ai-chat.md)
- [ADR-0004: Google Calendar-Style Week & Month Views with Project Navigation](./docs/adr/0004-calendar-week-and-month-views.md)
- [ADR-0005: Club Dashboard Rebranding & DB-Persisted Theme Preference](./docs/adr/0005-branding-and-db-theme-preference.md)
- [ADR-0006: Idempotent Member Seeding, Admin Promotion & Node/Bun Compatibility](./docs/adr/0006-idempotent-admin-seeding.md)
- [ADR-0007: Clubhouse UI/UX Redesign with Real Mock-Data Views](./docs/adr/0007-clubhouse-ui-redesign.md)
- [ADR-0008: Svelte-Markdown Chat, 1-Button Theme Toggle, Calendar UX Overhaul, Supabase (`public-cee-v2`), & Google Drive Sheet Selector](./docs/adr/0008-markdown-calendar-supabase-drive-sheets.md)
- [ADR-0009: Supabase Google OAuth for Sign-In & 1-Click Google Drive Sheet Picker](./docs/adr/0009-supabase-google-oauth-drive-integration.md)
- [ADR-0010: Linked-Only Google Sign-In, Admin-Only Sheet Selection, & Drive API 403 Diagnostics](./docs/adr/0010-google-account-linking-and-admin-sheet-guard.md)
- [ADR-0011: SVAR Svelte Calendar Integration & Mobile / Vertical Display Responsive Layout](./docs/adr/0011-svar-calendar-and-responsive-layout.md)

## Project Layout

```text
Dockerfile                 Multi-stage oven/bun:1-alpine production image
docker-compose.yml         Local Docker Compose configuration
render.yaml                Render Blueprint (Free Docker Web Service)
supabase/
  schema.sql               PostgreSQL schema for public-cee-v2 hybrid persistence
src/
  app.html                 HTML shell + CSP-nonced zero-flash theme script
  app.css                  Clubhouse Light & Dark tokens, SVAR Calendar theme, responsive layout
  hooks.server.ts          Auth session, CSRF/JSON guards, SSR theme injection, security headers
  lib/
    calendar.ts            SVAR event mapping, 8-color EVENT_PALETTE, Month/Week/Day helpers
    search.ts              Project-name relevance search (Thai + English, typo-tolerant)
    format.ts              Currency, date range, percentage, and API fetch helpers
    types.ts               Shared TypeScript domain interfaces
    components/            AuthView, Topbar, SummaryView, Calendar, CalendarTooltip,
                           BarChart, ProjectsView, MembersView, BudgetView, UsersView,
                           SheetPickerModal, ChatWidget, ToastContainer
    server/                db.ts, supabase.ts, runtime.ts, sheets.ts, mock.ts,
                           dashboard.ts, alerts.ts, chat.ts, dates.ts, http.ts
  routes/
    +layout.server.ts      SSR session & theme loader
    +layout.svelte         Theme context & localStorage sync
    +page.svelte           Root app shell & view router
    auth/callback/         Supabase Google OAuth callback handler
    api/                   REST endpoints (/health, /me, /me/theme, /dashboard, /chat,
                           /auth/{login,logout,register,setup,google},
                           /sheets/{config,drive,export-csv}, /admin/users/*)
docs/
  FEATURES.md              Detailed documentation of every feature and how it works
  adr/                     Architecture Decision Records (0001–0011)
  images/                  Dashboard preview screenshots
sample-sheets/             Members.csv, Events.csv, Attendance.csv, Budget.csv,
                           Clubhouse-Google-Sheet-Ready.xlsx
scripts/                   build-mock-sheets.py, export-sample-sheets.js
tests/                     Bun unit & API integration test suite (tests/app.test.ts)
```

License: MIT
