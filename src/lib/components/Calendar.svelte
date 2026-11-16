<script lang="ts">
  import {
    buildByDateMap,
    buildMonthGrid,
    buildWeekDays,
    buildWeekSpans,
    DOW_LABELS,
    getMonthTitle,
    getWeekRange,
    getWeekStart,
    getWeekTitle,
    shiftMonthStr,
    shiftWeekStr,
    type CalViewMode
  } from '$lib/calendar';
  import { addDayStr, baht, fmtDate } from '$lib/format';
  import type { ProjectSummary } from '$lib/types';

  let {
    events,
    today,
    standalone = true,
    onOpenProject
  }: {
    events: ProjectSummary[];
    today: string;
    standalone?: boolean;
    onOpenProject?: (eventId: string) => void;
  } = $props();

  let viewMode = $state<CalViewMode>('month');
  let calMonth = $state('');
  let weekStart = $state('');
  let calSelected = $state<string | null>(null);
  let weekFilter = $state<'all' | 'with-events'>('all');

  $effect(() => {
    if (today) {
      if (!calMonth) calMonth = today.slice(0, 7);
      if (!weekStart) weekStart = getWeekStart(today);
      if (calSelected === null) calSelected = today;
    }
  });

  const byDate = $derived.by(() => buildByDateMap(events));

  const calTitle = $derived.by(() => {
    if (viewMode === 'month') return getMonthTitle(calMonth);
    return getWeekTitle(weekStart);
  });

  const calCells = $derived.by(() => {
    if (!calMonth || !today) return [];
    return buildMonthGrid(calMonth, today, calSelected, byDate);
  });

  const weekDays = $derived.by(() => {
    if (!weekStart || !today) return [];
    return buildWeekDays(weekStart, today, calSelected, byDate);
  });

  const weekSpans = $derived.by(() => {
    if (!weekStart) return [];
    return buildWeekSpans(weekStart, events);
  });

  const visibleWeekDays = $derived.by(() => {
    if (weekFilter === 'with-events') {
      return weekDays.filter((d) => d.evs.length > 0);
    }
    return weekDays;
  });

  const periodEventsCount = $derived.by(() => {
    const ids = new Set<string>();
    if (viewMode === 'month') {
      if (!calMonth) return 0;
      const monthPrefix = `${calMonth}-`;
      for (const [day, list] of Object.entries(byDate)) {
        if (day.startsWith(monthPrefix)) {
          for (const ev of list) ids.add(ev.event_id);
        }
      }
      return ids.size;
    }
    if (!weekStart) return 0;
    const { start, end } = getWeekRange(weekStart);
    for (const [day, list] of Object.entries(byDate)) {
      if (day >= start && day <= end) {
        for (const ev of list) ids.add(ev.event_id);
      }
    }
    return ids.size;
  });

  const eventMonths = $derived.by(() => {
    const counts = new Map<string, Set<string>>();
    for (const [day, list] of Object.entries(byDate)) {
      const m = day.slice(0, 7);
      if (!counts.has(m)) counts.set(m, new Set());
      const set = counts.get(m)!;
      for (const ev of list) set.add(ev.event_id);
    }
    if (calMonth && !counts.has(calMonth)) {
      counts.set(calMonth, new Set());
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, set]) => ({
        month,
        label: getMonthTitle(month),
        count: set.size
      }));
  });

  function switchView(next: CalViewMode) {
    if (next === viewMode) return;
    if (next === 'week') {
      const anchor =
        calSelected && (!calMonth || calSelected.startsWith(calMonth))
          ? calSelected
          : today && calMonth && today.startsWith(calMonth)
            ? today
            : calMonth
              ? `${calMonth}-01`
              : today;
      if (anchor) weekStart = getWeekStart(anchor);
    } else if (weekStart) {
      const weekEnd = addDayStr(weekStart, 6);
      const anchor =
        calSelected && calSelected >= weekStart && calSelected <= weekEnd
          ? calSelected
          : addDayStr(weekStart, 3);
      calMonth = anchor.slice(0, 7);
    }
    viewMode = next;
  }

  function shiftPeriod(delta: number) {
    if (viewMode === 'month') {
      if (!calMonth) return;
      calMonth = shiftMonthStr(calMonth, delta);
    } else {
      if (!weekStart) return;
      weekStart = shiftWeekStr(weekStart, delta);
    }
  }

  function jumpToMonth(monthStr: string) {
    if (!monthStr) return;
    calMonth = monthStr;
    if (viewMode === 'week') {
      weekStart = getWeekStart(`${monthStr}-01`);
    }
    const firstWithEvent = Object.keys(byDate)
      .filter((d) => d.startsWith(`${monthStr}-`))
      .sort()[0];
    if (firstWithEvent) calSelected = firstWithEvent;
  }

  function jumpToday() {
    if (!today) return;
    calMonth = today.slice(0, 7);
    weekStart = getWeekStart(today);
    calSelected = today;
  }

  function handleOpenEvent(eventId: string, dayKey?: string) {
    if (dayKey) calSelected = dayKey;
    onOpenProject?.(eventId);
  }
