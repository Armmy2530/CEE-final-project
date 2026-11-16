<script lang="ts">
  import { baht, fmtDate, fmtRange, pct } from '$lib/format';
  import type { DashboardPayload, ProjectCategory, ProjectSummary } from '$lib/types';
  import type { PageId } from './Topbar.svelte';

  let {
    dash,
    loadError,
    refreshing,
    firstName = 'Member',
    onRefresh,
    onOpenProject,
    onSelectPage
  }: {
    dash: DashboardPayload | null;
    loadError: string;
    refreshing: boolean;
    firstName?: string;
    onRefresh: () => void;
    onOpenProject: (eventId: string) => void;
    onSelectPage: (page: PageId) => void;
  } = $props();

  let statusFilter = $state<'all' | 'Completed' | 'Scheduled' | 'Cancelled'>('all');
  let showAllAttendance = $state(false);
  let hidePlanned = $state(false);
  let hideActual = $state(false);

  const eyebrowDate = $derived.by(() => {
    if (!dash?.today) return 'SEMESTER OVERVIEW';
    const p = dash.today.split('-');
    if (p.length !== 3) return dash.today;
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d
      .toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      })
      .toUpperCase();
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

  const displayedAttEvents = $derived.by(() => {
    if (showAllAttendance) return attEvents;
    return attEvents.slice(-6);
  });

  const clubAvgAttendance = $derived.by(() => {
    if (!attEvents.length) return 0;
    const sum = attEvents.reduce((s, e) => s + e.attendees, 0);
    return Math.round(sum / attEvents.length);
  });

  const attChartMax = $derived.by(() => {
    const maxAtt = Math.max(clubAvgAttendance, ...displayedAttEvents.map((e) => e.attendees), 10);
    return Math.ceil(maxAtt / 20) * 20;
  });

  const topBudgetCategories = $derived.by(() => {
    if (!dash) return [] as Array<{ name: string; amount: number; sharePct: number; cls: string }>;
    const classes = ['', 'gold', 'lilac-fill', 'sage', ''];
    const total = Math.max(dash.metrics.budgetActual, 1);
    return Object.entries(dash.budgetByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount], idx) => ({
        name,
        amount,
        sharePct: Math.min(100, Math.round((amount / total) * 100)),
        cls: classes[idx % classes.length]
      }));
  });

  const upcomingEvents = $derived.by(() => {
    if (!dash) return [] as ProjectSummary[];
    const scheduled = dash.events
      .filter((e) => e.status === 'Scheduled')
      .sort((a, b) => a.date.localeCompare(b.date));
    const future = scheduled.filter((e) => e.end_date >= dash.today);
    return (future.length ? future : scheduled).slice(0, 4);
  });

  const activeProjects = $derived.by(() => {
    if (!dash) return [] as ProjectSummary[];
    return dash.events
      .filter((e) => e.status === 'Scheduled')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4);
  });

  const retentionPct = $derived.by(() => {
    if (!dash || !dash.metrics.members) return 0;
    return Math.round((dash.metrics.activeMembers / dash.metrics.members) * 100);
  });

  const budgetLeft = $derived.by(() => {
    if (!dash) return 0;
    return Math.max(0, dash.metrics.budgetPlanned - dash.metrics.budgetActual);
  });

  function shortTitle(title: string): string {
    const clean = title.replace(/^Peer Teaching:\s*/i, '');
    return clean.length > 14 ? `${clean.slice(0, 12)}…` : clean;
  }

  function dateTile(dateStr: string): { day: string; month: string } {
    const p = dateStr.split('-');
    if (p.length !== 3) return { day: '--', month: '' };
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return {
      day: String(d.getUTCDate()).padStart(2, '0'),
      month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
    };
  }

  const CATEGORY_ICON: Record<ProjectCategory, string> = {
    Academic: '✳',
    Social: '♡',
    Community: '⌁',
    Operations: '◧'
  };

  const CATEGORY_TONE_CLASS: Record<ProjectCategory, string> = {
    Academic: 'yellow',
    Social: 'pink',
    Community: 'blue',
    Operations: 'green'
  };

  const CATEGORY_PROG_CLASS: Record<ProjectCategory, string> = {
    Academic: '',
    Social: 'pink-progress',
    Community: 'blue-progress',
    Operations: 'green-progress'
  };

  function toggleSeries(which: 'planned' | 'actual') {
    if (which === 'planned') {
      if (!hidePlanned && hideActual) return;
      hidePlanned = !hidePlanned;
    } else {
      if (!hideActual && hidePlanned) return;
      hideActual = !hideActual;
    }
  }

  function exportReport() {
    if (!dash) return;
    const header = [
      'event_id',
      'title',
      'category',
      'lead',
      'status',
      'date',
      'end_date',
      'attendees',
      'budget_planned',
      'actual',
      'pct'
    ];
    const rows = dash.events.map((e) => [
      e.event_id,
      e.title,
      e.category,
      e.lead.name,
      e.status,
      e.date,
      e.end_date,
      e.attendees,
      e.budget_planned,
      e.actual,
      e.pct == null ? '' : `${Math.round(e.pct * 100)}%`
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((x) => `"${String(x ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clubhouse-report-${dash.today || 'export'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<section id="summary" class="page-content">
  <div class="page-heading">
    <div>
      <p class="eyebrow">
        {eyebrowDate} <span class="heading-dot">&middot;</span> SEMESTER OVERVIEW
      </p>
      <h1>Good afternoon, {firstName} <span class="wave" aria-hidden="true">&#10035;</span></h1>
      <p class="subheading">Here's what's happening across your club.</p>
    </div>

    <div class="heading-actions">
      <button
        type="button"
        class="button button-light"
        id="export-btn"
        disabled={!dash}
        onclick={exportReport}
      >
        <span aria-hidden="true">&#8615;</span> Export report
      </button>
      <button
        type="button"
        class="button button-primary"
        id="refreshBtn"
        disabled={refreshing}
        onclick={onRefresh}
      >
        <span aria-hidden="true">&#8635;</span> {refreshing ? 'Syncing...' : 'Sync sheet'}
      </button>
    </div>
  </div>

  <div class="main-tabs" role="tablist" aria-label="Dashboard sections">
    <button
      type="button"
      class="main-tab selected"
      role="tab"
      aria-selected="true"
      onclick={() => onSelectPage('summary')}
    >
      Summary
    </button>
    <button
      type="button"
      class="main-tab"
      role="tab"
      aria-selected="false"
      onclick={() => onSelectPage('projects')}
    >
      Project data <span class="tab-badge">{dash?.events.length ?? 0}</span>
    </button>
  </div>

  <div class="toolbar-row">
    <div class="section-title">
      <h2>Semester at a glance</h2>
      <span class="live-tag"><i></i> Live overview</span>
    </div>

    <select
      id="statusFilter"
      class="period-select"
      aria-label="Filter events by status"
      bind:value={statusFilter}
    >
      <option value="all">All statuses</option>
      <option value="Completed">Completed</option>
      <option value="Scheduled">Scheduled</option>
      <option value="Cancelled">Cancelled</option>
    </select>
  </div>

  {#if bannerMsg}
    <p id="dataBanner" class="banner" role="status">{bannerMsg}</p>
  {/if}
  {#if loadError}
    <p id="loadError" class="banner error" role="alert">{loadError} Showing the last data we have.</p>
  {/if}

  <div class="stat-grid" id="metrics">
    <article class="stat-card" id="mMembers">
      <div class="stat-top">
        <span class="stat-icon peach" aria-hidden="true">&#9817;</span>
        <span class="stat-change positive">
          {dash ? `${Object.keys(dash.membersByDepartment).length} depts` : '—'}
        </span>
      </div>
      <p>Active members</p>
      <div class="stat-number">
        {#if dash}
          {dash.metrics.activeMembers} <small>/ {dash.metrics.members}</small>
        {:else}
          -
        {/if}
      </div>
      <div class="mini-progress" aria-hidden="true">
        <span style={`width:${retentionPct}%`}></span>
      </div>
      <small class="stat-foot">{dash ? `${retentionPct}% active member retention` : 'Loading...'}</small>
    </article>

    <article class="stat-card" id="mEvents">
      <div class="stat-top">
        <span class="stat-icon lilac" aria-hidden="true">&#9635;</span>
        <span class="stat-change positive">
          {dash ? `${dash.metrics.eventsByStatus.Scheduled || 0} scheduled` : '—'}
        </span>
      </div>
      <p>Events held</p>
      <div class="stat-number">{dash ? dash.metrics.events.toLocaleString('en-US') : '-'}</div>
      <div class="event-dots" aria-hidden="true">
        {#each Array(Math.min(7, dash?.metrics.events ?? 0)) as _}
          <i></i>
        {/each}
        {#if (dash?.metrics.events ?? 0) > 7}
          <span>+ {(dash?.metrics.events ?? 0) - 7} more</span>
        {/if}
      </div>
      <small class="stat-foot">
        {#if dash}
          {dash.metrics.eventsByStatus.Completed || 0} completed &middot;
          {dash.metrics.eventsByStatus.Scheduled || 0} scheduled &middot;
          {dash.metrics.eventsByStatus.Cancelled || 0} cancelled
        {:else}
          Loading...
        {/if}
      </small>
    </article>

    <article class="stat-card budget-stat" id="mBudget">
      <div class="stat-top">
        <span class="stat-icon green" aria-hidden="true">&#3647;</span>
        <span class="stat-change neutral">{dash ? `${pct(dash.metrics.budgetPct)} used` : '—'}</span>
      </div>
      <p>Budget used</p>
      <div class="stat-number">{dash ? baht(dash.metrics.budgetActual) : '-'}</div>
      <div class="budget-progress" aria-hidden="true">
        <span
          style={`width:${dash ? Math.min(100, Math.round((dash.metrics.budgetPct || 0) * 100)) : 0}%`}
        ></span>
      </div>
      <small class="stat-foot">
        {#if dash}
          <span>of {baht(dash.metrics.budgetPlanned)} planned</span>
          <b>{baht(budgetLeft)} left</b>
        {:else}
          <span>Loading...</span>
        {/if}
      </small>
    </article>
  </div>

  <div class="dashboard-grid">
    <article class="panel attendance-panel">
      <div class="panel-heading">
        <div>
          <h3>Event attendance</h3>
          <p>Member participation across events (click a bar to open project)</p>
        </div>
        <button
          type="button"
          class="chart-period"
          onclick={() => (showAllAttendance = !showAllAttendance)}
        >
          {showAllAttendance ? `All ${attEvents.length} events` : 'Recent 6 events'} &#8964;
        </button>
      </div>

      <div class="chart-legend">
        <span><i class="legend-dot"></i> Attendees</span>
        <span><i class="legend-dot pale"></i> Club average ({clubAvgAttendance})</span>
      </div>

      <div class="bar-chart" aria-label="Attendance chart">
        <div class="y-labels" aria-hidden="true">
          <span>{attChartMax}</span>
          <span>{Math.round(attChartMax * 0.66)}</span>
          <span>{Math.round(attChartMax * 0.33)}</span>
          <span>0</span>
        </div>
        <div class="bars-area">
          <div class="gridline one"></div>
          <div class="gridline two"></div>
          <div class="gridline three"></div>
          {#if !displayedAttEvents.length}
            <p class="muted" style="margin:auto">No attendance records for this filter.</p>
          {:else}
            {#each displayedAttEvents as ev (ev.event_id)}
              {@const hAtt = Math.min(100, Math.round((ev.attendees / attChartMax) * 100))}
              {@const hAvg = Math.min(100, Math.round((clubAvgAttendance / attChartMax) * 100))}
              <button
                type="button"
                class="bar-pair"
                title={`${ev.title}: ${ev.attendees} attendees (Club avg: ${clubAvgAttendance})`}
                onclick={() => onOpenProject(ev.event_id)}
              >
                <i style={`height:${Math.max(4, hAtt)}%`}></i>
                <i class="average" style={`height:${Math.max(4, hAvg)}%`}></i>
                <small>{shortTitle(ev.title)}</small>
              </button>
            {/each}
          {/if}
        </div>
      </div>

      <details class="table-view">
        <summary>View as table</summary>
        <div id="attTable">
          <table class="data-table">
            <thead>
              <tr><th>Event</th><th class="right">Attendees</th></tr>
            </thead>
            <tbody>
              {#each attEvents as e (e.event_id)}
                <tr>
                  <td>{e.title}</td>
                  <td class="num">{e.attendees}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </article>

    <article class="panel budget-panel">
      <div class="panel-heading">
        <div>
          <h3>Budget overview</h3>
          <p>Spending by expense category vs. planned allocation</p>
        </div>
      </div>

      <div class="budget-total">
        <span>Spent so far</span>
        <b>
          {dash ? baht(dash.metrics.budgetActual) : '—'}
          <small>/ {dash ? baht(dash.metrics.budgetPlanned) : '—'}</small>
        </b>
      </div>

      <div class="budget-categories">
        {#each topBudgetCategories as cat (cat.name)}
          <div class="budget-row">
            <div>
              <span>{cat.name}</span>
              <b>{baht(cat.amount)} <small>({cat.sharePct}%)</small></b>
            </div>
            <div class={`h-progress ${cat.cls}`}>
              <i style={`width:${cat.sharePct}%`}></i>
            </div>
          </div>
        {/each}
      </div>

      <div class="legend" id="budgetLegend">
        <button type="button" aria-pressed={!hidePlanned} onclick={() => toggleSeries('planned')}>
          <span class="sw planned"></span>Planned
        </button>
        <button type="button" aria-pressed={!hideActual} onclick={() => toggleSeries('actual')}>
          <span class="sw actual"></span>Actual
        </button>
      </div>

      <details class="table-view">
        <summary>View project budgets table</summary>
        <div id="budgetTable">
          <table class="data-table">
            <thead>
              <tr>
                <th>Event</th>
                {#if !hidePlanned}<th class="right">Planned</th>{/if}
                {#if !hideActual}<th class="right">Actual</th>{/if}
                <th class="right">% used</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredEvents as e (e.event_id)}
                <tr>
                  <td>{e.title}</td>
                  {#if !hidePlanned}<td class="num">{baht(e.budget_planned)}</td>{/if}
                  {#if !hideActual}<td class="num">{baht(e.actual)}</td>{/if}
                  <td class="num">{pct(e.pct)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>

      <button type="button" class="text-link" onclick={() => onSelectPage('budget')}>
        View full budget <span aria-hidden="true">&rarr;</span>
      </button>
    </article>
  </div>

  <div class="bottom-grid">
    <article class="panel events-panel">
      <div class="panel-heading">
        <div>
          <h3>Upcoming events</h3>
          <p>Don't miss what's next</p>
        </div>
        <button type="button" class="text-link" onclick={() => onSelectPage('calendar')}>
          View calendar <span aria-hidden="true">&rarr;</span>
        </button>
      </div>

      <div class="event-list">
        {#if !upcomingEvents.length}
          <p class="muted" style="margin-top:16px">No upcoming scheduled events.</p>
        {:else}
          {#each upcomingEvents as ev, i (ev.event_id)}
            {@const tile = dateTile(ev.date)}
            {@const barTone = i % 3 === 1 ? 'mauve' : i % 3 === 2 ? 'sage-color' : ''}
            {@const pillTone =
              ev.category === 'Social'
                ? 'pink-type'
                : ev.category === 'Operations'
                  ? 'green-type'
                  : ev.category === 'Community'
                    ? 'blue-type'
                    : ''}
            <button type="button" class="event-item" onclick={() => onOpenProject(ev.event_id)}>
              <div class="date-tile">
                <b>{tile.day}</b>
                <small>{tile.month}</small>
              </div>
              <span class={`event-color ${barTone}`}></span>
              <div class="event-info">
                <b>{ev.title}</b>
                <small>{fmtRange(ev)} <i>&middot;</i> {ev.location || 'TBA'}</small>
              </div>
              <span class={`event-type ${pillTone}`}>{ev.category}</span>
            </button>
          {/each}
        {/if}
      </div>
    </article>

    <article class="panel projects-mini">
      <div class="panel-heading">
        <div>
          <h3>Active projects</h3>
          <p>Latest progress &amp; budget updates</p>
        </div>
        <button type="button" class="text-link" onclick={() => onSelectPage('projects')}>
          See all <span aria-hidden="true">&rarr;</span>
        </button>
      </div>

      {#if !activeProjects.length}
        <p class="muted" style="margin-top:16px">No active projects right now.</p>
      {:else}
        {#each activeProjects as proj (proj.event_id)}
          {@const usedPct = proj.pct == null ? 0 : Math.min(100, Math.round(proj.pct * 100))}
          <button type="button" class="project-mini-item" onclick={() => onOpenProject(proj.event_id)}>
            <div class="project-mini-row">
              <span class={`project-emoji ${CATEGORY_TONE_CLASS[proj.category]}`}>
                {CATEGORY_ICON[proj.category]}
              </span>
              <div class="project-mini-info">
                <b>{proj.title}</b>
                <small>{proj.category} &middot; {fmtDate(proj.date)}</small>
              </div>
              <span class="project-percent">{usedPct}%</span>
            </div>
            <div class={`project-mini-progress ${CATEGORY_PROG_CLASS[proj.category]}`}>
              <i style={`width:${usedPct}%`}></i>
            </div>
          </button>
        {/each}
      {/if}
    </article>
  </div>

  <footer class="page-footer">
    <span><span class="footer-logo">&#9672;</span> Clubhouse <i>&middot;</i> Making club life simpler</span>
    <span>
      Data synced from {dash?.meta?.source === 'google' ? 'Google Sheets' : 'Mock-Data CSVs'}
    </span>
  </footer>
</section>
