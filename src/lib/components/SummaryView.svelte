<script lang="ts">
  import BarChart, { type ChartSeries } from './BarChart.svelte';
  import { baht, fmtDate, pad2, pct, projectDaysOf } from '$lib/format';
  import type { DashboardPayload, ProjectSummary } from '$lib/types';

  let {
    dash,
    loadError,
    refreshing,
    onRefresh
  }: {
    dash: DashboardPayload | null;
    loadError: string;
    refreshing: boolean;
    onRefresh: () => void;
  } = $props();

  let statusFilter = $state<'all' | 'Completed' | 'Scheduled' | 'Cancelled'>('all');
  let hidePlanned = $state(false);
  let hideActual = $state(false);
  let calMonth = $state('');
  let calSelected = $state<string | null>(null);

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  $effect(() => {
    if (dash && !calMonth) {
      calMonth = dash.today.slice(0, 7);
    }
  });

  const updatedText = $derived.by(() => {
    if (!dash) return loadError ? 'Data unavailable' : 'Loading...';
    const when = new Date(dash.meta?.fetchedAt || Date.now());
    return (
      `Academic year ${dash.today.slice(0, 4)} - Last updated ` +
      when.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    );
  });

  const bannerMsg = $derived.by(() => {
    if (!dash?.meta) return '';
    const msgs: string[] = [];
    if (dash.meta.source === 'mock') {
      msgs.push('Showing normalized Mock-Data CSVs. Set GOOGLE_API_KEY and GOOGLE_SHEET_ID to connect Google Sheets.');
    }
    if (dash.meta.stale) {
      msgs.push('Google Sheets could not be reached, so the last saved copy is shown.');
    }
    return msgs.join(' ');
  });

  const filteredEvents = $derived.by(() => {
    if (!dash) return [] as ProjectSummary[];
    const evs = dash.events.slice().sort((a, b) => a.date.localeCompare(b.date));
    return statusFilter === 'all' ? evs : evs.filter((e) => e.status === statusFilter);
  });

  const attEvents = $derived(filteredEvents.filter((e) => e.records > 0));

  const budgetSeries = $derived.by(() => {
    const out: ChartSeries[] = [];
    if (!hidePlanned) {
      out.push({
        key: 'planned',
        name: 'Planned',
        cls: 'planned',
        values: filteredEvents.map((e) => e.budget_planned)
      });
    }
    if (!hideActual) {
      out.push({
        key: 'actual',
        name: 'Actual',
        cls: 'actual',
        values: filteredEvents.map((e) => e.actual)
      });
    }
    return out;
  });

  function toggleSeries(which: 'planned' | 'actual') {
    if (which === 'planned') {
      if (!hidePlanned && hideActual) return;
      hidePlanned = !hidePlanned;
    } else {
      if (!hideActual && hidePlanned) return;
      hideActual = !hideActual;
    }
  }

  // Calendar grid computation
  type CalDayEvent = ProjectSummary & { dayNo: number; dayCount: number };

  const byDate = $derived.by(() => {
    const map: Record<string, CalDayEvent[]> = {};
    if (!dash) return map;
    for (const e of dash.events) {
      const days = projectDaysOf(e);
      days.forEach((day, i) => {
        if (!map[day]) map[day] = [];
        map[day].push({ ...e, dayNo: i + 1, dayCount: days.length });
      });
    }
    return map;
  });

  const calTitle = $derived.by(() => {
    if (!calMonth) return '';
    const [y, mo] = calMonth.split('-').map(Number);
    return `${MONTHS[mo - 1]} ${y}`;
  });

  const calCells = $derived.by(() => {
    if (!calMonth || !dash) return [];
    const [y, moNum] = calMonth.split('-').map(Number);
    const mo = moNum - 1;
    const first = new Date(Date.UTC(y, mo, 1));
    const start = new Date(first.getTime() - first.getUTCDay() * 86400000);
    const cells: Array<{
      key: string;
      dayNum: number;
      other: boolean;
      today: boolean;
      selected: boolean;
      evs: CalDayEvent[];
    }> = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start.getTime() + i * 86400000);
      if (i >= 35 && dt.getUTCMonth() !== mo) break;
      const key = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
      cells.push({
        key,
        dayNum: dt.getUTCDate(),
        other: dt.getUTCMonth() !== mo,
        today: key === dash.today,
        selected: key === calSelected,
        evs: byDate[key] || []
      });
    }
    return cells;
  });

  function shiftMonth(delta: number) {
    if (!calMonth) return;
    const [y, mo] = calMonth.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1 + delta, 1));
    calMonth = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
  }

  function jumpToday() {
    if (!dash) return;
    calMonth = dash.today.slice(0, 7);
    calSelected = dash.today;
  }