</script>

<section id="calendar" class="page-content">
  {#if standalone}
    <div class="page-heading">
      <div>
        <p class="eyebrow">WORKSPACE <span class="heading-dot">&middot;</span> CALENDAR</p>
        <h1>Events calendar</h1>
        <p class="subheading">Keep track of everything happening this semester.</p>
      </div>
    </div>
  {/if}

  <article class="panel calendar-card">
    <div class="card-head cal-head">
      <div class="cal-title-block">
        <div class="cal-heading-row">
          <h3>Schedule &amp; multi-day spans</h3>
          <span class="cal-summary-pill">
            {periodEventsCount} {periodEventsCount === 1 ? 'event' : 'events'} in {calTitle || 'view'}
          </span>
        </div>
        <div class="cal-legend" aria-label="Event status legend">
          <span class="cal-legend-pill scheduled"><i aria-hidden="true"></i> Scheduled</span>
          <span class="cal-legend-pill completed"><i aria-hidden="true"></i> Completed</span>
          <span class="cal-legend-pill cancelled"><i aria-hidden="true"></i> Cancelled</span>
        </div>
      </div>

      <div class="cal-controls">
        {#if eventMonths.length}
          <label class="cal-jump-wrap">
            <span class="sr-only">Jump to month</span>
            <select
              id="calJumpMonth"
              class="cal-jump-select"
              aria-label="Jump to month"
              value={calMonth}
              onchange={(e) => jumpToMonth((e.target as HTMLSelectElement).value)}
            >
              {#each eventMonths as m (m.month)}
                <option value={m.month}>
                  {m.label} ({m.count})
                </option>
              {/each}
            </select>
          </label>
        {/if}

        <div class="cal-seg" role="group" aria-label="Calendar view">
          <button
            type="button"
            id="calViewMonth"
            aria-pressed={viewMode === 'month'}
            onclick={() => switchView('month')}
          >
            Month
          </button>
          <button
            type="button"
            id="calViewWeek"
            aria-pressed={viewMode === 'week'}
            onclick={() => switchView('week')}
          >
            Week
          </button>
        </div>

        <div class="cal-nav">
          <button
            class="btn small"
            id="calPrev"
            type="button"
            aria-label={viewMode === 'month' ? 'Previous month' : 'Previous week'}
            onclick={() => shiftPeriod(-1)}
          >
            &lsaquo;
          </button>
          <strong id="calTitle" aria-live="polite">{calTitle}</strong>
          <button
            class="btn small"
            id="calNext"
            type="button"
            aria-label={viewMode === 'month' ? 'Next month' : 'Next week'}
            onclick={() => shiftPeriod(1)}
          >
            &rsaquo;
          </button>
          <button class="btn small" id="calToday" type="button" onclick={jumpToday}>Today</button>
        </div>
      </div>
    </div>

    <div class="cal-split">
      <div class="cal-main">
        {#if viewMode === 'month'}
          <div class="cal-grid cal-dow" id="calDow">
            {#each DOW_LABELS as d}
              <div>{d}</div>
            {/each}
          </div>

          <div class="cal-grid cal-month-unified" id="calGrid">
            {#each calCells as cell (cell.key)}
              {@const shownChips = cell.evs.length > 3 ? cell.evs.slice(0, 2) : cell.evs.slice(0, 3)}
              <div
                class="cal-cell"
                class:other={cell.other}
                class:today={cell.today}
                class:selected={cell.selected}
              >
                <button
                  type="button"
                  class="cal-cell-hit"
                  aria-pressed={cell.selected}
                  aria-label={`${fmtDate(cell.key)}${
                    cell.evs.length
                      ? ': ' +
                        cell.evs
                          .map(
                            (e) =>
                              `${e.title}${e.dayCount > 1 ? ` day ${e.dayNo} of ${e.dayCount}` : ''} (${e.status})`
                          )
                          .join(', ')
                      : ': no events'
                  }`}
                  onclick={() => (calSelected = cell.key)}
                ></button>
                <div class="cal-cell-top">
                  <span class="cal-num" class:is-today={cell.today}>{cell.dayNum}</span>
                  {#if cell.evs.length > 0}
                    <span class="cal-ev-count" title={`${cell.evs.length} events`}>
                      {cell.evs.length}
                    </span>
                  {/if}
                </div>
                {#each shownChips as e (e.event_id)}
                  <button
                    type="button"
                    class={`chip ${e.status}`}
                    title={`Open ${e.title}${e.dayCount > 1 ? ` (Day ${e.dayNo} of ${e.dayCount})` : ''}`}
                    onclick={() => handleOpenEvent(e.event_id, cell.key)}
                  >
                    <span class="chip-title">
                      {e.status === 'Completed' ? '✓ ' : ''}{e.title}
                    </span>
                    {#if e.dayCount > 1}
                      <span class="chip-day">D{e.dayNo}</span>
                    {/if}
                  </button>
                {/each}
                {#if cell.evs.length > 3}
                  <button
                    type="button"
                    class="cal-more-btn"
                    onclick={() => (calSelected = cell.key)}
                  >
                    +{cell.evs.length - 2} more
                  </button>
                {/if}
                {#if cell.evs.length}
                  <span class="cal-dots" aria-hidden="true">
                    {#each cell.evs as ev}
                      <i class={`dot-${ev.status}`}></i>
                    {/each}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="cal-week" id="calWeek">
            <div class="cal-week-scroll">
              <div class="cal-week-header">
                {#each weekDays as day (day.key)}
                  <button
                    type="button"
                    class="cal-week-hdr-btn"
                    class:today={day.today}
                    class:selected={day.selected}
                    aria-pressed={day.selected}
                    aria-label={`${fmtDate(day.key)}${day.evs.length ? `, ${day.evs.length} events` : ', no events'}`}
                    onclick={() => (calSelected = day.key)}
                  >
                    <span class="cal-week-dow">{day.dowLabel}</span>
                    <span class="cal-week-daynum" class:is-today={day.today}>{day.dayNum}</span>
                    {#if day.evs.length}
                      <span class="cal-week-hdr-dots" aria-hidden="true">
                        {#each day.evs.slice(0, 4) as ev}
                          <i class={`dot-${ev.status}`}></i>
                        {/each}
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>

              <div class="cal-week-strip" aria-label="Multi-day events">
                <div class="cal-week-strip-bg" aria-hidden="true">
                  {#each weekDays as day (day.key)}
                    <div class="cal-week-strip-col" class:today={day.today} class:selected={day.selected}></div>
                  {/each}
                </div>
                {#if weekSpans.length}
                  <div class="cal-week-spans">
                    {#each weekSpans as span (span.event.event_id)}
                      <button
                        type="button"
                        class={`cal-span-bar ${span.event.status}`}
                        class:continues-before={span.continuesBefore}
                        class:continues-after={span.continuesAfter}
                        style={`grid-column: ${span.startCol} / span ${span.spanCols}; grid-row: ${span.lane + 1};`}
                        title={`Open ${span.event.title} (${span.dayRangeText})`}
                        onclick={() => handleOpenEvent(span.event.event_id, addDayStr(weekStart, span.startCol - 1))}
                      >
                        {#if span.continuesBefore}
                          <span class="span-arrow" aria-label="Continues from previous week">&#9664;</span>
                        {/if}
                        <span class="span-title">
                          {span.event.status === 'Completed' ? '✓ ' : ''}{span.event.title}
                        </span>
                        <span class="span-meta">
                          <span class={`badge st-${span.event.status} span-status`}>{span.event.status}</span>
                          <span class="span-days">{span.dayRangeText}</span>
                        </span>
                        {#if span.continuesAfter}
                          <span class="span-arrow" aria-label="Continues into next week">&#9654;</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {:else}
                  <p class="cal-week-strip-empty">No multi-day events this week</p>
                {/if}
              </div>
            </div>

            <div class="cal-week-agenda-bar">
              <span class="cal-agenda-label">Weekly agenda</span>
              <div class="cal-seg cal-agenda-filter" role="group" aria-label="Filter week days">
                <button
                  type="button"
                  aria-pressed={weekFilter === 'all'}
                  onclick={() => (weekFilter = 'all')}
                >
                  All 7 days
                </button>
                <button
                  type="button"
                  aria-pressed={weekFilter === 'with-events'}
                  onclick={() => (weekFilter = 'with-events')}
                >
                  Days with events
                </button>
              </div>
            </div>

            <div class="cal-week-agenda-list">
              {#if !visibleWeekDays.length}
                <p class="cal-week-strip-empty">No events scheduled for this week.</p>
              {:else}
                {#each visibleWeekDays as day (day.key)}
                  <div
                    class="cal-agenda-row"
                    class:today={day.today}
                    class:selected={day.selected}
                    class:is-empty={!day.evs.length}
                  >
                    <button
                      type="button"
                      class="cal-agenda-date"
                      onclick={() => (calSelected = day.key)}
                    >
                      <span class="date-tile cal-agenda-tile">
                        <small>{day.dowLabel}</small>
                        <b>{day.dayNum}</b>
                        <small>{day.monthShort}</small>
                      </span>
                    </button>

                    <div class="cal-agenda-events">
                      {#if !day.evs.length}
                        <button
                          type="button"
                          class="cal-agenda-row-empty"
                          onclick={() => (calSelected = day.key)}
                        >
                          No events scheduled
                        </button>
                      {:else}
                        {#each day.evs as ev (ev.event_id)}
                          <div class={`cal-agenda-hcard ${ev.status}`}>
                            <div class="cal-agenda-hcard-main">
                              <div class="agenda-card-top">
                                <span class="agenda-title">{ev.title}</span>
                                <span class={`badge st-${ev.status}`}>{ev.status}</span>
                              </div>
                              <div class="agenda-meta">
                                <span>{ev.location || 'TBA'}</span>
                                <span>&middot;</span>
                                <span>{ev.dayCount > 1 ? `Day ${ev.dayNo} of ${ev.dayCount}` : '1-day event'}</span>
                                <span>&middot;</span>
                                <span>Plan {baht(ev.budget_planned)} / Actual {baht(ev.actual)}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              class="btn small cal-open-btn"
                              onclick={() => handleOpenEvent(ev.event_id, day.key)}
                            >
                              Open project &rarr;
                            </button>
                          </div>
                        {/each}
                      {/if}
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <aside class="cal-detail cal-inspector" id="calDetail" aria-live="polite">
        {#if calSelected}
          {@const list = byDate[calSelected] || []}
          <div class="cal-detail-head">
            <div>
              <span class="eyebrow cal-inspector-eyebrow">SELECTED DAY</span>
              <strong>{fmtDate(calSelected)}</strong>
            </div>
            <span class="pill">
              {list.length} {list.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          {#if !list.length}
            <div class="cal-inspector-empty">
              <p class="muted">No events scheduled on this day.</p>
              <small class="muted">Click any highlighted date in the calendar to inspect its projects.</small>
            </div>
          {:else}
            <ul>
              {#each list as e (e.event_id)}
                <li class={`cal-detail-item ${e.status}`}>
                  <div class="cal-detail-info">
                    <button
                      type="button"
                      class="cal-detail-link"
                      onclick={() => handleOpenEvent(e.event_id)}
                    >
                      <strong>{e.title}</strong>
                    </button>
                    <span class="cal-detail-meta">
                      <span class={`badge st-${e.status}`}>{e.status}</span>
                      <span>{e.location || 'TBA'}</span>
                      {#if e.dayCount > 1}
                        <span>Day {e.dayNo} of {e.dayCount}</span>
                      {/if}
                    </span>
                    <span class="cal-detail-budget">
                      {baht(e.actual)} spent / {baht(e.budget_planned)} planned
                    </span>
                  </div>
                  <button
                    type="button"
                    class="btn small cal-open-btn"
                    onclick={() => handleOpenEvent(e.event_id)}
                  >
                    Open project &rarr;
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="muted">Select a day to see its events.</p>
        {/if}
      </aside>
    </div>
  </article>
</section>
