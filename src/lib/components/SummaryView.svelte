<script lang="ts">
  import { browser } from '$app/environment';
  import {
    Calendar as SvarCalendar,
    Willow,
    WillowDark,
    type CalendarInstanceApi,
    type CellContext
  } from '@svar-ui/svelte-calendar';
  import {
    formatLocalIso,
    getMonthTitle,
    parseLocalDate,
    shiftMonthStr,
    toSvarEvents
  } from '$lib/calendar';
  import { addDayStr, baht, getDisplayStatus, type DisplayStatus } from '$lib/format';
  import type { DashboardPayload, ProjectSummary, ThemeMode } from '$lib/types';
  import CalendarTooltip from './CalendarTooltip.svelte';
  import SelectMenu, { type SelectOption } from './SelectMenu.svelte';
  import type { PageId } from './Topbar.svelte';

  const SVAR_MONTH_VIEWS = ['month'];

  const YEAR_OPTIONS: SelectOption[] = [
    { value: 'all', label: 'Academic year 2026' },
    { value: '2026', label: '2026 events only' },
    { value: '2027', label: '2027 events only' }
  ];

  let {
    dash,
    loadError,
    refreshing,
    firstName = 'Member',
    isAdmin = false,
    theme = 'light',
    onRefresh,
    onOpenProject,
    onSelectPage,
    onOpenSheetPicker
  }: {
    dash: DashboardPayload | null;
    loadError: string;
    refreshing: boolean;
    firstName?: string;
    isAdmin?: boolean;
    theme?: ThemeMode;
    onRefresh: () => void;
    onOpenProject: (eventId: string) => void;
    onSelectPage?: (page: PageId) => void;
    onOpenSheetPicker?: () => void;
  } = $props();

  let yearFilter = $state<'all' | '2026' | '2027'>('all');
  let calMonth = $state('');
  let hoveredBudgetIdx = $state<number | null>(null);

  const today = $derived(dash?.today || '2026-11-18');

  $effect(() => {
    if (!calMonth && today) {
      calMonth = today.slice(0, 7);
    }
  });

  const lastUpdatedText = $derived.by(() => {
    const ts = dash?.meta?.fetchedAt;
    if (!ts) return 'Syncing...';
    const d = new Date(ts);
    const datePart = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const timePart = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${datePart}, ${timePart}`;
  });

  const scopedEvents = $derived.by(() => {
    const all = dash?.events ?? [];
    if (yearFilter === 'all') return all;
    return all.filter((e) => (e.date || '').startsWith(yearFilter));
  });

  const statusCounts = $derived.by(() => {
    let done = 0;
    let processing = 0;
    let waiting = 0;
    let cancelled = 0;
    for (const ev of scopedEvents) {
      const st = getDisplayStatus(ev, today);
      if (st === 'Done') done++;
      else if (st === 'Processing') processing++;
      else if (st === 'Waiting') waiting++;
      else cancelled++;
    }
    return { done, processing, waiting, cancelled };
  });

  const deptCount = $derived.by(() => {
    if (!dash) return 0;
    const majors = new Set(dash.members.map((m) => m.major || m.department).filter(Boolean));
    return majors.size || Object.keys(dash.membersByDepartment).length;
  });

  const budgetStats = $derived.by(() => {
    const planned =
      yearFilter === 'all'
        ? (dash?.metrics.budgetPlanned ?? 0)
        : scopedEvents.reduce((s, e) => s + e.budget_planned, 0);
    const actual =
      yearFilter === 'all'
        ? (dash?.metrics.budgetActual ?? 0)
        : scopedEvents.reduce((s, e) => s + e.actual, 0);
    const pctNum = planned > 0 ? Math.round((actual / planned) * 100) : 0;
    const remaining = Math.max(0, planned - actual);
    return { planned, actual, pctNum, remaining };
  });

  const budgetChartEvents = $derived.by(() => {
    const done = scopedEvents
      .filter((e) => getDisplayStatus(e, today) === 'Done')
      .sort((a, b) => a.event_id.localeCompare(b.event_id));
    const pool = done.length ? done : scopedEvents.slice().sort((a, b) => a.event_id.localeCompare(b.event_id));
    return pool.slice(0, 10);
  });

  const budgetChartMax = $derived.by(() => {
    let maxV = 10000;
    for (const e of budgetChartEvents) {
      if (e.budget_planned > maxV) maxV = e.budget_planned;
      if (e.actual > maxV) maxV = e.actual;
    }
    const step = maxV <= 25000 ? 5000 : 10000;
    return Math.ceil((maxV * 1.08) / step) * step;
  });

  const budgetTicks = $derived.by(() => {
    const out: number[] = [];
    const steps = 5;
    for (let i = steps; i >= 0; i--) {
      out.push(Math.round((budgetChartMax / steps) * i));
    }
    return out;
  });

  function formatK(n: number): string {
    if (n === 0) return '0k';
    if (n >= 1000) {
      const k = n / 1000;
      return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    }
    return String(n);
  }

  function participantCount(ev: ProjectSummary): number {
    return ev.stats.participants > 0 ? ev.stats.participants : ev.attendees;
  }

  function shortBarName(title: string): string {
    return title
      .replace(/^Peer Teaching:\s*/i, '')
      .replace(/^Engineering\s+/i, '')
      .replace(/\s+Engineering\s+/i, ' ');
  }

  const topParticipantEvents = $derived.by(() => {
    const done = scopedEvents.filter((e) => getDisplayStatus(e, today) === 'Done');
    const pool = done.length >= 6 ? done : scopedEvents;
    return pool
      .slice()
      .sort((a, b) => participantCount(b) - participantCount(a) || a.event_id.localeCompare(b.event_id))
      .slice(0, 6);
  });

  const topParticipantMax = $derived.by(() => {
    return Math.max(1, ...topParticipantEvents.map((e) => participantCount(e)));
  });

  const svarEvents = $derived.by(() => toSvarEvents(scopedEvents));
  const svarDate = $derived.by(() =>
    parseLocalDate(calMonth ? `${calMonth}-01` : today || '2026-11-18')
  );

  function computeCellCss(ctx: CellContext): string {
    if (!ctx.date) return '';
    const iso = formatLocalIso(ctx.date);
    return today && iso === today ? `club-cell-${iso} club-cell-today` : `club-cell-${iso}`;
  }

  function initSvarApi(api: CalendarInstanceApi) {
    api.intercept('select-event', (ev) => {
      if (ev && 'id' in ev && ev.id != null) {
        onOpenProject(String(ev.id));
      }
      return false;
    });
    api.intercept('navigate-to', (ev) => {
      if (ev && 'view' in ev && ev.view !== 'month') {
        return false;
      }
    });
    api.intercept('add-event', () => false);
    api.intercept('update-event', () => false);
    api.intercept('move-event', () => false);
    api.intercept('delete-event', () => false);
  }

  interface UpcomingMilestone {
    event: ProjectSummary;
    targetDate: string;
    kind: 'starts' | 'ends';
    daysDiff: number;
    status: DisplayStatus;
  }

  function diffDaysIso(fromIso: string, toIso: string): number {
    const a = Date.parse(`${fromIso}T00:00:00Z`);
    const b = Date.parse(`${toIso}T00:00:00Z`);
    return Math.round((b - a) / 86400000);
  }

  const upcomingList = $derived.by(() => {
    const horizon = addDayStr(today, 30);
    const items: UpcomingMilestone[] = [];
    for (const ev of scopedEvents) {
      const status = getDisplayStatus(ev, today);
      if (status === 'Done' || status === 'Cancelled') continue;
      if (ev.date >= today && ev.date <= horizon) {
        items.push({
          event: ev,
          targetDate: ev.date,
          kind: 'starts',
          daysDiff: diffDaysIso(today, ev.date),
          status
        });
      } else if (ev.date < today && ev.end_date >= today && ev.end_date <= horizon) {
        items.push({
          event: ev,
          targetDate: ev.end_date,
          kind: 'ends',
          daysDiff: diffDaysIso(today, ev.end_date),
          status
        });
      }
    }
    items.sort(
      (a, b) =>
        a.targetDate.localeCompare(b.targetDate) || a.event.event_id.localeCompare(b.event.event_id)
    );
    if (items.length > 0) return items.slice(0, 5);

    return scopedEvents
      .filter((e) => e.status === 'Scheduled')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4)
      .map((ev) => ({
        event: ev,
        targetDate: ev.date >= today ? ev.date : ev.end_date,
        kind: (ev.date >= today ? 'starts' : 'ends') as 'starts' | 'ends',
        daysDiff: Math.max(0, diffDaysIso(today, ev.date >= today ? ev.date : ev.end_date)),
        status: getDisplayStatus(ev, today)
      }));
  });

  function dateTile(dateStr: string): { day: string; month: string } {
    const p = dateStr.split('-');
    if (p.length !== 3) return { day: '--', month: '' };
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return {
      day: String(d.getUTCDate()).padStart(2, '0'),
      month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
    };
  }

  function milestonePhrase(item: UpcomingMilestone): string {
    const verb = item.kind === 'ends' ? 'Ends' : 'Starts';
    if (item.daysDiff <= 0) return `${verb} today`;
    if (item.daysDiff === 1) return `${verb} tomorrow`;
    return `${verb} in ${item.daysDiff} days`;
  }

  function statusTone(st: DisplayStatus): string {
    if (st === 'Done') return 'done';
    if (st === 'Processing') return 'processing';
    if (st === 'Waiting') return 'waiting';
    return 'cancelled';
  }
</script>

<section id="summary" class="ac-page">
  <div class="ac-page-head">
    <div>
      <h1>Summary</h1>
      <p class="ac-page-sub">
        Academic year {yearFilter === 'all' ? '2026' : yearFilter} &middot; Last Updated {lastUpdatedText}
        {#if dash?.meta?.source === 'google'}
          &middot; {dash.meta.sheetTitle || 'Google Sheets'}
        {/if}
      </p>
    </div>

    <div class="ac-head-controls">
      <SelectMenu
        id="summaryYearFilter"
        ariaLabel="Filter by academic year"
        leadingIcon="calendar"
        size="md"
        align="right"
        bind:value={yearFilter}
        options={YEAR_OPTIONS}
      />

      {#if isAdmin && dash?.meta?.source === 'mock' && onOpenSheetPicker}
        <button type="button" class="ac-outline-btn" onclick={onOpenSheetPicker}>
          Connect Google Sheet
        </button>
      {/if}
    </div>
  </div>

  {#if dash?.meta?.stale}
    <div id="dataBanner" class="banner banner-row" role="status">
      <span>Google Sheets could not be reached, so the last saved copy is shown.</span>
      <button type="button" class="btn small" disabled={refreshing} onclick={onRefresh}>
        Retry sync
      </button>
    </div>
  {/if}
  {#if loadError}
    <p id="loadError" class="banner error" role="alert">{loadError} Showing the last data we have.</p>
  {/if}

  <!-- KPI Row -->
  <div class="ac-kpi-grid" id="metrics">
    <article class="ac-card ac-kpi-card" id="mMembers">
      <div class="ac-kpi-top">
        <span class="ac-kpi-label">Total Club Members</span>
        <span class="ac-kpi-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="3.5" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a3.5 3.5 0 0 1 0 6.74" />
          </svg>
        </span>
      </div>
      <div class="ac-kpi-value">{dash ? dash.metrics.members : '–'}</div>
      <p class="ac-kpi-foot">
        {dash ? `Across ${deptCount} engineering departments` : 'Loading...'}
      </p>
    </article>

    <article class="ac-card ac-kpi-card" id="mEvents">
      <div class="ac-kpi-top">
        <span class="ac-kpi-label">Activities</span>
        <span class="ac-kpi-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M5 21V4" stroke-linecap="round" />
            <path d="M5 4h11l-1.5 4L16 12H5" stroke-linejoin="round" />
          </svg>
        </span>
      </div>
      <div class="ac-kpi-value">{dash ? scopedEvents.length : '–'}</div>
      <div class="ac-kpi-statuses">
        <span class="ac-st-inline done">{statusCounts.done} Done</span>
        <span class="ac-st-inline processing">{statusCounts.processing} Processing</span>
        <span class="ac-st-inline waiting">{statusCounts.waiting} Waiting</span>
      </div>
    </article>

    <article class="ac-card ac-kpi-card" id="mBudget">
      <div class="ac-kpi-top">
        <span class="ac-kpi-label">Budget (planned)</span>
        <span class="ac-kpi-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <rect x="3" y="6" width="18" height="13" rx="2" />
            <path d="M3 10h18" />
            <path d="M16 14h2" stroke-linecap="round" />
          </svg>
        </span>
      </div>
      <div class="ac-kpi-value">{dash ? baht(budgetStats.planned) : '–'}</div>
      <div class="ac-kpi-bar" aria-hidden="true">
        <span style={`width:${Math.min(100, budgetStats.pctNum)}%`}></span>
      </div>
      <div class="ac-kpi-split-foot">
        <span>{dash ? `${baht(budgetStats.actual)} spent (${budgetStats.pctNum}%)` : 'Loading...'}</span>
        <span>{dash ? `${baht(budgetStats.remaining)} remaining` : ''}</span>
      </div>
    </article>
  </div>

  <!-- Middle Analytics Row -->
  <div class="ac-mid-grid">
    <article class="ac-card ac-chart-card">
      <div class="ac-card-head">
        <div>
          <h2>Budget: planned vs actual</h2>
          <p class="ac-card-sub">
            Done projects: {budgetChartEvents[0]?.event_id ?? 'AC-001'} to {budgetChartEvents.at(-1)?.event_id ?? 'AC-010'} (THB)
          </p>
        </div>
        <div class="ac-legend">
          <span><i class="ac-dot planned"></i>Planned</span>
          <span><i class="ac-dot actual"></i>Actual</span>
        </div>
      </div>

      <div class="ac-vchart-wrap">
        <div class="ac-vchart-y" aria-hidden="true">
          {#each budgetTicks as tk}
            <span>{formatK(tk)}</span>
          {/each}
        </div>
        <div class="ac-vchart-plot">
          <div class="ac-vchart-canvas">
            <div class="ac-vchart-gridlines" aria-hidden="true">
              {#each budgetTicks as _}
                <span></span>
              {/each}
            </div>
            <div class="ac-vchart-bars">
              {#each budgetChartEvents as ev, i (ev.event_id)}
                {@const hp = Math.min(100, Math.round((ev.budget_planned / budgetChartMax) * 100))}
                {@const ha = Math.min(100, Math.round((ev.actual / budgetChartMax) * 100))}
                <button
                  type="button"
                  class="ac-bar-group"
                  class:edge-left={i <= 1}
                  class:edge-right={i >= budgetChartEvents.length - 2}
                  aria-label={`${ev.event_id} ${ev.title}: Planned ${baht(ev.budget_planned)}, Actual ${baht(ev.actual)}`}
                  onmouseenter={() => (hoveredBudgetIdx = i)}
                  onmouseleave={() => (hoveredBudgetIdx = null)}
                  onfocus={() => (hoveredBudgetIdx = i)}
                  onblur={() => (hoveredBudgetIdx = null)}
                  onclick={() => onOpenProject(ev.event_id)}
                >
                  <div class="ac-bar-pair">
                    <span class="ac-bar planned" style={`height:${Math.max(2, hp)}%`}></span>
                    <span class="ac-bar actual" style={`height:${Math.max(2, ha)}%`}></span>
                  </div>
                  <small>{ev.event_id}</small>

                  {#if hoveredBudgetIdx === i}
                    <div class="ac-bar-tooltip">
                      <strong>{ev.event_id} &middot; {ev.title}</strong>
                      <span>Planned: {baht(ev.budget_planned)}</span>
                      <span>Actual: {baht(ev.actual)}</span>
                    </div>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </article>

    <article class="ac-card ac-chart-card">
      <div class="ac-card-head">
        <div>
          <h2>Participants per activity</h2>
          <p class="ac-card-sub">
            Top {topParticipantEvents.length} of {scopedEvents.length} activities
          </p>
        </div>
      </div>

      <div class="ac-hbar-list">
        {#each topParticipantEvents as ev (ev.event_id)}
          {@const count = participantCount(ev)}
          {@const widthPct = Math.max(4, Math.round((count / topParticipantMax) * 100))}
          <button
            type="button"
            class="ac-hbar-row"
            title={`${ev.event_id} ${ev.title}: ${count} participants`}
            onclick={() => onOpenProject(ev.event_id)}
          >
            <span class="ac-hbar-label">{shortBarName(ev.title)}</span>
            <span class="ac-hbar-track">
              <span class="ac-hbar-fill" style={`width:${widthPct}%`}></span>
              <span class="ac-hbar-num">{count}</span>
            </span>
          </button>
        {/each}
      </div>
    </article>
  </div>

  <!-- Bottom Schedule Row -->
  <div class="ac-bot-grid">
    <article class="ac-card ac-cal-card">
      <div class="ac-card-head ac-cal-card-head">
        <div class="ac-cal-title-nav">
          <h2>Events calendar</h2>
          <div class="ac-month-stepper">
            <button
              type="button"
              aria-label="Previous month"
              onclick={() => (calMonth = shiftMonthStr(calMonth, -1))}
            >
              &#8249;
            </button>
            <span>{getMonthTitle(calMonth)}</span>
            <button
              type="button"
              aria-label="Next month"
              onclick={() => (calMonth = shiftMonthStr(calMonth, 1))}
            >
              &#8250;
            </button>
          </div>
          <button
            type="button"
            class="ac-cal-today-btn"
            onclick={() => (calMonth = today.slice(0, 7))}
          >
            Today
          </button>
        </div>

        {#if onSelectPage}
          <button
            type="button"
            class="ac-notify-link"
            onclick={() => onSelectPage('calendar')}
          >
            Full calendar &rarr;
          </button>
        {/if}
      </div>

      <div class="svar-cal-wrapper is-compact">
        {#if browser}
          {#if theme === 'dark'}
            <WillowDark fonts={false}>
              <SvarCalendar
                events={svarEvents}
                view="month"
                views={SVAR_MONTH_VIEWS}
                date={svarDate}
                toolbar={null}
                readonly={true}
                cellCss={computeCellCss}
                tooltip={CalendarTooltip}
                init={initSvarApi}
              />
            </WillowDark>
          {:else}
            <Willow fonts={false}>
              <SvarCalendar
                events={svarEvents}
                view="month"
                views={SVAR_MONTH_VIEWS}
                date={svarDate}
                toolbar={null}
                readonly={true}
                cellCss={computeCellCss}
                tooltip={CalendarTooltip}
                init={initSvarApi}
              />
            </Willow>
          {/if}
        {:else}
          <div class="cal-ssr-placeholder">
            <p class="muted">Loading calendar for {getMonthTitle(calMonth)}...</p>
          </div>
        {/if}
      </div>
    </article>

    <article class="ac-card ac-upcoming-card">
      <div class="ac-card-head">
        <div>
          <h2>Upcoming events</h2>
          <p class="ac-card-sub">next 30 days</p>
        </div>
      </div>

      <div class="ac-upcoming-list">
        {#if !upcomingList.length}
          <p class="muted" style="padding:18px 0">No upcoming activities in the next 30 days.</p>
        {:else}
          {#each upcomingList as item (item.event.event_id + item.kind)}
            {@const tile = dateTile(item.targetDate)}
            <button
              type="button"
              class="ac-upcoming-row"
              onclick={() => onOpenProject(item.event.event_id)}
            >
              <div class="ac-up-tile">
                <small>{tile.month}</small>
                <b>{tile.day}</b>
              </div>
              <div class="ac-up-info">
                <strong>{item.event.event_id} {item.event.title}</strong>
                <span>
                  {milestonePhrase(item)}
                  <em class={`ac-up-st ${statusTone(item.status)}`}>{item.status}</em>
                </span>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </article>
  </div>
</section>
