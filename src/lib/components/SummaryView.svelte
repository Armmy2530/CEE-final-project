<script lang="ts">
  import BarChart, { type ChartSeries } from './BarChart.svelte';
  import Calendar from './Calendar.svelte';
  import { baht, pct } from '$lib/format';
  import type { DashboardPayload, ProjectSummary } from '$lib/types';

  let {
    dash,
    loadError,
    refreshing,
    onRefresh,
    onOpenProject
  }: {
    dash: DashboardPayload | null;
    loadError: string;
    refreshing: boolean;
    onRefresh: () => void;
    onOpenProject?: (eventId: string) => void;
  } = $props();

  let statusFilter = $state<'all' | 'Completed' | 'Scheduled' | 'Cancelled'>('all');
  let hidePlanned = $state(false);
  let hideActual = $state(false);

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

  <Calendar events={dash?.events ?? []} today={dash?.today ?? ''} {onOpenProject} />
</section>
