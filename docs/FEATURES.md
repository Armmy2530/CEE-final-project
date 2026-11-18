# Clubhouse Feature Guide

This document describes every feature in **Clubhouse (`clubhouse.`)**: what it does, which UI components and API routes implement it, and how it works under the hood.

---

## Table of Contents
1. [Summary Dashboard & Analytics](#1-summary-dashboard--analytics)
2. [Events Calendar (`@svar-ui/svelte-calendar`)](#2-events-calendar-svar-uisvelte-calendar)
3. [Project Data & Search](#3-project-data--search)
4. [Members Directory & Demographics](#4-members-directory--demographics)
5. [Budget & Transaction Ledger](#5-budget--transaction-ledger)
6. [Authentication & Linked Google Sign-In](#6-authentication--linked-google-sign-in)
7. [User & Role Administration](#7-user--role-administration)
8. [Google Sheets & Drive Sheet Picker](#8-google-sheets--drive-sheet-picker)
9. [Automated Budget & Schedule Alerts](#9-automated-budget--schedule-alerts)
10. [Clubhouse AI Assistant (OpenRouter + Offline Fallback)](#10-clubhouse-ai-assistant-openrouter--offline-fallback)
11. [Light / Dark Theme Persistence](#11-light--dark-theme-persistence)
12. [Responsive Desktop, Vertical & Mobile Layout](#12-responsive-desktop-vertical--mobile-layout)
13. [Supabase-Primary Persistence with Strict 503 & SQLite Fallback](#13-supabase-primary-persistence-with-strict-503--sqlite-fallback)

---

## 1. Summary Dashboard & Analytics

- **What it is:** The executive landing view (`Summary`) giving club committees an instant overview of membership, event activity, attendance trends, budget health, upcoming events, and active projects.
- **Key files:** [`src/lib/components/SummaryView.svelte`](../src/lib/components/SummaryView.svelte), [`src/lib/components/BarChart.svelte`](../src/lib/components/BarChart.svelte), [`src/lib/server/dashboard.ts`](../src/lib/server/dashboard.ts)
- **How it works:**
  1. The frontend fetches aggregated club metrics from `GET /api/dashboard` (auto-refreshed every 60 seconds or on manual **Sync sheet**).
  2. [`buildDashboard`](../src/lib/server/dashboard.ts) computes KPIs from the 4 normalized tables (`Members`, `Events`, `Attendance`, `Budget`):
     - **Active members:** active count out of total members (`55 / 67`), active retention %, and department count.
     - **Events held:** total events split by `Completed`, `Scheduled`, and `Cancelled`.
     - **Budget used:** actual expense vs. planned allocation, percentage utilized, and remaining balance.
  3. **Interactive Event Attendance chart:** Plots attendees per event alongside the club average with status filters (`All`, `Completed`, `Scheduled`, `Cancelled`), recent vs. all event switching, click-to-open project navigation, and a **View as table** toggle.
  4. **Budget Overview & Active Panels:** Displays the top 5 expense categories vs. planned shares, upcoming scheduled events with direct calendar links, active projects with completion/attendance bars, and **Export report** (client-side CSV download).

---

## 2. Events Calendar (`@svar-ui/svelte-calendar`)

- **What it is:** A multi-view activity scheduler powered by `@svar-ui/svelte-calendar` where single-day and multi-day (`ต่อเนื่อง`) events render as continuous horizontal spanning bars with consistent per-project colors.
- **Key files:** [`src/lib/components/Calendar.svelte`](../src/lib/components/Calendar.svelte), [`src/lib/components/CalendarTooltip.svelte`](../src/lib/components/CalendarTooltip.svelte), [`src/lib/calendar.ts`](../src/lib/calendar.ts)
- **How it works:**
  1. **Event normalization ([`toSvarEvents`](../src/lib/calendar.ts)):** Converts each `ProjectSummary` into an SVAR event with `allDay: true`, local-midnight `start`, and exclusive `end` (`end_date + 1 day`) so multi-day events span cleanly across every day cell and week row.
  2. **Consistent 8-Color Palette ([`EVENT_PALETTE`](../src/lib/calendar.ts) & [`getEventColorIndex`](../src/lib/calendar.ts)):** Assigns a deterministic color (`ev-palette-0`..`ev-palette-7`) from `event_id` so the same project retains its color across Month, Week, Day, tooltips, dropdowns, and the inspector.
  3. **Views & Filters:** Switch between **Month**, **Week**, and **Day** views, step with `‹` / `Today` / `›`, or filter by `All`, `Multi-day ต่อเนื่อง`, `In Progress`, `Completed`, and `Cancelled`.
  4. **Contained Jump Dropdowns & Clamped Tooltips:** Custom `#calJumpMonth` and `#calJumpEvent` dropdowns truncate inside narrow/vertical viewports and wrap long titles inside the open menu. Hover tooltips ([`CalendarTooltip.svelte`](../src/lib/components/CalendarTooltip.svelte)) dynamically clamp inside viewport bounds.
  5. **Read-Only Dashboard Mode & Inspector Sync:** Drag/create/delete actions are intercepted in SVAR's API (`initSvarApi`), while clicking an event bar or date cell updates the **Selected Event & Day Inspector** (`#calDetail`) with budget/attendance details and an `Inspect Project →` jump button.

---

## 3. Project Data & Search

- **What it is:** A searchable, filterable catalog of all club projects (`AC-001`–`AC-020` in mock mode) with deep-dive detail views for each project.
- **Key files:** [`src/lib/components/ProjectsView.svelte`](../src/lib/components/ProjectsView.svelte), [`src/lib/search.ts`](../src/lib/search.ts)
- **How it works:**
  1. **Search & Ranking ([`rank`](../src/lib/search.ts)):** Tokenizes and scores queries against `title`, `event_id`, `lead.name`, and `category` with Thai + English normalization and typo tolerance.
  2. **Filtering & Sorting:** Filter by status (`Scheduled`, `Completed`, `Cancelled`) or category (`Academic`, `Social`, `Community`, `Operations`), and sort by `Best match`, `Newest`, `Oldest`, or `A–Z`.
  3. **Project Detail View:** Clicking a project opens its detail view with venue, Thai/English status badge (`ดำเนินการ` / `ปิดโครงการ` / `ยกเลิก`), multi-day schedule, staff vs. participant counts, **Attendance breakdown** (`Gender / Year / Major`), and itemized **Budget** planned vs. actual spending.

---

## 4. Members Directory & Demographics

- **What it is:** A member roster and demographic analytics page (`Members`).
- **Key files:** [`src/lib/components/MembersView.svelte`](../src/lib/components/MembersView.svelte)
- **How it works:**
  1. Aggregates `dash.members` into department, academic year, and gender breakdowns with percentage progress bars.
  2. Provides live client-side filtering by keyword (`full_name`, `member_id`, `major`, `role`, `department`), department, academic year, and membership status (`Active`, `On Leave`, etc.).
  3. Privacy note: member emails and phone numbers are never included in public dashboard context sent to the AI assistant.

---

## 5. Budget & Transaction Ledger

- **What it is:** A club finance page (`Budget`) combining overall spending metrics, category allocations, per-project budget health bars, and a searchable transaction ledger.
- **Key files:** [`src/lib/components/BudgetView.svelte`](../src/lib/components/BudgetView.svelte)
- **How it works:**
  1. Displays **Planned Budget**, **Actual Spent**, **Remaining**, and utilization percentage KPIs.
  2. Ranks spending categories by share of total expenses and lists every project with health badges (`Over` at ≥ 100%, `Alert` at ≥ 80%, or normal percentage) that click straight into the project detail view.
  3. Renders all `Income` and `Expense` rows in a filterable ledger (filter by type, category, or search by `expense_id`, `receipt_ref`, event ID, or title).

---

## 6. Authentication & Linked Google Sign-In

- **What it is:** A streamlined 2-mode 10-digit student ID authentication system (`Sign in` and `Sign up`) with automatic member lookup plus optional **linked-only Google OAuth sign-in**.
- **Key files:** [`src/lib/components/AuthView.svelte`](../src/lib/components/AuthView.svelte), [`src/lib/validation.ts`](../src/lib/validation.ts), [`src/routes/auth/callback/+page.svelte`](../src/routes/auth/callback/+page.svelte), [`src/routes/api/auth/*`](../src/routes/api/auth/login/+server.ts), [`src/lib/server/auth-crypto.ts`](../src/lib/server/auth-crypto.ts)
- **How it works:**
  1. **10-Digit ID & Password Security:** Member IDs are validated as 10-digit student IDs ([`validateStudentId`](../src/lib/validation.ts)). Passwords require 8+ characters with at least one uppercase letter, lowercase letter, and number ([`validatePassword`](../src/lib/validation.ts)), hashed with `node:crypto` `scrypt` and a per-user 16-byte random salt.
  2. **Session Cookies:** Successful login generates a 32-byte random token; only its `SHA-256` hash is stored in the `sessions` table, while the cookie is set as `HttpOnly`, `SameSite=Lax`, and `Secure` (automatically enabled on HTTPS or `x-forwarded-proto: https`).
  3. **Automatic Lookup in Sign up (`/api/auth/setup` & `/api/auth/register`):** Pre-seeded student IDs (`6600000001`–`6600000067`) are detected automatically when entered under **Sign up**: the UI locks full-name entry, displays the registered member name from the database, and submits to `/api/auth/setup`. New student IDs submit to `/api/auth/register`.
  4. **Linked-Only Google Sign-In (`/api/auth/google`):**
     - When signed in as an **admin**, clicking **Link Google account** in the top-right account menu (`#userMenu`) stores a bidirectional mapping (`google_user_map:<email>` ↔ `user_google_email:<member_id>`) in `app_settings` (in the active store) and can be unlinked anytime via `DELETE /api/auth/google`.
     - Normal users see a streamlined `#userMenu` containing only their identity, current data source status, and **Sign out** (no **Sync data now** or **Link Google account** buttons).
     - When signed out, **Sign in with Google** redirects through Supabase Google OAuth to `/auth/callback` and resolves the linked `member_id`. Unlinked Google emails are rejected (`403`) rather than creating unauthorized accounts.

---

## 7. User & Role Administration

- **What it is:** Role-based access control (`admin` vs. `user`) with an admin-only **Users** management console (`Users`), opened from the top-right admin account menu (`#userMenu`).
- **Key files:** [`src/lib/components/UsersView.svelte`](../src/lib/components/UsersView.svelte), [`src/lib/components/Topbar.svelte`](../src/lib/components/Topbar.svelte), [`src/routes/api/admin/users/+server.ts`](../src/routes/api/admin/users/+server.ts), [`src/routes/api/admin/users/[id]/+server.ts`](../src/routes/api/admin/users/[id]/+server.ts), [`src/routes/api/admin/users/[id]/reset/+server.ts`](../src/routes/api/admin/users/[id]/reset/+server.ts)
- **How it works:**
  1. Account `6600000001` is automatically seeded and promoted to **`admin`** (see [ADR-0006](./adr/0006-idempotent-admin-seeding.md) & [ADR-0001](./adr/0001-mock-data-normalization.md)).
  2. Admins can view all accounts, create new users (`member_id`, `full_name`, `role`), reset user passwords back to uninitialized state, or delete non-self users. All admin endpoints enforce `locals.user.role === 'admin'`.

---

## 8. Google Sheets & Drive Sheet Picker

- **What it is:** An **admin-only** data source manager (opened via **Data source** in `#userMenu` or **Connect Google Sheet** on the Summary page) allowing dynamic switching between normalized Mock Data and live Google Sheets without restarting the server.
- **Key files:** [`src/lib/components/SheetPickerModal.svelte`](../src/lib/components/SheetPickerModal.svelte), [`src/lib/server/sheets.ts`](../src/lib/server/sheets.ts), [`src/routes/api/sheets/config/+server.ts`](../src/routes/api/sheets/config/+server.ts), [`src/routes/api/sheets/drive/+server.ts`](../src/routes/api/sheets/drive/+server.ts), [`src/routes/api/sheets/export-csv/+server.ts`](../src/routes/api/sheets/export-csv/+server.ts)
- **How it works:**
  1. **Three Connection Modes:**
     - **Mock Data:** Loads bundled [`sample-sheets/*.csv`](../sample-sheets/Members.csv).
     - **Public Google Sheet URL:** Extracts the spreadsheet ID via [`extractSheetId`](../src/lib/server/sheets.ts) and fetches the 4 tabs (`Members`, `Events`, `Attendance`, `Budget`) using either Google Sheets API v4 `values:batchGet` (when `GOOGLE_API_KEY` or OAuth token is present) or **keyless `gviz/tq?tqx=out:csv`** for shared sheets.
     - **Google Drive Browser:** Admins authenticate with Google OAuth (`drive.readonly` + `spreadsheets.readonly` scopes) to list and connect private/shared spreadsheets with 1 click. If Google Drive API is disabled on the GCP project, `parseDriveError` surfaces the exact `SERVICE_DISABLED` `activationUrl` directly in the modal.
  2. **Caching & Resilience:** Responses are cached for `SHEET_CACHE_SECONDS` (default `30s`) with in-flight request deduplication and stale-on-error fallback.
  3. **Workbook & CSV Export:** `/api/sheets/export-csv` downloads the ready-to-upload 4-tab `Clubhouse-Google-Sheet-Ready.xlsx` workbook (`?format=xlsx`) or individual CSV templates.
  4. **Access Control:** Only `role === 'admin'` users can view or mutate sheet configuration or browse Drive.

---

## 9. Automated Budget & Schedule Alerts

- **What it is:** Proactive monitoring that notifies users about high budget consumption and upcoming events via the topbar notification bell and floating toasts.
- **Key files:** [`src/lib/server/alerts.ts`](../src/lib/server/alerts.ts), [`src/lib/components/ToastContainer.svelte`](../src/lib/components/ToastContainer.svelte), [`src/lib/components/Topbar.svelte`](../src/lib/components/Topbar.svelte)
- **How it works:**
  1. [`buildAlerts`](../src/lib/server/alerts.ts) evaluates every non-cancelled event and overall totals on each dashboard refresh:
     - **Budget Warning (`warning`):** Triggered when `actual / budget_planned >= 80%` and `< 100%`.
     - **Budget Critical (`critical`):** Triggered when `actual / budget_planned >= 100%`.
     - **Upcoming Event (`info`):** Triggered for `Scheduled` events whose start date is within `0..3` days of `today`.
  2. Unseen alerts increment the notification badge in [`Topbar.svelte`](../src/lib/components/Topbar.svelte) and trigger clickable toasts that navigate directly to the relevant project.

---

## 10. Clubhouse AI Assistant (OpenRouter + Offline Fallback)

- **What it is:** A floating bottom-right AI chat widget that answers club questions in Thai or English with Markdown formatting.
- **Key files:** [`src/lib/components/ChatWidget.svelte`](../src/lib/components/ChatWidget.svelte), [`src/lib/server/chat.ts`](../src/lib/server/chat.ts), [`src/routes/api/chat/+server.ts`](../src/routes/api/chat/+server.ts)
- **How it works:**
  1. [`buildContext`](../src/lib/server/chat.ts) serializes a compact, privacy-safe JSON snapshot (totals, members by department, spending by category, per-event stats, and active alerts—explicitly excluding emails and phone numbers).
  2. When `OPENROUTER_API_KEY` is configured, [`askOpenRouter`](../src/lib/server/chat.ts) queries OpenRouter (`max_tokens: 2048` by default so reasoning models such as `z-ai/glm-5.3-flash` can finish thinking and reply, with fallback to `message.reasoning` / `reasoning_content`).
  3. If no key is set or OpenRouter errors, `/api/chat` falls back seamlessly to a deterministic Thai/English offline answerer.
  4. Responses render as formatted Markdown (lists, headings, bold metrics, code blocks) via `@humanspeak/svelte-markdown`.

---

## 11. Light / Dark Theme Persistence

- **What it is:** Zero-flash Light and Dark themes controlled by a 1-button toggle (`#themeToggle`) in the topbar.
- **Key files:** [`src/app.html`](../src/app.html), [`src/hooks.server.ts`](../src/hooks.server.ts), [`src/routes/+layout.svelte`](../src/routes/+layout.svelte), [`src/routes/api/me/theme/+server.ts`](../src/routes/api/me/theme/+server.ts)
- **How it works:**
  1. **Zero-Flash First Paint:** [`src/hooks.server.ts`](../src/hooks.server.ts) reads `locals.user.theme` (or the `theme` cookie) and injects `data-theme` into HTML during SSR alongside a CSP-nonced inline `<head>` script synced with `localStorage`.
  2. **Per-Account Persistence:** Clicking `#themeToggle` updates the UI immediately, updates the cookie/`localStorage`, and persists the preference via `PATCH /api/me/theme` into the active database (`SupabaseStore` or local SQLite fallback).
  3. **Component Sync:** The selected theme also switches the `@svar-ui/svelte-calendar` wrapper between `<Willow>` (Light) and `<WillowDark>` (Dark).

---

## 12. Responsive Desktop, Vertical & Mobile Layout

- **What it is:** Adaptive topbar-driven layout tuned for widescreen desktops, vertical/portrait monitors (`<= 1120px` or `max-aspect-ratio: 4/5`), and mobile / scaled-vertical viewports (`<= 760px`).
- **Key files:** [`src/app.css`](../src/app.css), [`src/lib/components/Topbar.svelte`](../src/lib/components/Topbar.svelte), [`src/routes/+page.svelte`](../src/routes/+page.svelte)
- **How it works:**
  1. **Desktop & Vertical/Portrait Monitors (`> 760px`):** Sticky `.ac-topbar` shell (no sidebar) with a **Summary** view-switcher dropdown (`Summary`, `Members`, `Budget`, `Events calendar`), **Project data** tab, single-button `#themeToggle`, notification bell, and `#userMenu`. Vertical/portrait displays (`<= 1120px` or `max-aspect-ratio: 4/5`) stack split grids cleanly while keeping topbar navigation active.
  2. **Mobile & Scaled Vertical Viewports (`<= 760px`):** Topbar nav pills collapse and a fixed 5-tab `.mobile-bottom-nav` bar (`Summary`, `Projects`, `Calendar`, `Members`, `Budget` with semantic `24×24` stroke SVG icons) provides 1-tap thumb navigation while floating chat and toast positions lift automatically above the bottom bar (`env(safe-area-inset-bottom)`). Admins continue accessing **Users** and **Data source** from the top-right account menu (`#userMenu`).

---

## 13. Supabase-Primary Persistence with Strict 503 & SQLite Fallback

- **What it is:** A single-store persistence architecture using **Supabase PostgreSQL (`public-cee-v2`)** whenever configured and healthy at startup, with automatic startup fallback to **local SQLite (`data/app.db`)** when Supabase is unavailable or unconfigured (see [ADR-0012](./adr/0012-supabase-primary-strict-sqlite-fallback.md)).
- **Key files:** [`src/lib/server/store.ts`](../src/lib/server/store.ts), [`src/lib/server/auth-crypto.ts`](../src/lib/server/auth-crypto.ts), [`src/lib/server/supabase.ts`](../src/lib/server/supabase.ts), [`src/lib/server/db.ts`](../src/lib/server/db.ts), [`src/lib/server/runtime.ts`](../src/lib/server/runtime.ts), [`src/hooks.server.ts`](../src/hooks.server.ts), [`supabase/schema.sql`](../supabase/schema.sql)
- **How it works:**
  1. **Startup Probe (`initStore`):** When Supabase credentials are present, the server probes `public-cee-v2` once on startup. If connected, all reads and writes run exclusively through `SupabaseStore`—local SQLite is never opened or written to.
  2. **Strict When Selected (`503 StoreUnavailableError`):** Once `SupabaseStore` is selected at startup, mid-request Supabase network or `5xx` errors throw [`StoreUnavailableError`](../src/lib/server/store.ts) and [`src/hooks.server.ts`](../src/hooks.server.ts) returns HTTP `503` (never silently failing over to local SQLite).
  3. **Local SQLite Startup Fallback:** When Supabase is `'disabled'`, `'schema_missing'` (`PGRST106`), or `'unreachable'` at startup (or in `:memory:` test runs), `initStore` lazily opens local SQLite (`bun:sqlite` under Bun or `node:sqlite` under Node.js) wrapped in `createSqliteStore`.
  4. **Idempotent Seeding & Legacy Migration:** On startup, `ensureSeeded` seeds student IDs `6600000001`–`6600000067` directly into the active store, ensures `6600000001` has `admin` role, and migrates any legacy `MOCK-66-00XX` rows, sessions, and Google mappings to 10-digit IDs.