</script>

<section id="summary" class="page-content">
  <div class="page-heading heading-row">
    <div>
      <h1>Summary</h1>
      <p id="updatedText">{updatedText}</p>
    </div>
    <div class="heading-actions">
      <label class="select-label" for="statusFilter">Show events</label>
      <select id="statusFilter" bind:value={statusFilter}>
        <option value="all">All</option>
        <option value="Completed">Completed</option>
        <option value="Scheduled">Scheduled</option>
        <option value="Cancelled">Cancelled</option>
      </select>
      <button id="refreshBtn" class="btn" type="button" disabled={refreshing} onclick={onRefresh}>
        Refresh
      </button>
    </div>
  </div>

  {#if bannerMsg}
    <p id="dataBanner" class="banner" role="status">{bannerMsg}</p>
  {/if}
  {#if loadError}
    <p id="loadError" class="banner error" role="alert">{loadError} Showing the last data we have.</p>
  {/if}

  <div class="metrics" id="metrics">
    <article class="card metric" id="mMembers">
      <h2>Total members</h2>
      <p class="metric-value">{dash ? dash.metrics.members.toLocaleString('en-US') : '-'}</p>
      <p class="metric-sub">
        {dash ? `in ${Object.keys(dash.membersByDepartment).length} departments` : '\u00a0'}
      </p>
    </article>

    <article class="card metric" id="mEvents">
      <h2>Total events</h2>
      <p class="metric-value">{dash ? dash.metrics.events.toLocaleString('en-US') : '-'}</p>
      <p class="metric-sub">
        {#if dash}
          {dash.metrics.eventsByStatus.Completed || 0} completed &middot;
          {dash.metrics.eventsByStatus.Scheduled || 0} scheduled &middot;
          {dash.metrics.eventsByStatus.Cancelled || 0} cancelled
        {:else}
          &nbsp;
        {/if}
      </p>
    </article>

    <article class="card metric" id="mBudget">
      <h2>Actual budget spent</h2>
      <p class="metric-value">{dash ? baht(dash.metrics.budgetActual) : '-'}</p>
      <p class="metric-sub">
        {dash ? `${pct(dash.metrics.budgetPct)} of ${baht(dash.metrics.budgetPlanned)} planned` : '\u00a0'}
      </p>
      <div class="meter" aria-hidden="true">
        <span style={`width:${dash ? Math.min(100, Math.round((dash.metrics.budgetPct || 0) * 100)) : 0}%`}></span>
      </div>
    </article>
  </div>

  <div class="charts">
    <article class="card chart-card">
      <div class="card-head">
        <h2>Attendance per event</h2>
      </div>
      <BarChart
        categories={attEvents.map((e) => ({ label: e.title, note: `${e.records} check-ins recorded` }))}
        series={[{ key: 'att', name: 'Attendees', cls: 'att', values: attEvents.map((e) => e.attendees) }]}
        format={(v) => `${v} people`}
        ariaLabel="Bar chart of attendees for each event"
        emptyText="No attendance records for this filter."
      />
      <details class="table-view">
        <summary>View as table</summary>
        <div id="attTable">
          <table class="data-table">
            <thead>
              <tr><th>Event</th><th>Attendees</th></tr>
            </thead>
            <tbody>
              {#each attEvents as e (e.event_id)}
                <tr><td>{e.title}</td><td class="num">{e.attendees}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </article>

    <article class="card chart-card">
      <div class="card-head">
        <h2>Budget: planned vs actual</h2>
        <div class="legend" id="budgetLegend">
          <button type="button" aria-pressed={!hidePlanned} onclick={() => toggleSeries('planned')}>
            <span class="sw planned"></span>Planned
          </button>
          <button type="button" aria-pressed={!hideActual} onclick={() => toggleSeries('actual')}>
            <span class="sw actual"></span>Actual
          </button>
          <span class="flag" title="Actual spending is at least 80% of plan">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M6 1L11 11H1Z" style="fill:var(--crit)"></path>
            </svg>
            &ge; 80% of plan
          </span>
        </div>
      </div>
      <BarChart
        categories={filteredEvents.map((e) => {
          const flag = e.status !== 'Cancelled' && e.pct != null && e.pct >= 0.8;
          return {
            label: e.title,
            flag,
            note: flag
              ? `${(e.pct ?? 0) >= 1 ? 'Over budget: ' : 'At '}${pct(e.pct)} of plan`
              : e.status === 'Cancelled'
                ? 'Cancelled'
                : ''
          };
        })}
        series={budgetSeries}
        format={baht}
        ariaLabel="Grouped bar chart comparing planned and actual budget for each event"
        emptyText="No events for this filter."
      />
      <details class="table-view">
        <summary>View as table</summary>
        <div id="budgetTable">
          <table class="data-table">
            <thead>
              <tr><th>Event</th><th>Planned</th><th>Actual</th><th>% used</th></tr>
            </thead>
            <tbody>
              {#each filteredEvents as e (e.event_id)}
                <tr>
                  <td>{e.title}</td>
                  <td class="num">{baht(e.budget_planned)}</td>
                  <td class="num">{baht(e.actual)}</td>
                  <td class="num">{pct(e.pct)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  </div>

  <article class="card calendar-card">
    <div class="card-head">
      <h2>Events calendar</h2>
      <div class="cal-nav">
        <button class="btn small" id="calPrev" type="button" aria-label="Previous month" onclick={() => shiftMonth(-1)}>
          &lsaquo;
        </button>
        <strong id="calTitle" aria-live="polite">{calTitle}</strong>
        <button class="btn small" id="calNext" type="button" aria-label="Next month" onclick={() => shiftMonth(1)}>
          &rsaquo;
        </button>
        <button class="btn small" id="calToday" type="button" onclick={jumpToday}>Today</button>
      </div>
    </div>

    <div class="cal-grid cal-dow" id="calDow">
      {#each DOW as d}
        <div>{d}</div>
      {/each}
    </div>

    <div class="cal-grid" id="calGrid">
      {#each calCells as cell (cell.key)}
        <button
          type="button"
          class="cal-cell"
          class:other={cell.other}
          class:today={cell.today}
          class:selected={cell.selected}
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
        >
          <span class="cal-num">{cell.dayNum}</span>
          {#each cell.evs.slice(0, 2) as e (e.event_id)}
            <span class={`chip ${e.status}`}>
              {e.status === 'Completed' ? '✓ ' : ''}{e.title}{e.dayCount > 1 ? ` (${e.dayNo}/${e.dayCount})` : ''}
            </span>
          {/each}
          {#if cell.evs.length > 2}
            <span class="cal-more">+{cell.evs.length - 2} more</span>
          {/if}
          {#if cell.evs.length}
            <span class="cal-dots">
              {#each cell.evs as _}
                <i></i>
              {/each}
            </span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="cal-detail" id="calDetail" aria-live="polite">
      {#if calSelected}
        {@const list = byDate[calSelected] || []}
        <strong>{fmtDate(calSelected)}</strong>
        {#if !list.length}
          <p class="muted">No events on this day.</p>
        {:else}
          <ul>
            {#each list as e (e.event_id)}
              <li>
                <span><strong>{e.title}</strong> &middot; {e.location}</span>
                <span class="muted">{e.status} &middot; {baht(e.budget_planned)} planned</span>
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
