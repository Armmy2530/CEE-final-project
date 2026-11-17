# ADR-0011: SVAR Svelte Calendar Integration & Mobile / Vertical Display Responsive Layout

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** `@svar-ui/svelte-calendar` integration (`package.json`, `src/lib/calendar.ts`, `src/lib/components/Calendar.svelte`, `src/lib/components/CalendarTooltip.svelte`, `src/routes/+page.svelte`), 8-color deterministic event palette & inspector synchronization (`src/app.css`), and mobile/vertical responsive layout (`src/lib/components/Topbar.svelte`, `src/app.css`, `tests/app.test.ts`).

## Context

Three usability and visual gaps existed in the Calendar and responsive shell:

1. **Multi-day (`ต่อเนื่อง`) Events in Month & Week Views:** While ADR-0004 added custom week span strips, Month view still rendered separate per-cell chips rather than continuous horizontal multi-day bars across cells, and lacked a dedicated Day schedule view.
2. **Per-Event Color Consistency & Details Inspection:** Events were colored only by status (`Scheduled` / `Completed` / `Cancelled`), making overlapping multi-day bars harder to visually track across cells and weeks. Users also needed a quick way to inspect full project details (dates, location, attendance split, budget progress, note) directly beside/below the calendar and jump to the project drill-down view.
3. **Narrow & Vertical Display Ergonomics (`<= 1150px`, `<= 1024px`, `<= 768px`, `<= 480px`):** On screens `<= 760px`, the legacy layout kept a `62px` fixed left sidebar and `margin-left: 62px` on `.main-area`, squeezing narrow phone screens and portrait/vertical monitors, while split grids and the assistant panel could crowd content.

## Decision

1. **Integrate `@svar-ui/svelte-calendar` (`^2.7.1`) for Month, Week, and Day Views:**
   - Guard `<SvarCalendar>` rendering inside `{#if browser}` from `$app/environment` while preserving `#calGrid` and `#calDetail` SSR markup for clean server rendering and tests.
   - Wrap `<SvarCalendar>` in `<Willow fonts={false}>` (light) or `<WillowDark fonts={false}>` (dark) synchronized with `themeCtx.value` passed from `src/routes/+page.svelte`, overriding `--wx-*` tokens inside `.svar-cal-wrapper` to match Clubhouse surfaces, borders, and typography (`DM Sans` / `Noto Sans Thai`).
   - Run SVAR Calendar in dashboard read-only mode (`readonly={true}`, `toolbar={null}`), intercepting `add-event`, `update-event`, `move-event`, and `delete-event` to return `false`, intercepting `select-event` to highlight the clicked event and update the Selected Event & Day Inspector without opening SVAR's editor modal, and intercepting Month/Week day-number `navigate-to` (`view === 'day'`) so clicking a date selects that day in the inspector without leaving the active view.

2. **Map `ProjectSummary[]` via `toSvarEvents()` & Deterministic 8-Color `EVENT_PALETTE`:**
   - Preserve all existing pure calendar helpers in `src/lib/calendar.ts` (`buildByDateMap`, `buildMonthGrid`, `buildWeekDays`, `buildWeekSpans`, etc.) for backward compatibility.
   - Add `EVENT_PALETTE` (8 light/dark-compatible Clubhouse colors: Terracotta, Sage, Ocean, Plum, Amber, Teal, Rose, Indigo) and `getEventColorIndex(eventId)` (numeric suffix `(num - 1) % 8` with deterministic string hash fallback).
   - `toSvarEvents(events)` converts each `ProjectSummary` into local-midnight `start`/`end` `Date` objects with `allDay: true` and an **exclusive `end` date (`end_date + 1 day`)** matching SVAR `LinearScale` and `GridSection` span math, so single-day and multi-day (`ต่อเนื่อง`) events render as continuous horizontal bars across Month, Week, and Day views with consistent `ev-palette-0..7` colors.
   - Keep Clubhouse top quick-jump controls (`All` / `Multi-day ต่อเนื่อง` / `In Progress` / `Completed` / `Cancelled` filter pills, `#calJumpMonth`, `#calJumpEvent`, `Month` / `Week` / `Day` switcher, Prev/Today/Next) alongside the sticky `.cal-inspector` spotlight card and day agenda list, plus `CalendarTooltip.svelte` on hover.

3. **Mobile & Vertical Display Responsive Overhaul:**
   - **Vertical/Portrait Displays (`<= 1150px`):** Stack `.dashboard-grid`, `.bottom-grid`, `.two-panel-grid`, `.demographics-split`, and `.cal-split-layout` to `1fr`, convert `.cal-inspector` to `position: static`, adapt `.stat-grid` (`auto-fit, minmax(220px, 1fr)`), `.project-overview`, and `.overview-4` into balanced 2-column grids, and size `.svar-cal-wrapper` to `540px`.
   - **Off-Canvas Drawer (`<= 1024px`):** Collapse `.sidebar` off-canvas (`transform: translateX(-105%)`), give `.main-area` `100%` width (`margin-left: 0`, `overflow-x: clip` preserving sticky headers), add `#mobileMenuBtn` in `.topbar`, and slide `#appSidebar.mobile-open` over `.sidebar-backdrop` with full labels and automatic close on navigation or `Escape`. Add a dedicated `.top-user-menu` popover on `.top-avatar` so profile/Google link/logout actions work at any viewport without opening the drawer.
   - **Mobile Bottom Navigation & Phones (`<= 900px`, `<= 768px`, `<= 480px`):** Render `.mobile-bottom-nav` fixed at the bottom (`Summary`, `Projects`, `Calendar`, `Members`, `Budget`, and `Users` for admins) with safe-area padding, elevate `.assistant-fab` and `.toasts` above the bottom bar, constrain `.assistant-panel` within `calc(100vw - 24px)`, and refine `.svar-cal-wrapper` (`480px` / `430px`), filter pill scrolling, and stacked table/modal forms on small phones.

## Consequences

- **Positive:** Multi-day events span continuously across calendar cells in Month and Week views with consistent per-event colors across both light and dark modes; clicking any bar or date cell surfaces rich project telemetry and 1-click drill-down; narrow phones and portrait monitors use 100% of viewport width without horizontal overflow.
- **Note:** `<SvarCalendar>` renders client-side inside `{#if browser}` because SVAR's ResizeObserver/layout lifecycle relies on browser DOM measurement; SSR still renders the calendar shell, controls, and inspector cleanly.
