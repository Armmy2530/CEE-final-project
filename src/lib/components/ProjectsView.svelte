<script lang="ts">
  import BarChart from './BarChart.svelte';
  import { baht, fmtDate, fmtRange, pct, projectDaysOf } from '$lib/format';
  import { rank } from '$lib/search';
  import type { DashboardPayload, ProjectCategory, ProjectSummary } from '$lib/types';
  import type { PageId } from './Topbar.svelte';

  let {
    dash,
    selectedProjectId = $bindable<string | null>(null),
    refreshing = false,
    onRefresh,
    onSelectPage
  }: {
    dash: DashboardPayload | null;
    selectedProjectId?: string | null;
    refreshing?: boolean;
    onRefresh?: () => void;
    onSelectPage?: (page: PageId) => void;
  } = $props();

  let query = $state('');
  let statusFilter = $state<'all' | ProjectSummary['status']>('all');
  let categoryFilter = $state<'all' | ProjectCategory>('all');
  let sortBy = $state<'relevance' | 'newest' | 'oldest' | 'name'>('relevance');
  let groupBy = $state<'gender' | 'year' | 'major'>('gender');
  let imgFailed = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);
  let backBtn = $state<HTMLButtonElement | null>(null);

  const STATUS_TH: Record<ProjectSummary['status'], string> = {
    Scheduled: 'ดำเนินการ',
    Completed: 'ปิดโครงการ',
    Cancelled: 'ยกเลิก'
  };

  const STATUS_EN: Record<ProjectSummary['status'], string> = {
    Scheduled: 'In progress',
    Completed: 'Completed',
    Cancelled: 'Cancelled'
  };

  const CATEGORY_ICON: Record<ProjectCategory, string> = {
    Academic: '✳',
    Social: '♡',
    Community: '⌁',
    Operations: '◧'
  };

  const selectedProject = $derived.by(() => {
    if (!selectedProjectId || !dash) return null;
    return dash.events.find((e) => e.event_id === selectedProjectId) ?? null;
  });

  $effect(() => {
    if (selectedProjectId && dash && !dash.events.some((e) => e.event_id === selectedProjectId)) {
      selectedProjectId = null;
    }
  });

  $effect(() => {
    if (selectedProjectId) {
      imgFailed = false;
    }
  });

  const filteredList = $derived.by(() => {
    if (!dash) return [] as ProjectSummary[];
    let pool = dash.events.slice();
    if (statusFilter !== 'all') {
      pool = pool.filter((e) => e.status === statusFilter);
    }
    if (categoryFilter !== 'all') {
      pool = pool.filter((e) => e.category === categoryFilter);
    }
    const byDateDesc = (a: ProjectSummary, b: ProjectSummary) => b.date.localeCompare(a.date);
    if (sortBy === 'relevance') {
      return query.trim()
        ? rank(pool, query, (e) => `${e.title} ${e.event_id} ${e.lead.name} ${e.category}`, (e) => e.date)
        : pool.sort(byDateDesc);
    }
    const items = query.trim()
      ? rank(pool, query, (e) => `${e.title} ${e.event_id} ${e.lead.name} ${e.category}`).slice()
      : pool;
    if (sortBy === 'newest') items.sort(byDateDesc);
    else if (sortBy === 'oldest') items.sort((a, b) => a.date.localeCompare(b.date));
    else items.sort((a, b) => a.title.localeCompare(b.title, 'th'));
    return items;
  });

  const countText = $derived.by(() => {
    const total = dash?.events.length ?? 0;
    const q = query.trim();
    if (q || statusFilter !== 'all' || categoryFilter !== 'all') {
      return `${filteredList.length} of ${total} projects shown`;
    }
    return `${total} projects`;
  });

  const inProgressCount = $derived(dash?.events.filter((e) => e.status === 'Scheduled').length ?? 0);
  const completedCount = $derived(dash?.events.filter((e) => e.status === 'Completed').length ?? 0);
  const budgetAlertCount = $derived(
    dash?.alerts.filter((a) => a.type === 'budget').length ?? 0
  );

  function openProject(id: string) {
    selectedProjectId = id;
    imgFailed = false;
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
    queueMicrotask(() => backBtn?.focus());
  }

  function closeProject() {
    selectedProjectId = null;
    queueMicrotask(() => searchInput?.focus());
  }

  function statusPillClass(status: ProjectSummary['status']): string {
    if (status === 'Scheduled') return 'progress';
    if (status === 'Completed') return 'completed';
    return 'cancelled';
  }

  function progressValue(ev: ProjectSummary): number {
    if (ev.stats.attendanceRate != null) {
      return Math.min(100, Math.round(ev.stats.attendanceRate * 100));
    }
    if (ev.status === 'Completed') return 100;
    if (ev.pct != null) return Math.min(100, Math.round(ev.pct * 100));
    return 0;
  }

  const breakdownKeys = $derived.by(() => {
    if (!selectedProject) return [] as string[];
    const g = selectedProject.breakdown[groupBy] || {};
    const keys = Object.keys(g);
    if (groupBy === 'year') return keys.sort();
    return keys.sort((a, b) => g[b] - g[a] || a.localeCompare(b));
  });
