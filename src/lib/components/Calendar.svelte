<script lang="ts">
  import { browser } from '$app/environment';
  import {
    Calendar as SvarCalendar,
    Willow,
    WillowDark,
    type CalendarInstanceApi,
    type CellContext,
    type EventContext
  } from '@svar-ui/svelte-calendar';
  import {
    buildByDateMap,
    EVENT_PALETTE,
    formatLocalIso,
    getDayTitle,
    getEventColorIndex,
    getMonthTitle,
    getWeekRange,
    getWeekStart,
    getWeekTitle,
    parseLocalDate,
    shiftDayStr,
    shiftMonthStr,
    shiftWeekStr,
    toSvarEvents,
    type CalViewMode
  } from '$lib/calendar';
  import { baht, fmtDate, fmtRange, pct } from '$lib/format';
  import type { ProjectSummary, ThemeMode } from '$lib/types';
  import CalendarTooltip from './CalendarTooltip.svelte';

  type CalFilterMode = 'all' | 'multiday' | 'Scheduled' | 'Completed' | 'Cancelled';

  const SVAR_VIEWS = ['month', 'week', 'day'];

  let {
    events = [],
    today = '',
    compact = false,
    standalone = true,
    theme = 'light',
    onOpenProject,
    onSelectProject
  }: {
    events: ProjectSummary[];
    today?: string;
    compact?: boolean;
    standalone?: boolean;
    theme?: ThemeMode;
    onOpenProject?: (eventId: string) => void;
    onSelectProject?: (eventId: string) => void;
  } = $props();

  let viewMode = $state<CalViewMode>('month');
  let filterMode = $state<CalFilterMode>('all');
  let anchorDate = $state('');
  let calSelected = $state<string | null>(null);
  let selectedEventId = $state<string | null>(null);
  let svarApi = $state<CalendarInstanceApi | null>(null);
  let monthDropOpen = $state(false);
  let eventDropOpen = $state(false);

  const openProjectCb = $derived(onOpenProject ?? onSelectProject);

  const fallbackToday = $derived.by(() => {
    if (today) return today;
    if (events.length) return events[0].date;
    return '2026-11-16';
  });

  $effect(() => {
    if (!anchorDate && fallbackToday) {
      anchorDate = fallbackToday;
    }
    if (calSelected === null && fallbackToday) {
      calSelected = fallbackToday;
    }
  });

  const multiDayCount = $derived(events.filter((e) => e.days > 1).length);
  const scheduledCount = $derived(events.filter((e) => e.status === 'Scheduled').length);
  const completedCount = $derived(events.filter((e) => e.status === 'Completed').length);
  const cancelledCount = $derived(events.filter((e) => e.status === 'Cancelled').length);

  const filteredEvents = $derived.by(() => {
    if (filterMode === 'all') return events;
    if (filterMode === 'multiday') return events.filter((e) => e.days > 1);
    return events.filter((e) => e.status === filterMode);
  });

  const sortedEvents = $derived.by(() =>
    filteredEvents
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.event_id.localeCompare(b.event_id))
  );

  const byDate = $derived.by(() => buildByDateMap(filteredEvents));
  const allByDate = $derived.by(() => buildByDateMap(events));

  const svarEvents = $derived.by(() => toSvarEvents(filteredEvents));
  const svarDate = $derived.by(() => parseLocalDate(anchorDate || fallbackToday));
  const activeMonth = $derived((anchorDate || fallbackToday).slice(0, 7));

  const calTitle = $derived.by(() => {
    const ref = anchorDate || fallbackToday;
    if (viewMode === 'month') return getMonthTitle(ref.slice(0, 7));
    if (viewMode === 'week') return getWeekTitle(getWeekStart(ref));
    return getDayTitle(ref);
  });

  const periodEventsCount = $derived.by(() => {
    const ids = new Set<string>();
    const ref = anchorDate || fallbackToday;
    if (viewMode === 'month') {
      const monthPrefix = `${ref.slice(0, 7)}-`;
      for (const [day, list] of Object.entries(byDate)) {
        if (day.startsWith(monthPrefix)) {
          for (const ev of list) ids.add(ev.event_id);
        }
      }
      return ids.size;
    }
    if (viewMode === 'week') {
      const { start, end } = getWeekRange(getWeekStart(ref));
      for (const [day, list] of Object.entries(byDate)) {
        if (day >= start && day <= end) {
          for (const ev of list) ids.add(ev.event_id);
        }
      }
      return ids.size;
    }
    for (const ev of byDate[ref] || []) ids.add(ev.event_id);
    return ids.size;
  });

  const eventMonths = $derived.by(() => {
    const counts = new Map<string, Set<string>>();
    for (const [day, list] of Object.entries(allByDate)) {
      const m = day.slice(0, 7);
      if (!counts.has(m)) counts.set(m, new Set());
      const set = counts.get(m)!;
      for (const ev of list) set.add(ev.event_id);
    }
    if (activeMonth && !counts.has(activeMonth)) {
      counts.set(activeMonth, new Set());
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, set]) => ({
        month,
        label: getMonthTitle(month),
        count: set.size
      }));
  });

  const activeMonthEntry = $derived.by(
    () =>
      eventMonths.find((m) => m.month === activeMonth) ?? {
        month: activeMonth,
        label: getMonthTitle(activeMonth),
        count: 0
      }
  );

  const selectedDayEvents = $derived.by(() => {
    if (!calSelected) return [];
    return byDate[calSelected] || [];
  });

  const selectedEvent = $derived.by(() => {
    if (selectedEventId) {
      const found = events.find((e) => e.event_id === selectedEventId);
      if (found) return found;
    }
    return selectedDayEvents[0] ?? null;
  });

  function selectDay(iso: string, preferredEventId?: string | null) {
    calSelected = iso;
    const dayList = byDate[iso] || [];
    if (preferredEventId) {
      selectedEventId = preferredEventId;
    } else if (!dayList.some((e) => e.event_id === selectedEventId)) {
      selectedEventId = dayList[0]?.event_id ?? null;
    }
  }

  function switchView(next: CalViewMode) {
    if (next === viewMode) return;
    if (calSelected && viewMode === 'month' && next !== 'month') {
      if (calSelected.startsWith(activeMonth)) {
        anchorDate = calSelected;
      }
    }
    viewMode = next;
    if (svarApi) {
      svarApi.exec('navigate-to', { view: next, date: parseLocalDate(anchorDate || fallbackToday) });
    }
  }

  function shiftPeriod(delta: number) {
    const ref = anchorDate || fallbackToday;
    if (viewMode === 'month') {
      const nextMonth = shiftMonthStr(ref.slice(0, 7), delta);
      anchorDate = `${nextMonth}-01`;
    } else if (viewMode === 'week') {
      anchorDate = shiftWeekStr(getWeekStart(ref), delta);
    } else {
      anchorDate = shiftDayStr(ref, delta);
      selectDay(anchorDate);
    }
  }

  function jumpToMonth(monthStr: string) {
    monthDropOpen = false;
    if (!monthStr) return;
    const firstWithEvent = Object.keys(byDate)
      .filter((d) => d.startsWith(`${monthStr}-`))
      .sort()[0];
    anchorDate = firstWithEvent || `${monthStr}-01`;
    selectDay(anchorDate);
  }

  function jumpToEvent(eventId: string) {
    eventDropOpen = false;
    if (!eventId) return;
    const ev = events.find((e) => e.event_id === eventId);
    if (!ev) return;
    anchorDate = ev.date;
    selectDay(ev.date, ev.event_id);
  }

  function toggleMonthDrop(e: MouseEvent) {
    e.stopPropagation();
    eventDropOpen = false;
    monthDropOpen = !monthDropOpen;
  }

  function toggleEventDrop(e: MouseEvent) {
    e.stopPropagation();
    monthDropOpen = false;
    eventDropOpen = !eventDropOpen;
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.cal-dropdown')) {
      monthDropOpen = false;
      eventDropOpen = false;
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      monthDropOpen = false;
      eventDropOpen = false;
    }
  }

  function jumpToday() {
    const ref = fallbackToday;
    anchorDate = ref;
    selectDay(ref);
  }

  function setFilter(next: CalFilterMode) {
    filterMode = next;
    if (selectedEventId) {
      const stillVisible =
        next === 'all' ||
        (next === 'multiday'
          ? (events.find((e) => e.event_id === selectedEventId)?.days ?? 0) > 1
          : events.find((e) => e.event_id === selectedEventId)?.status === next);
      if (!stillVisible) {
        selectedEventId = null;
      }
    }
  }

  function computeCellCss(ctx: CellContext): string {
    if (!ctx.date) return '';
    const iso = formatLocalIso(ctx.date);
    const classes = [`club-cell-${iso}`];
    if (iso === calSelected) classes.push('club-cell-selected');
    if (fallbackToday && iso === fallbackToday) classes.push('club-cell-today');
    return classes.join(' ');
  }

  function computeEventCss(ctx: EventContext): string {
    return String(ctx.event.id) === selectedEventId ? 'ev-selected' : '';
  }

  function initSvarApi(api: CalendarInstanceApi) {
    svarApi = api;

    api.intercept('select-event', (ev) => {
      if (ev && 'id' in ev && ev.id != null) {
        const id = String(ev.id);
        const found = events.find((item) => item.event_id === id);
        if (found) {
          const endIso = found.end_date || found.date;
          const nextDay =
            calSelected && calSelected >= found.date && calSelected <= endIso
              ? calSelected
              : found.date;
          selectDay(nextDay, found.event_id);
        }
      }
      return false;
    });

    api.intercept('navigate-to', (ev) => {
      if (
        ev &&
        'date' in ev &&
        ev.date instanceof Date &&
        'view' in ev &&
        ev.view === 'day' &&
        viewMode !== 'day'
      ) {
        const iso = formatLocalIso(ev.date);
        selectDay(iso);
        return false;
      }
    });

    api.intercept('add-event', () => false);
    api.intercept('update-event', () => false);
    api.intercept('move-event', () => false);
    api.intercept('delete-event', () => false);
  }

  function handleSvarWrapperClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest('.wx-bar-event') ||
      target.closest('.wx-box-event') ||
      target.closest('.wx-list-event') ||
      target.closest('.wx-more-button')
    ) {
      return;
    }

    const dayNumEl = target.closest('[data-date]') as HTMLElement | null;
    if (dayNumEl) {
      const iso = dayNumEl.getAttribute('data-date');
      if (iso) {
        selectDay(iso);
        return;
      }
    }

    let cellEl = target.closest('.wx-grid-cell') as HTMLElement | null;
    if (!cellEl && typeof document !== 'undefined' && document.elementsFromPoint) {
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      cellEl = (els.find((el) => el.classList?.contains('wx-grid-cell')) as HTMLElement) || null;
    }
    if (cellEl) {
      const match = cellEl.className.match(/club-cell-(\d{4}-\d{2}-\d{2})/);
      if (match) {
        selectDay(match[1]);
      }
    }
  }

  function handleInspectProject(eventId: string, dayKey?: string) {
    if (dayKey) calSelected = dayKey;
    selectedEventId = eventId;
    openProjectCb?.(eventId);
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<section id="calendar" class="page-content" class:cal-compact={compact}>
  {#if standalone && !compact}
    <div class="page-heading">
      <div>
        <p class="eyebrow">WORKSPACE <span class="heading-dot">&middot;</span> CALENDAR</p>
        <h1>Events calendar</h1>
        <p class="subheading">
          Multi-day spans and single-day events rendered with consistent event colors.
        </p>
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

        <div class="cal-filter-pills" role="group" aria-label="Filter calendar events">
          <button
            type="button"
            class="cal-filter-pill"
            class:active={filterMode === 'all'}
            onclick={() => setFilter('all')}
          >
            All ({events.length})
          </button>
          <button
            type="button"
            class="cal-filter-pill"
            class:active={filterMode === 'multiday'}
            onclick={() => setFilter('multiday')}
          >
            Multi-day ต่อเนื่อง ({multiDayCount})
          </button>
          <button
            type="button"
            class="cal-filter-pill"
            class:active={filterMode === 'Scheduled'}
            onclick={() => setFilter('Scheduled')}
          >
            In Progress ({scheduledCount})
          </button>
          <button
            type="button"
            class="cal-filter-pill"
            class:active={filterMode === 'Completed'}
            onclick={() => setFilter('Completed')}
          >
            Completed ({completedCount})
          </button>
          {#if cancelledCount > 0}
            <button
              type="button"
              class="cal-filter-pill"
              class:active={filterMode === 'Cancelled'}
              onclick={() => setFilter('Cancelled')}
            >
              Cancelled ({cancelledCount})
            </button>
          {/if}
        </div>
      </div>

      <div class="cal-controls">
        <div class="cal-jump-group">
          {#if eventMonths.length}
            <div class="cal-jump-wrap cal-dropdown" class:is-open={monthDropOpen}>
              <button
                type="button"
                id="calJumpMonth"
                class="cal-jump-select cal-dropdown-btn"
                aria-label="Jump to month"
                aria-haspopup="listbox"
                aria-expanded={monthDropOpen}
                onclick={toggleMonthDrop}
              >
                <span class="cal-dropdown-label">
                  {activeMonthEntry.label} ({activeMonthEntry.count})
                </span>
                <span class="cal-dropdown-caret" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </button>
              {#if monthDropOpen}
                <ul class="cal-dropdown-menu" role="listbox" aria-label="Jump to month">
                  {#each eventMonths as m (m.month)}
                    <li role="option" aria-selected={m.month === activeMonth}>
                      <button
                        type="button"
                        class="cal-dropdown-item"
                        class:selected={m.month === activeMonth}
                        onclick={() => jumpToMonth(m.month)}
                      >
                        <span class="cal-dropdown-item-main">{m.label}</span>
                        <span class="cal-dropdown-badge">{m.count}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}

          {#if sortedEvents.length}
            <div class="cal-jump-wrap cal-dropdown cal-dropdown-event" class:is-open={eventDropOpen}>
              <button
                type="button"
                id="calJumpEvent"
                class="cal-jump-select cal-jump-event cal-dropdown-btn"
                aria-label="Jump to event"
                aria-haspopup="listbox"
                aria-expanded={eventDropOpen}
                onclick={toggleEventDrop}
              >
                {#if selectedEvent}
                  <span
                    class={`cal-color-dot ev-swatch-${getEventColorIndex(selectedEvent.event_id)}`}
                    aria-hidden="true"
                  ></span>
                  <span class="cal-dropdown-label">
                    {selectedEvent.event_id} &middot; {selectedEvent.title}
                  </span>
                {:else}
                  <span class="cal-dropdown-label">Jump to event...</span>
                {/if}
                <span class="cal-dropdown-caret" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </button>
              {#if eventDropOpen}
                <ul
                  class="cal-dropdown-menu cal-event-menu"
                  role="listbox"
                  aria-label="Jump to event"
                >
                  {#each sortedEvents as ev (ev.event_id)}
                    {@const evColor = getEventColorIndex(ev.event_id)}
                    <li role="option" aria-selected={selectedEvent?.event_id === ev.event_id}>
                      <button
                        type="button"
                        class="cal-dropdown-item cal-dropdown-event-item"
                        class:selected={selectedEvent?.event_id === ev.event_id}
                        onclick={() => jumpToEvent(ev.event_id)}
                      >
                        <span class={`cal-color-dot ev-swatch-${evColor}`} aria-hidden="true"></span>
                        <span class="cal-dropdown-event-text">
                          <span class="cal-dropdown-event-title">
                            <strong>{ev.event_id}</strong> &middot; {ev.title}
                          </span>
                          <small class="cal-dropdown-event-meta">
                            {fmtDate(ev.date)}{ev.days > 1 ? ` · ${ev.days}d ต่อเนื่อง` : ''}
                          </small>
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>

        <div class="cal-seg cal-seg-3" role="group" aria-label="Calendar view">
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
          <button
            type="button"
            id="calViewDay"
            aria-pressed={viewMode === 'day'}
            onclick={() => switchView('day')}
          >
            Day
          </button>
        </div>

        <div class="cal-nav">
          <button
            class="btn small"
            id="calPrev"
            type="button"
            aria-label={`Previous ${viewMode}`}
            onclick={() => shiftPeriod(-1)}
          >
            &lsaquo;
          </button>
          <strong id="calTitle" aria-live="polite">{calTitle}</strong>
          <button
            class="btn small"
            id="calNext"
            type="button"
            aria-label={`Next ${viewMode}`}
            onclick={() => shiftPeriod(1)}
          >
            &rsaquo;
          </button>
          <button class="btn small" id="calToday" type="button" onclick={jumpToday}>Today</button>
        </div>
      </div>
    </div>

    <div class="cal-split cal-split-layout">
      <div class="cal-main">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          id="calGrid"
          class="svar-cal-wrapper"
          class:is-compact={compact}
          class:is-week-view={viewMode === 'week'}
          onclick={handleSvarWrapperClick}
        >
          {#if browser}
            {#if theme === 'dark'}
              <WillowDark fonts={false}>
                <SvarCalendar
                  events={svarEvents}
                  view={viewMode}
                  views={SVAR_VIEWS}
                  date={svarDate}
                  toolbar={null}
                  readonly={true}
                  cellCss={computeCellCss}
                  eventCss={computeEventCss}
                  tooltip={CalendarTooltip}
                  init={initSvarApi}
                />
              </WillowDark>
            {:else}
              <Willow fonts={false}>
                <SvarCalendar
                  events={svarEvents}
                  view={viewMode}
                  views={SVAR_VIEWS}
                  date={svarDate}
                  toolbar={null}
                  readonly={true}
                  cellCss={computeCellCss}
                  eventCss={computeEventCss}
                  tooltip={CalendarTooltip}
                  init={initSvarApi}
                />
              </Willow>
            {/if}
          {:else}
            <div class="cal-ssr-placeholder">
              <p class="muted">Loading calendar for {calTitle || 'current period'}...</p>
            </div>
          {/if}
        </div>
      </div>

      <aside class="cal-detail cal-inspector" id="calDetail" aria-live="polite">
        {#if selectedEvent}
          {@const colorIdx = getEventColorIndex(selectedEvent.event_id)}
          {@const palette = EVENT_PALETTE[colorIdx]}
          {@const budgetPctVal =
            selectedEvent.pct == null ? 0 : Math.min(100, Math.round(selectedEvent.pct * 100))}
          <div class={`cal-spotlight ${palette.cssClass}`}>
            <div class="cal-spotlight-top">
              <div class="cal-spotlight-badges">
                <span class={`cal-color-dot ev-swatch-${colorIdx}`} aria-hidden="true"></span>
                <span class="cal-spotlight-id">{selectedEvent.event_id}</span>
                <span class={`badge st-${selectedEvent.status}`}>{selectedEvent.status}</span>
                {#if selectedEvent.days > 1}
                  <span class="cal-multiday-pill">{selectedEvent.days}d ต่อเนื่อง</span>
                {/if}
              </div>
              <span class="badge">{selectedEvent.category}</span>
            </div>

            <h4 class="cal-spotlight-title">{selectedEvent.title}</h4>

            <dl class="cal-spotlight-facts">
              <div>
                <dt>Dates</dt>
                <dd>{fmtRange(selectedEvent)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{selectedEvent.location || 'TBA'}</dd>
              </div>
              <div>
                <dt>Attendance</dt>
                <dd>
                  {selectedEvent.attendees} checked in
                  <small class="muted">
                    ({selectedEvent.stats.staff} staff &middot; {selectedEvent.stats.participants} participants)
                  </small>
                </dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>
                  {baht(selectedEvent.actual)} / {baht(selectedEvent.budget_planned)}
                  <small class="muted">({pct(selectedEvent.pct)})</small>
                </dd>
              </div>
            </dl>

            <div class="mini-progress" aria-hidden="true" style="margin-top:8px">
              <span style={`width:${budgetPctVal}%`}></span>
            </div>

            {#if selectedEvent.description}
              <p class="cal-spotlight-note">{selectedEvent.description}</p>
            {/if}

            <div class="cal-spotlight-actions">
              <button
                type="button"
                class="btn primary small"
                onclick={() => handleInspectProject(selectedEvent.event_id)}
              >
                Inspect Project &rarr;
              </button>
            </div>
          </div>
        {/if}

        <div class="cal-day-section">
          {#if calSelected}
            <div class="cal-detail-head">
              <div>
                <span class="eyebrow cal-inspector-eyebrow">SELECTED DAY</span>
                <strong>{fmtDate(calSelected)}</strong>
              </div>
              <span class="pill">
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'event' : 'events'}
              </span>
            </div>

            {#if !selectedDayEvents.length}
              <div class="cal-inspector-empty">
                <p class="muted">No events scheduled on this day.</p>
                <small class="muted">
                  Click any event bar or date cell in the calendar to inspect its details.
                </small>
              </div>
            {:else}
              <ul>
                {#each selectedDayEvents as e (e.event_id)}
                  {@const cIdx = getEventColorIndex(e.event_id)}
                  <li
                    class={`cal-detail-item ev-palette-${cIdx} ${e.status}`}
                    class:is-focused={selectedEvent?.event_id === e.event_id}
                  >
                    <div class="cal-detail-info">
                      <button
                        type="button"
                        class="cal-detail-link"
                        onclick={() => (selectedEventId = e.event_id)}
                      >
                        <span class={`cal-color-dot ev-swatch-${cIdx}`} aria-hidden="true"></span>
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
                      onclick={() => handleInspectProject(e.event_id, calSelected ?? undefined)}
                    >
                      Open project &rarr;
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else}
            <p class="muted">Select a day or event to inspect its details.</p>
          {/if}
        </div>
      </aside>
    </div>
  </article>
</section>
