<script lang="ts">
  import BarChart from './BarChart.svelte';
  import { baht, fmtDate, fmtRange, pct, projectDaysOf } from '$lib/format';
  import { rank } from '$lib/search';
  import type { DashboardPayload, ProjectSummary } from '$lib/types';

  let { dash }: { dash: DashboardPayload | null } = $props();

  let query = $state('');
  let sortBy = $state<'relevance' | 'newest' | 'oldest' | 'name'>('relevance');
  let projectId = $state<string | null>(null);
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
    Completed: 'Closed',
    Cancelled: 'Cancelled'
  };

  const selectedProject = $derived.by(() => {
    if (!projectId || !dash) return null;
    return dash.events.find((e) => e.event_id === projectId) ?? null;
  });

  $effect(() => {
    if (projectId && dash && !dash.events.some((e) => e.event_id === projectId)) {
      projectId = null;
    }
  });

  const filteredList = $derived.by(() => {
    if (!dash) return [] as ProjectSummary[];
    const all = dash.events.slice();
    const byDateDesc = (a: ProjectSummary, b: ProjectSummary) => b.date.localeCompare(a.date);
    if (sortBy === 'relevance') {
      return query.trim()
        ? rank(all, query, (e) => e.title, (e) => e.date)
        : all.sort(byDateDesc);
    }
    const items = query.trim() ? rank(all, query, (e) => e.title).slice() : all;
    if (sortBy === 'newest') items.sort(byDateDesc);
    else if (sortBy === 'oldest') items.sort((a, b) => a.date.localeCompare(b.date));
    else items.sort((a, b) => a.title.localeCompare(b.title, 'th'));
    return items;
  });

  const countText = $derived.by(() => {
    const total = dash?.events.length ?? 0;
    const q = query.trim();
    return q ? `${filteredList.length} of ${total} projects match "${q}"` : `${total} projects`;
  });

  function openProject(id: string) {
    projectId = id;
    imgFailed = false;
    window.scrollTo(0, 0);
    queueMicrotask(() => backBtn?.focus());
  }

  function closeProject() {
    projectId = null;
    queueMicrotask(() => searchInput?.focus());
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
      <div class="page-heading">
        <h1>Project data</h1>
        <p>Search for a project, then open it to see its details</p>
      </div>

      <div class="project-toolbar">
        <div class="search-box">
          <label class="sr-only" for="projectSearch">Search projects by name</label>
          <svg class="search-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="2" />
            <path d="M14 14l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <input
            id="projectSearch"
            type="search"
            placeholder="Search box - type a project name"
            autocomplete="off"
            bind:this={searchInput}
            bind:value={query}
          />
        </div>
        <div class="sort-box">
          <label for="projectSort">Sort</label>
          <select id="projectSort" bind:value={sortBy}>
            <option value="relevance">Best match</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A-Z</option>
          </select>
        </div>
      </div>

      <p id="projectCount" class="hint" aria-live="polite">{countText}</p>

      <div id="projectCards" class="project-cards">
        {#if !filteredList.length}
          <div class="empty-card">
            <p>No project matches "{query.trim()}".</p>
            <button
              class="btn small"
              type="button"
              onclick={() => {
                query = '';
                searchInput?.focus();
              }}
            >
              Clear search
            </button>
          </div>
        {:else}
          {#each filteredList as ev (ev.event_id)}
            <button
              type="button"
              class="pcard"
              aria-label={`${ev.title}, ${fmtRange(ev)}, ${STATUS_EN[ev.status] || ev.status}`}
              onclick={() => openProject(ev.event_id)}
            >
              <span class="pcard-title">{ev.title}</span>
              <span class="pcard-date">&bull; {fmtRange(ev)}</span>
              <span class={`badge st-${ev.status}`} title={STATUS_EN[ev.status] || ev.status}>
                {STATUS_TH[ev.status] || ev.status}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {:else if dash}
    {@const ev = selectedProject}
    {@const days = projectDaysOf(ev)}
    {@const gMap = ev.breakdown[groupBy] || {}}
    <div id="projectDetail">
      <div class="detail-top">
        <button class="btn back-btn" type="button" bind:this={backBtn} onclick={closeProject}>
          &larr; All projects
        </button>
      </div>

      <!-- 1) Name / picture / detail / location / status / date / planned budget -->
      <article class="card pd-head">
        <div class="pd-title">
          <span class="avatar big" aria-hidden="true">
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
            <span class={`badge st-${ev.status}`} title={STATUS_EN[ev.status] || ev.status}>
              {STATUS_TH[ev.status] || ev.status}
            </span>
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
              {ev.stats.attendanceRate == null ? 'no check-ins yet' : `${pct(ev.stats.attendanceRate)} of participants`}
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
                    <th>Attendees</th>
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
                <tr><th></th><th>Amount</th></tr>
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
