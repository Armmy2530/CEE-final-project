# ADR-0004: Google Calendar-Style Week & Month Views with Project Navigation

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** Calendar helpers (`src/lib/calendar.ts`), Calendar component (`src/lib/components/Calendar.svelte`), Summary & Project wiring (`src/lib/components/SummaryView.svelte`, `src/lib/components/ProjectsView.svelte`, `src/routes/+page.svelte`), styling (`src/app.css`), and unit tests (`tests/app.test.ts`).

## Context

The initial Summary dashboard embedded an inline Month-only calendar grid directly inside `SummaryView.svelte`. That implementation had two key limitations:

1. **No direct click-through to Project Details:** Selecting a day listed the day's events in `#calDetail`, but clicking an event chip or detail row could not open that project directly in the **Project data** detail view. Users had to switch tabs manually and search for the project by name.
2. **No Week view for multi-day concurrent projects:** Several club initiatives span multiple days or weeks simultaneously—most notably in November 2026, where `AC-014` (*Peer Teaching: Circuit Analysis*, 19 Oct – 4 Dec), `AC-015` (*Final Exam Tutoring Camp*, 2 Nov – 27 Nov), `AC-016` (*Data Analytics with Excel and Power BI*, 18 – 20 Nov), and `AC-017` (*Engineering Research Showcase*, 20 – 21 Nov) overlap within the same week. A Month grid truncates cells after two chips (`+N more`), making it difficult to inspect multi-day overlaps and daily agendas at a glance like Google Calendar.

In addition, embedding all date-grid math inside `SummaryView.svelte` prevented unit-testing the calendar grid and multi-day span clipping logic without mounting Svelte components.

## Decision

1. **Pure Calendar Math & Layout Module (`src/lib/calendar.ts`):**
   - Extract deterministic UTC date and layout helpers into `src/lib/calendar.ts` so they can be unit-tested in `tests/app.test.ts`:
     - `buildByDateMap(events)`: Maps each active project day (`projectDaysOf`) with `dayNo` and `dayCount` metadata.
     - `getMonthTitle`, `shiftMonthStr`, `buildMonthGrid`: Computes Month view titles (`November 2026`), month stepping, and 5- or 6-row Sunday–Saturday cell grids.
     - `getWeekStart`, `getWeekRange`, `shiftWeekStr`, `getWeekTitle`: Computes Sunday-anchored week bounds, `±7`-day week shifts, and formatted range titles across same-month (`15 – 21 Nov 2026`), cross-month (`29 Nov – 5 Dec 2026`), and cross-year (`27 Dec 2026 – 2 Jan 2027`) boundaries.
     - `buildWeekDays`: Produces the 7 day column headers and per-day agenda event lists for a week.
     - `buildWeekSpans`: Filters multi-day events overlapping `[weekStart, weekEnd]`, clips start/end columns to `1..7` (`grid-column: startCol / span spanCols`), computes `continuesBefore` (`◀`) and `continuesAfter` (`▶`) indicators, formats `Day x–y of n` progress strings, and packs concurrent bars into non-overlapping horizontal lanes (`lane`).

2. **Dedicated `Calendar.svelte` Component (`src/lib/components/Calendar.svelte`):**
   - Replace the inline calendar block in `SummaryView.svelte` with `<Calendar events={dash?.events ?? []} today={dash?.today ?? ''} {onOpenProject} />`.
   - Provide a segmented view switcher `[ Month | Week ]`, Previous (`‹`), Next (`›`), and `Today` controls in the header:
     - **Month view:** `‹` / `›` navigates by 1 month; renders the 7-column Sun–Sat grid with clickable event chips (`✓ Title (dayNo/dayCount)`), `+N more` overflow badge, mobile dot indicators, and selected-day highlight.
     - **Week view (Google Calendar style):** `‹` / `›` shifts the active week by `-7` / `+7` days; `Today` jumps to `dash.today`'s week and selects `dash.today`. Renders:
       1. **Top Week Header Row:** 7 day column headers (`Sun 15` .. `Sat 21`) with a circular accent badge on `Today` and active state on the selected day.
       2. **Multi-day / Spanning Banner Lanes:** Horizontal spanning bars (`grid-column: startCol / span spanCols`) aligned over the 7-day strip, with `◀` / `▶` continuation indicators, status pill, and `Day x–y of n` progress.
       3. **7-Column Day Agenda Columns:** Rich daily event cards below the spanning strip showing Title, Status pill, Location, `Day x of n`, and Planned vs Actual budget.
   - Maintain the selected-day detail panel (`#calDetail`) below both views, keeping month/week context synchronized when switching modes.

3. **Direct Project Detail Navigation:**
   - Add an `onOpenProject?: (eventId: string) => void` callback from `src/routes/+page.svelte` → `SummaryView.svelte` → `Calendar.svelte`, paired with bindable `selectedProjectId` in `ProjectsView.svelte`.
   - Clicking an event chip in Month view, a spanning bar or agenda card in Week view, or an event link / `"Open project →"` button in `#calDetail` sets `selectedProjectId = eventId` and switches `activePage = 'projects'`, landing directly on the project's detail page.

4. **Theme-Consistent & Responsive Styling (`src/app.css`):**
   - Style the segmented switcher, circular today badge, spanning banner bars, day agenda cards, and `"Open project →"` actions using existing warm cream/amber CSS variables (`--surface`, `--surface-2`, `--border`, `--accent`, `--accent-fill`, `--on-accent`, `--ok`, etc.) so both Light and Dark themes remain cohesive.
   - Under `@media (max-width: 700px)`, preserve horizontal alignment for the Week header and spanning strip via horizontal scrolling while stacking the 7-day agenda columns vertically for readability.

## Consequences

- **Positive:** Concurrent multi-day events in November 2026 (`AC-014`, `AC-015`, `AC-016`, `AC-017`) and across any week are immediately legible in Google Calendar-style lanes alongside daily budget/location cards.
- **Positive:** Pure calendar layout math in `src/lib/calendar.ts` is decoupled from Svelte runes and covered by deterministic unit tests in `tests/app.test.ts`.
- **Positive:** Users can jump from any calendar event directly into its full Project Detail page with one click while retaining day selection in `#calDetail`.
- **Note:** Only multi-day projects (`days > 1`) are placed in the top spanning strip; single-day projects appear in the 7-column Day Agenda below and in `#calDetail` to avoid duplicating single-day items in the spanning strip.
