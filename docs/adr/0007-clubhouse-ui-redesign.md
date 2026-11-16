# ADR-0007: Clubhouse UI/UX Redesign with Real Mock-Data Views

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** Design system (`src/app.html`, `src/app.css`), theme synchronization (`src/routes/+layout.svelte`), enriched dashboard payload (`src/lib/types.ts`, `src/lib/server/dashboard.ts`), navigation shell (`src/lib/components/Topbar.svelte`, `src/routes/+page.svelte`), all workspace & management views (`SummaryView.svelte`, `ProjectsView.svelte`, `Calendar.svelte`, `MembersView.svelte`, `BudgetView.svelte`, `UsersView.svelte`), AI assistant & auth (`ChatWidget.svelte`, `AuthView.svelte`), and unit tests (`tests/app.test.ts`).

## Context

Following the migration to Bun + SvelteKit (ADR-0002), OpenRouter AI chat (ADR-0003), Google Calendar Month/Week views (ADR-0004), DB-persisted theme preferences (ADR-0005), and idempotent member seeding (ADR-0006), the visual shell still used an earlier top-tabbed layout (`Club Dashboard`) rather than the **Clubhouse** editorial workspace design system.

Additionally, the static Clubhouse HTML/CSS/JS prototype contained hardcoded placeholder values and placeholder panels for `Calendar`, `Members`, and `Budget`. In production, every sidebar view must reflect the live normalized `Mock-Data` (`Members.csv`, `Events.csv`, `Attendance.csv`, `Budget.csv` — or Google Sheets when configured) without exposing sensitive PII (member email addresses or phone numbers) in dashboard payloads.

## Decision

1. **Adopt the Clubhouse Design System & Brand Identity (`clubhouse.`):**
   - Load `DM Sans` and `Manrope` (alongside `Noto Sans Thai`) in `src/app.html` with `<title>Clubhouse — Activity dashboard</title>`.
   - Apply the Clubhouse warm cream & espresso light palette (`--canvas: #f8f7f3`, `--surface: #fff`, `--ink: #29271f`, `--accent: #9c7042` / `#9a7043`) and warm charcoal dark palette (`--canvas: #211f1b`, `--surface: #2b2924`, `--ink: #eeeae1`).
   - Render the graduation-cap SVG `.brand-mark` paired with the `clubhouse.` wordmark in both the sidebar and `AuthView`.
   - Synchronize both `data-theme="dark"` and the `.dark` class on `document.documentElement` in `src/app.html` and `src/routes/+layout.svelte` so SSR and client theme toggles apply consistently across all selectors.

2. **Fixed Sidebar Rail & Sticky Blurred Breadcrumb Topbar:**
   - Replace the top horizontal navigation bar with a fixed left rail (`247px` desktop, `62px` mobile icon rail) organized into `WORKSPACE` (`Summary`, `Project data`, `Events calendar`, `Members`) and `MANAGE` (`Budget`, plus Admin-only `Users`), with a live data-source status card and profile menu at the bottom.
   - Pair the main content column with a sticky `65px` backdrop-blurred topbar displaying dynamic breadcrumbs (`Workspace / <Current View>`), sync indicator, light/dark theme toggle (`#themeLight` / `#themeDark`), notification popover (`#bellBtn`), and user avatar.

3. **Enrich `DashboardPayload` Safely for Real Data Views (`src/lib/server/dashboard.ts`, `src/lib/types.ts`):**
   - Enrich each `ProjectSummary` with `lead` (`{ member_id, name, role, initials }` prioritized from project staff roles) and `category` (`Academic` | `Social` | `Community` | `Operations` derived deterministically from title and description).
   - Add `metrics.activeMembers`, `membersByYear`, `membersByGender`, `membersByStatus`, privacy-safe `members` (omitting `email`), and `transactions` (all 126 `Budget.csv` rows sorted newest-first with resolved `event_title`) to `DashboardPayload`, maintaining 100% backward compatibility with existing API consumers and tests.

4. **Wire All Sidebar Views to Normalized Data:**
   - **Summary (`SummaryView.svelte`):** 3 Clubhouse KPI stat cards (Active members retention, Events held, Budget used), interactive attendance bar chart (`Recent 6 events` / `All events` + expandable table), budget category breakdown + project budget table, upcoming events list, active projects progress list, and real CSV report export (`#export-btn`).
   - **Project data (`ProjectsView.svelte`):** 5-column overview strip, search + status/category/sort toolbar, full project table, and the 6-section Project Detail drill-down view.
   - **Events calendar (`Calendar.svelte`):** Restyled Google Calendar Month & Week views integrated as a dedicated sidebar destination that navigates directly into Project Detail on event click.
   - **Members (`MembersView.svelte`):** 67-member directory with overview metrics, department & demographic breakdown bars, multi-facet filtering, and status badges.
   - **Budget (`BudgetView.svelte`):** Club finance overview strip, category spending breakdown, project budget health monitor (highlighting `>= 80%` and `>= 100%` alerts), and searchable/filterable 126-row transaction ledger.
   - **Assistant (`ChatWidget.svelte`) & Auth (`AuthView.svelte`):** Restyled to the Clubhouse `.assistant-fab` / `.assistant-panel` and auth card while preserving OpenRouter AI + offline chat and all authentication workflows.

## Consequences

- **Positive:** Every sidebar item in the Clubhouse workspace is backed by real normalized club data rather than static mocks or placeholder cards.
- **Positive:** Member emails remain excluded from `DashboardPayload` and AI chat context, preserving privacy boundaries.
- **Positive:** Existing DOM hooks (`#metrics`, `#statusFilter`, `#projectSearch`, `#groupBy`, `#calGrid`, `#calWeek`, `#chatFab`, `#authForm`, `#usersTab`, `#themeLight`, `#themeDark`) remain intact for accessibility and automation.
