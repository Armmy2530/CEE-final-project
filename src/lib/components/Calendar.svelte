<script lang="ts">
  import {
    buildByDateMap,
    buildMonthGrid,
    buildWeekDays,
    buildWeekSpans,
    DOW_LABELS,
    getMonthTitle,
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

  $effect(() => {
    if (today) {
      if (!calMonth) calMonth = today.slice(0, 7);
      if (!weekStart) weekStart = getWeekStart(today);
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
      <div>
        <h3>Schedule &amp; multi-day spans</h3>
        <p class="muted" style="font-size:12px;margin:0">
          Switch between Month and Week views; click any event to open its project details.
        </p>
      </div>

      <div class="cal-controls">
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

    {#if viewMode === 'month'}
      <div class="cal-grid cal-dow" id="calDow">
        {#each DOW_LABELS as d}
          <div>{d}</div>
        {/each}
      </div>

      <div class="cal-grid" id="calGrid">
        {#each calCells as cell (cell.key)}
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
            <span class="cal-num">{cell.dayNum}</span>
            {#each cell.evs.slice(0, 2) as e (e.event_id)}
              <button
                type="button"
                class={`chip ${e.status}`}
                title={`Open ${e.title}`}
                onclick={() => handleOpenEvent(e.event_id, cell.key)}
              >
                {e.status === 'Completed' ? '\u2713 ' : ''}{e.title}{e.dayCount > 1 ? ` (${e.dayNo}/${e.dayCount})` : ''}
              </button>
            {/each}
            {#if cell.evs.length > 2}
              <span class="cal-more">+{cell.evs.length - 2} more</span>
            {/if}
            {#if cell.evs.length}
              <span class="cal-dots" aria-hidden="true">
                {#each cell.evs as _}
                  <i></i>
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
                      {span.event.status === 'Completed' ? '\u2713 ' : ''}{span.event.title}
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

        <div class="cal-week-agenda">
          {#each weekDays as day (day.key)}
            <div class="cal-agenda-col" class:today={day.today} class:selected={day.selected}>
              <button
                type="button"
                class="cal-agenda-mobile-hdr"
                onclick={() => (calSelected = day.key)}
              >
                <span>{day.dowLabel} {day.dayNum} {day.monthShort}</span>
                <span class="muted">
                  {day.evs.length ? `${day.evs.length} event${day.evs.length === 1 ? '' : 's'}` : 'No events'}
                </span>
              </button>

              {#if !day.evs.length}
                <button
                  type="button"
                  class="cal-agenda-empty"
                  aria-label={`${fmtDate(day.key)}: no events`}
                  onclick={() => (calSelected = day.key)}
                >
                  No events
                </button>
              {:else}
                <div class="cal-agenda-list">
                  {#each day.evs as ev (ev.event_id)}
                    <button
                      type="button"
                      class={`cal-agenda-card ${ev.status}`}
                      title={`Open ${ev.title}`}
                      onclick={() => handleOpenEvent(ev.event_id, day.key)}
                    >
                      <div class="agenda-card-top">
                        <span class="agenda-title">{ev.title}</span>
                        <span class={`badge st-${ev.status}`}>{ev.status}</span>
                      </div>
                      <div class="agenda-meta">
                        <span>{ev.location || 'TBA'}</span>
                        <span>{ev.dayCount > 1 ? `Day ${ev.dayNo} of ${ev.dayCount}` : '1-day event'}</span>
                      </div>
                      <div class="agenda-budget">
                        <span>Plan {baht(ev.budget_planned)}</span>
                        <span>Actual {baht(ev.actual)}</span>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="cal-detail" id="calDetail" aria-live="polite">
      {#if calSelected}
        {@const list = byDate[calSelected] || []}
        <div class="cal-detail-head">
          <strong>{fmtDate(calSelected)}</strong>
          {#if list.length}
            <span class="muted">{list.length} {list.length === 1 ? 'event' : 'events'}</span>
          {/if}
        </div>
        {#if !list.length}
          <p class="muted" style="margin-top:6px">No events on this day.</p>
        {:else}
          <ul>
            {#each list as e (e.event_id)}
              <li class="cal-detail-item">
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
                    <span>{baht(e.actual)} / {baht(e.budget_planned)} planned</span>
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
    </div>
  </article>
</section>