</script>

<section id="projects" class="page-content">
  {#if !selectedProject}
    <div id="projectList">
      <div class="page-heading projects-heading">
        <div>
          <p class="eyebrow">WORKSPACE <span class="heading-dot">&middot;</span> PROJECTS</p>
          <h1>Project data</h1>
          <p class="subheading">All your club projects, organized in one place.</p>
        </div>
        {#if onRefresh}
          <button
            type="button"
            class="button button-primary"
            disabled={refreshing}
            onclick={onRefresh}
          >
            <span aria-hidden="true">&#8635;</span> {refreshing ? 'Syncing...' : 'Sync data'}
          </button>
        {/if}
      </div>

      <div class="main-tabs" role="tablist" aria-label="Dashboard sections">
        <button
          type="button"
          class="main-tab"
          role="tab"
          aria-selected="false"
          onclick={() => onSelectPage?.('summary')}
        >
          Summary
        </button>
        <button
          type="button"
          class="main-tab selected"
          role="tab"
          aria-selected="true"
          onclick={() => onSelectPage?.('projects')}
        >
          Project data <span class="tab-badge">{dash?.events.length ?? 0}</span>
        </button>
      </div>

      <div class="project-overview">
        <div>
          <span class="overview-label">TOTAL PROJECTS</span>
          <b>{dash?.events.length ?? 0}</b>
        </div>
        <div>
          <span class="overview-label">IN PROGRESS</span>
          <b>{inProgressCount}</b>
        </div>
        <div>
          <span class="overview-label">COMPLETED</span>
          <b>{completedCount}</b>
        </div>
        <div>
          <span class="overview-label">TOTAL BUDGET</span>
          <b>{dash ? baht(dash.metrics.budgetPlanned) : '—'}</b>
        </div>
        <div class="overview-note">
          <span class="note-icon" class:warn={budgetAlertCount > 0} aria-hidden="true">
            {budgetAlertCount > 0 ? '!' : '↗'}
          </span>
          <span>
            <b>
              {budgetAlertCount > 0
                ? `${budgetAlertCount} budget ${budgetAlertCount === 1 ? 'alert' : 'alerts'} active`
                : "You're on track"}
            </b>
            <small>
              {inProgressCount} scheduled &middot; {completedCount} completed this academic cycle
            </small>
          </span>
        </div>
      </div>

      <div class="project-toolbar">
        <div class="search-box">
          <span aria-hidden="true">&#8981;</span>
          <label class="sr-only" for="projectSearch">Search projects</label>
          <input
            id="projectSearch"
            type="search"
            placeholder="Search projects..."
            autocomplete="off"
            bind:this={searchInput}
            bind:value={query}
          />
        </div>

        <div class="filter-actions">
          <select id="status-filter" aria-label="Filter by status" bind:value={statusFilter}>
            <option value="all">All status</option>
            <option value="Scheduled">Scheduled ({inProgressCount})</option>
            <option value="Completed">Completed ({completedCount})</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <select id="category-filter" aria-label="Filter by category" bind:value={categoryFilter}>
            <option value="all">All categories</option>
            <option value="Academic">Academic</option>
            <option value="Social">Social</option>
            <option value="Community">Community</option>
            <option value="Operations">Operations</option>
          </select>

          <select id="projectSort" aria-label="Sort projects" bind:value={sortBy}>
            <option value="relevance">Best match</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      <p id="projectCount" class="hint" aria-live="polite">{countText}</p>

      <div class="table-wrap">
        {#if !filteredList.length}
          <div class="empty-state">
            <p>No projects match your current filters.</p>
            <button
              class="btn small"
              type="button"
              onclick={() => {
                query = '';
                statusFilter = 'all';
                categoryFilter = 'all';
                searchInput?.focus();
              }}
            >
              Reset filters
            </button>
          </div>
        {:else}
          <div class="table-scroll">
            <table class="project-table">
              <thead>
                <tr>
                  <th>PROJECT</th>
                  <th>LEAD</th>
                  <th>STATUS</th>
                  <th>ATTENDANCE / PROGRESS</th>
                  <th>BUDGET (ACTUAL / PLAN)</th>
                  <th>DATE</th>
                  <th class="right">ACTION</th>
                </tr>
              </thead>
              <tbody id="project-rows">
                {#each filteredList as ev (ev.event_id)}
                  {@const prog = progressValue(ev)}
                  <tr class="clickable-row" onclick={() => openProject(ev.event_id)}>
                    <td>
                      <div class="project-title-cell">
                        <span class={`table-project-icon ${ev.category.toLowerCase()}`}>
                          {CATEGORY_ICON[ev.category]}
                        </span>
                        <span>
                          <span class="project-name">{ev.title}</span>
                          <span class="project-category">{ev.event_id} &middot; {ev.category}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="lead-cell">
                        <span class="lead-avatar">{ev.lead.initials}</span>
                        <span class="lead-name">{ev.lead.name}</span>
                      </div>
                    </td>
                    <td>
                      <span class={`status-pill ${statusPillClass(ev.status)}`}>
                        {STATUS_EN[ev.status]}
                      </span>
                    </td>
                    <td class="progress-cell">
                      <div class="progress-meta">
                        <span>{ev.attendees} attended</span>
                        <b>{prog}%</b>
                      </div>
                      <div class="table-progress">
                        <i style={`width:${prog}%`}></i>
                      </div>
                    </td>
                    <td class="budget-cell">
                      {baht(ev.actual)} <span class="muted">/ {baht(ev.budget_planned)}</span>
                    </td>
                    <td class="due-cell">{fmtRange(ev)}</td>
                    <td class="right">
                      <button
                        type="button"
                        class="row-more"
                        aria-label={`Open ${ev.title}`}
                        onclick={(e) => {
                          e.stopPropagation();
                          openProject(ev.event_id);
                        }}
                      >
                        Open &rarr;
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="table-footer">
            <span>Showing <b>{filteredList.length}</b> of {dash?.events.length ?? 0} projects</span>
            <span>Click any row to open full project breakdown</span>
          </div>
        {/if}
      </div>

      <div class="data-source-note">
        <span class="source-icon" aria-hidden="true">&#9636;</span>
        <span>
          <b>
            {dash?.meta?.source === 'google'
              ? 'Connected to Google Sheets'
              : 'Connected to normalized Mock-Data CSVs'}
          </b>
          <small>
            Last synced{' '}
            {dash?.meta?.fetchedAt
              ? new Date(dash.meta.fetchedAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : 'just now'}
          </small>
        </span>
        {#if onRefresh}
          <button type="button" id="sync-btn" disabled={refreshing} onclick={onRefresh}>
            &#8635; {refreshing ? 'Syncing...' : 'Sync now'}
          </button>
        {/if}
      </div>
    </div>
  {:else if dash}
    {@const ev = selectedProject}
    {@const days = projectDaysOf(ev)}
    {@const gMap = ev.breakdown[groupBy] || {}}
    <div id="projectDetail">
      <div class="detail-top">
        <button class="btn" type="button" bind:this={backBtn} onclick={closeProject}>
          &larr; All projects
        </button>
        <span class="muted">{ev.event_id} &middot; {ev.category}</span>
      </div>

      <!-- 1) Name / picture / detail / location / status / date / planned budget -->
      <article class="card pd-head">
        <div class="pd-title">
          <span class="pd-avatar" aria-hidden="true">
            {#if ev.image_url && !imgFailed}
              <img
                src={ev.image_url}
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                onerror={() => (imgFailed = true)}
              />
            {:else}
              {ev.title.trim().slice(0, 1).toUpperCase()}
            {/if}
          </span>
          <div>
            <h1>{ev.title}</h1>
            <div class="pd-badges">
              <span class={`badge st-${ev.status}`} title={STATUS_EN[ev.status] || ev.status}>
                {STATUS_TH[ev.status] || ev.status} ({STATUS_EN[ev.status]})
              </span>
              <span class="badge">{ev.category}</span>
              <span class="badge">Lead: {ev.lead.name}</span>
            </div>
          </div>
        </div>
        <p class="pd-detail">{ev.description || 'No description yet.'}</p>
        <dl class="facts-row">
          <div class="fact"><dt>Location</dt><dd>{ev.location || '–'}</dd></div>
          <div class="fact">
            <dt>Status</dt>
            <dd>{STATUS_TH[ev.status]} ({STATUS_EN[ev.status] || ev.status})</dd>
          </div>
          <div class="fact"><dt>Date</dt><dd>{fmtRange(ev)}</dd></div>
          <div class="fact"><dt>Planned budget</dt><dd>{baht(ev.budget_planned)}</dd></div>
        </dl>
      </article>

      <!-- 2) Detail: numbers at a glance -->
      <section class="card pd-section">
        <div class="card-head">
          <h2>Detail</h2>
          <span class="hint">Numbers at a glance</span>
        </div>
        <div class="stats">
          <div class="stat">
            <span class="stat-label">Staff</span>
            <strong>{ev.stats.staff}</strong>
          </div>
          <div class="stat">
            <span class="stat-label">Participants</span>
            <strong>{ev.stats.participants}</strong>
          </div>
          <div class="stat">
            <span class="stat-label">Attended</span>
            <strong>{ev.stats.attended}</strong>
            <small>
              {ev.stats.attendanceRate == null
                ? 'no check-ins yet'
                : `${pct(ev.stats.attendanceRate)} of participants`}
            </small>
          </div>
          <div class="stat">
            <span class="stat-label">Budget used</span>
            <strong>{pct(ev.pct)}</strong>
            <small>{baht(ev.actual)} of {baht(ev.budget_planned)}</small>
          </div>
          <div class="stat">
            <span class="stat-label">Duration</span>
            <strong>{ev.days}{ev.days === 1 ? ' day' : ' days'}</strong>
          </div>
        </div>
      </section>

      <!-- 3) Project date: Day 1 ... Day n -->
      <section class="card pd-section">
        <div class="card-head">
          <h2>Project date</h2>
          <span class="hint">{days.length === 1 ? '1 day' : `Day 1 – Day ${days.length}`}</span>
        </div>
        <ol class="daygrid">
          {#each days as day, i (day)}
            {@const cls = day === dash.today ? 'today' : day < dash.today ? 'past' : 'future'}
            <li
              class={`day ${cls}`}
              aria-label={`Day ${i + 1}, ${fmtDate(day)}${day === dash.today ? ', today' : ''}`}
            >
              <b>Day {i + 1}</b>
              <span>
                {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC'
                })}
              </span>
            </li>
          {/each}
        </ol>
      </section>

      <!-- 4) Staff & participants -->
      <section class="card pd-section">
        <div class="card-head">
          <h2>Staff &amp; participants</h2>
          <span class="hint">{ev.stats.staff} staff &middot; {ev.stats.participants} participants</span>
        </div>
        <div class="two-col">
          <div>
            <h3>Staff</h3>
            {#if !ev.staff.length}
              <p class="muted">No one recorded yet.</p>
            {:else}
              <ul class="people">
                {#each ev.staff as p (p.member_id + p.role)}
                  <li>
                    <span>
                      <strong>{p.name}</strong>
                      {#if p.role || p.department}
                        <small>
                          {p.role ? ` · ${p.role}` : ''}{p.department ? ` · ${p.department}` : ''}
                        </small>
                      {/if}
                    </span>
                    <span class={`badge as-${p.status}`}>{p.status}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <div>
            <h3>Participants</h3>
            {#if !ev.participants.length}
              <p class="muted">No one recorded yet.</p>
            {:else}
              <ul class="people">
                {#each ev.participants as p (p.member_id)}
                  <li>
                    <span>
                      <strong>{p.name}</strong>
                      {#if p.department}
                        <small> &middot; {p.department}</small>
                      {/if}
                    </span>
                    <span class={`badge as-${p.status}`}>{p.status}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </section>

      <!-- 5) Attendance breakdown -->
      <section class="card pd-section">
        <div class="card-head">
          <h2>Attendance</h2>
          <label class="inline-select">
            Display by
            <select id="groupBy" aria-label="Display attendance by" bind:value={groupBy}>
              <option value="gender">Gender</option>
              <option value="year">Year</option>
              <option value="major">Major</option>
            </select>
          </label>
        </div>
        <p class="hint">
          Year {ev.breakdownYear} &middot; counts people who checked in (Present or Late)
        </p>
        <BarChart
          categories={breakdownKeys.map((k) => ({ label: k }))}
          series={[{ key: 'att', name: 'Attendees', cls: 'att', values: breakdownKeys.map((k) => gMap[k]) }]}
          format={(v) => `${v}${v === 1 ? ' person' : ' people'}`}
          maxBar={56}
          ariaLabel={`Attendees of ${ev.title} by ${groupBy}`}
          emptyText="No attendance data for this year."
        />
        {#if breakdownKeys.length}
          <details class="table-view">
            <summary>View as table</summary>
            <div id="pdAttTable">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
                    <th class="right">Attendees</th>
                  </tr>
                </thead>
                <tbody>
                  {#each breakdownKeys as k}
                    <tr><td>{k}</td><td class="num">{gMap[k]}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        {/if}
      </section>

      <!-- 6) Budget: actual vs planned -->
      <section class="card pd-section">
        <div class="card-head">
          <h2>Budget</h2>
          <div class="legend">
            <span class="flag"><span class="sw planned"></span>Planned</span>
            <span class="flag"><span class="sw actual"></span>Actual</span>
          </div>
        </div>
        <p class="hint">Actual vs planned budget (ใช้จริง, ที่ประมาณไว้)</p>
        {#if ev.status !== 'Cancelled' && ev.pct != null && ev.pct >= 0.8}
          <p class={`banner ${ev.pct >= 1 ? 'error' : ''}`}>
            {ev.pct >= 1 ? '! Over budget: ' : '! Budget alert: '}
            {pct(ev.pct)} of the planned budget has been used.
          </p>
        {/if}
        <BarChart
          categories={[{ label: ev.title }]}
          series={[
            { key: 'planned', name: 'Planned', cls: 'planned', values: [ev.budget_planned] },
            { key: 'actual', name: 'Actual', cls: 'actual', values: [ev.actual] }
          ]}
          format={baht}
          maxBar={72}
          ariaLabel={`Planned versus actual budget of ${ev.title}`}
          emptyText="No budget data."
        />
        <details class="table-view">
          <summary>View as table</summary>
          <div id="pdBudTable">
            <table class="data-table">
              <thead>
                <tr><th>Metric</th><th class="right">Amount</th></tr>
              </thead>
              <tbody>
                <tr><td>Planned</td><td class="num">{baht(ev.budget_planned)}</td></tr>
                <tr><td>Actual</td><td class="num">{baht(ev.actual)}</td></tr>
                <tr><td>% used</td><td class="num">{pct(ev.pct)}</td></tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  {/if}
</section>
