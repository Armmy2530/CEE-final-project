<script lang="ts">
  import {
    baht,
    fmtCompactRange,
    fmtDate,
    getDisplayStatus,
    pct,
    type DisplayStatus
  } from '$lib/format';
  import { rank } from '$lib/search';
  import type { DashboardPayload, ProjectSummary } from '$lib/types';
  import type { PageId } from './Topbar.svelte';

  let {
    dash,
    selectedProjectId = $bindable<string | null>(null),
    refreshing = false,
    isAdmin = false,
    onRefresh,
    onSelectPage,
    onOpenSheetPicker
  }: {
    dash: DashboardPayload | null;
    selectedProjectId?: string | null;
    refreshing?: boolean;
    isAdmin?: boolean;
    onRefresh?: () => void;
    onSelectPage?: (page: PageId) => void;
    onOpenSheetPicker?: () => void;
  } = $props();

  let query = $state('');
  let statusFilter = $state<'all' | 'Done' | 'Processing' | 'Waiting'>('all');
  let sortBy = $state<'newest' | 'oldest' | 'name' | 'relevance'>('newest');
  let visibleCount = $state(8);
  let groupBy = $state<'gender' | 'year' | 'major'>('year');
  let displayDropOpen = $state(false);
  let showAllTx = $state(false);
  let showRoster = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);

  const today = $derived(dash?.today || '2026-11-18');

  const filteredList = $derived.by(() => {
    if (!dash) return [] as ProjectSummary[];
    let pool = dash.events.slice();
    if (statusFilter !== 'all') {
      pool = pool.filter((e) => getDisplayStatus(e, today) === statusFilter);
    }
    const byDateDesc = (a: ProjectSummary, b: ProjectSummary) =>
      b.date.localeCompare(a.date) || b.event_id.localeCompare(a.event_id);
    if (sortBy === 'relevance') {
      return query.trim()
        ? rank(
            pool,
            query,
            (e) => `${e.title} ${e.event_id} ${e.lead.name} ${e.category}`,
            (e) => e.date
          )
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

  const shownList = $derived.by(() => {
    if (query.trim() || statusFilter !== 'all') return filteredList;
    return filteredList.slice(0, visibleCount);
  });

  const selectedProject = $derived.by(() => {
    if (!dash) return null;
    if (selectedProjectId) {
      const found = dash.events.find((e) => e.event_id === selectedProjectId);
      if (found) return found;
    }
    const preferred =
      filteredList.find((e) => getDisplayStatus(e, today) === 'Processing') ??
      filteredList[0] ??
      dash.events[0] ??
      null;
    return preferred;
  });

  $effect(() => {
    if (selectedProjectId) {
      showAllTx = false;
      showRoster = false;
    }
  });

  function selectProject(id: string) {
    selectedProjectId = id;
    showAllTx = false;
    showRoster = false;
  }

  function statusTone(st: DisplayStatus): string {
    if (st === 'Done') return 'done';
    if (st === 'Processing') return 'processing';
    if (st === 'Waiting') return 'waiting';
    return 'cancelled';
  }

  function diffDaysIso(fromIso: string, toIso: string): number {
    const a = Date.parse(`${fromIso}T00:00:00Z`);
    const b = Date.parse(`${toIso}T00:00:00Z`);
    return Math.round((b - a) / 86400000);
  }

  function fmtShortDay(iso: string): string {
    const p = iso.split('-');
    if (p.length !== 3) return iso;
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  const timelineStats = $derived.by(() => {
    const ev = selectedProject;
    if (!ev) return { pct: 0, headline: '', footer: '' };
    const st = getDisplayStatus(ev, today);
    const total = Math.max(1, ev.days);
    if (st === 'Done') {
      return {
        pct: 100,
        headline: `${total} ${total === 1 ? 'day' : 'days'}`,
        footer: `Completed · ${fmtDate(ev.end_date || ev.date)}`
      };
    }
    if (st === 'Waiting') {
      const until = Math.max(0, diffDaysIso(today, ev.date));
      return {
        pct: 0,
        headline: `${total} ${total === 1 ? 'day' : 'days'}`,
        footer: `Today is ${fmtShortDay(today)} · Starts in ${until} ${until === 1 ? 'day' : 'days'}`
      };
    }
    const elapsed = Math.min(total, Math.max(1, diffDaysIso(ev.date, today) + 1));
    const left = Math.max(0, diffDaysIso(today, ev.end_date || ev.date));
    const ratio = Math.min(100, Math.round((elapsed / total) * 100));
    return {
      pct: ratio,
      headline: `Day ${elapsed} of ${total}`,
      footer:
        left === 0
          ? `Today is ${fmtShortDay(today)} · Ends today`
          : `Today is ${fmtShortDay(today)} · ${left} ${left === 1 ? 'day' : 'days'} left`
    };
  });

  const rosterMix = $derived.by(() => {
    const ev = selectedProject;
    if (!ev) return { staffPct: 0, partPct: 100 };
    const total = ev.stats.staff + ev.stats.participants;
    if (total <= 0) return { staffPct: 0, partPct: 0 };
    const staffPct = Math.round((ev.stats.staff / total) * 100);
    return { staffPct, partPct: Math.max(0, 100 - staffPct) };
  });

  const breakdownItems = $derived.by(() => {
    const ev = selectedProject;
    if (!ev) return [] as Array<{ label: string; shortLabel: string; value: number }>;
    const g = ev.breakdown[groupBy] || {};
    const keys = Object.keys(g);
    if (groupBy === 'year') keys.sort();
    else keys.sort((a, b) => g[b] - g[a] || a.localeCompare(b));
    return keys.map((k) => ({
      label: k,
      shortLabel: k.replace(/\s+Engineering$/i, ''),
      value: g[k] ?? 0
    }));
  });

  const breakdownMax = $derived.by(() => {
    const m = Math.max(1, ...breakdownItems.map((x) => x.value));
    return Math.ceil((m * 1.18) / 5) * 5;
  });

  const budgetMax = $derived.by(() => {
    const ev = selectedProject;
    if (!ev) return 1000;
    return Math.max(1000, ev.budget_planned, ev.actual) * 1.15;
  });

  const projectTransactions = $derived.by(() => {
    const ev = selectedProject;
    if (!ev || !dash) return [];
    return dash.transactions.filter((t) => t.event_id === ev.event_id);
  });

  const displayedTransactions = $derived(
    showAllTx ? projectTransactions : projectTransactions.slice(0, 3)
  );

  const GROUP_LABEL: Record<'gender' | 'year' | 'major', string> = {
    gender: 'Gender',
    year: 'Year',
    major: 'Major'
  };

  function handleWindowClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t?.closest('.ac-display-by')) {
      displayDropOpen = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<section id="projects" class="ac-page">
  <div class="ac-projects-split">
    <!-- Left Master List -->
    <aside class="ac-card ac-proj-sidebar" aria-label="Projects list">
      <div class="ac-proj-list-head">
        <h2>Projects</h2>
        <span>{dash?.events.length ?? 0} projects</span>
      </div>

      <div class="ac-proj-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" stroke-linecap="round" />
        </svg>
        <label class="sr-only" for="projectSearch">Search projects by name or ID</label>
        <input
          id="projectSearch"
          type="search"
          placeholder="Search projects by name or ID"
          autocomplete="off"
          bind:this={searchInput}
          bind:value={query}
        />
      </div>

      <div class="ac-proj-sort-row">
        <label for="projectSort">Sort by</label>
        <select id="projectSort" bind:value={sortBy}>
          <option value="newest">Start date: newest</option>
          <option value="oldest">Start date: oldest</option>
          <option value="name">Name: A–Z</option>
          <option value="relevance">Best match</option>
        </select>
      </div>

      <div class="ac-proj-filter-tabs" role="tablist" aria-label="Filter projects by status">
        {#each ['all', 'Done', 'Processing', 'Waiting'] as tab}
          <button
            type="button"
            role="tab"
            class="ac-filter-tab"
            class:active={statusFilter === tab}
            aria-selected={statusFilter === tab}
            onclick={() => (statusFilter = tab as typeof statusFilter)}
          >
            {tab === 'all' ? 'All' : tab}
          </button>
        {/each}
      </div>

      <div class="ac-proj-items" id="project-rows">
        {#if !shownList.length}
          <div class="ac-proj-empty">
            <p>No matching projects.</p>
            <button
              type="button"
              class="btn small"
              onclick={() => {
                query = '';
                statusFilter = 'all';
                searchInput?.focus();
              }}
            >
              Reset filters
            </button>
          </div>
        {:else}
          {#each shownList as ev (ev.event_id)}
            {@const st = getDisplayStatus(ev, today)}
            {@const isActive = selectedProject?.event_id === ev.event_id}
            <button
              type="button"
              class="ac-proj-item"
              class:active={isActive}
              onclick={() => selectProject(ev.event_id)}
            >
              <strong class="ac-proj-item-title">{ev.title}</strong>
              <div class="ac-proj-item-meta">
                <span>{ev.event_id} &middot; {fmtCompactRange(ev)}</span>
                <em class={`ac-st-badge ${statusTone(st)}`}>{st}</em>
              </div>
            </button>
          {/each}
        {/if}
      </div>

      <div class="ac-proj-list-foot">
        <span id="projectCount">Showing {shownList.length} of {filteredList.length}</span>
        {#if shownList.length < filteredList.length}
          <button
            type="button"
            class="ac-load-more-btn"
            onclick={() => (visibleCount += 8)}
          >
            Load more
          </button>
        {/if}
      </div>
    </aside>

    <!-- Right Detail Panel -->
    <div class="ac-proj-detail-col" id="projectDetail">
      {#if !selectedProject}
        <div class="ac-card ac-empty-detail">
          <p>Select a project from the list to inspect its dates, attendance, budget, and transactions.</p>
        </div>
      {:else}
        {@const ev = selectedProject}
        {@const st = getDisplayStatus(ev, today)}

        <!-- 1. Hero summary card -->
        <article class="ac-card ac-pd-hero">
          <div class="ac-pd-hero-top">
            <h1>{ev.title}</h1>
            <span class={`ac-st-badge lg ${statusTone(st)}`}>{st}</span>
          </div>
          <div class="ac-pd-code">{ev.event_id}</div>
          <p class="ac-pd-desc">{ev.description || 'No description recorded for this project.'}</p>

          <dl class="ac-pd-facts">
            <div class="ac-pd-fact">
              <span class="ac-pd-fact-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
              </span>
              <div>
                <dt>Location</dt>
                <dd>{ev.location || 'Not recorded'}</dd>
              </div>
            </div>

            <div class="ac-pd-fact">
              <span class="ac-pd-fact-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M16 3v4M8 3v4M3 10h18" stroke-linecap="round" />
                </svg>
              </span>
              <div>
                <dt>Date</dt>
                <dd>{fmtCompactRange(ev)}</dd>
              </div>
            </div>

            <div class="ac-pd-fact">
              <span class="ac-pd-fact-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="6" width="18" height="13" rx="2" />
                  <path d="M3 10h18" />
                </svg>
              </span>
              <div>
                <dt>Total income (THB)</dt>
                <dd>{ev.budget_planned > 0 ? baht(ev.budget_planned) : 'Not recorded'}</dd>
              </div>
            </div>
          </dl>
        </article>

        <!-- 2. Dates & Roster row -->
        <div class="ac-pd-grid-2">
          <article class="ac-card ac-pd-subcard">
            <div class="ac-card-head">
              <h2>Project dates</h2>
              <span class="ac-pd-accent-meta">{timelineStats.headline}</span>
            </div>

            <div class="ac-pd-dates-pair">
              <div>
                <small>Start</small>
                <strong>{fmtDate(ev.date)}</strong>
              </div>
              <div>
                <small>End</small>
                <strong>{fmtDate(ev.end_date || ev.date)}</strong>
              </div>
            </div>

            <div class="ac-pd-progress-bar" aria-hidden="true">
              <span style={`width:${timelineStats.pct}%`}></span>
            </div>
            <p class="ac-pd-subfoot">{timelineStats.footer}</p>
          </article>

          <article class="ac-card ac-pd-subcard">
            <div class="ac-card-head">
              <h2>Staff &amp; participants</h2>
              {#if ev.staff.length || ev.participants.length}
                <button
                  type="button"
                  class="ac-text-btn"
                  onclick={() => (showRoster = !showRoster)}
                >
                  {showRoster ? 'Hide roster' : 'View roster'}
                </button>
              {/if}
            </div>

            <div class="ac-pd-roster-nums">
              <div class="ac-pd-roster-stat">
                <span class="ac-pd-roster-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="3" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a3 3 0 0 1 0 5.74" />
                  </svg>
                </span>
                <div>
                  <strong>{ev.stats.staff}</strong>
                  <small>Staff</small>
                </div>
              </div>

              <div class="ac-pd-roster-stat">
                <span class="ac-pd-roster-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="3" />
                  </svg>
                </span>
                <div>
                  <strong>{ev.stats.participants}</strong>
                  <small>Participants</small>
                </div>
              </div>
            </div>

            <div class="ac-pd-dual-bar" aria-hidden="true">
              <span class="staff-seg" style={`width:${rosterMix.staffPct}%`}></span>
              <span class="part-seg" style={`width:${rosterMix.partPct}%`}></span>
            </div>
            <p class="ac-pd-subfoot">
              {ev.stats.staff} staff &middot; {ev.stats.participants} participants in the project roster
            </p>
          </article>
        </div>

        {#if showRoster}
          <article class="ac-card ac-pd-subcard">
            <div class="ac-card-head">
              <h2>Project roster ({ev.staff.length + ev.participants.length})</h2>
              <button type="button" class="ac-text-btn" onclick={() => (showRoster = false)}>
                Close
              </button>
            </div>
            <div class="two-col" style="margin-top:12px">
              <div>
                <h3 style="font-size:12px;color:var(--muted);margin:0 0 8px">Staff ({ev.staff.length})</h3>
                <ul class="people">
                  {#each ev.staff as p (p.member_id + p.role)}
                    <li>
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.role ? ` · ${p.role}` : ''}{p.department ? ` · ${p.department}` : ''}</small>
                      </span>
                      <span class={`badge as-${p.status}`}>{p.status}</span>
                    </li>
                  {/each}
                </ul>
              </div>
              <div>
                <h3 style="font-size:12px;color:var(--muted);margin:0 0 8px">Participants ({ev.participants.length})</h3>
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
              </div>
            </div>
          </article>
        {/if}

        <!-- 3. Attendance & Budget charts row -->
        <div class="ac-pd-grid-2">
          <article class="ac-card ac-pd-subcard">
            <div class="ac-card-head">
              <div>
                <h2>Attendance</h2>
                <p class="ac-card-sub">
                  {ev.attendees} attended &middot; roster by {groupBy}
                </p>
              </div>

              <div class="ac-display-by">
                <button
                  type="button"
                  id="groupBy"
                  class="ac-display-btn"
                  aria-haspopup="true"
                  aria-expanded={displayDropOpen}
                  onclick={(e) => {
                    e.stopPropagation();
                    displayDropOpen = !displayDropOpen;
                  }}
                >
                  <span>Display by <strong>{GROUP_LABEL[groupBy]}</strong></span>
                  <span aria-hidden="true">&#8964;</span>
                </button>

                {#if displayDropOpen}
                  <div class="ac-display-menu" role="radiogroup" aria-label="Display attendance by">
                    {#each ['gender', 'year', 'major'] as opt}
                      {@const active = groupBy === opt}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        class="ac-display-opt"
                        class:selected={active}
                        onclick={() => {
                          groupBy = opt as typeof groupBy;
                          displayDropOpen = false;
                        }}
                      >
                        <span class="ac-radio-dot" class:checked={active} aria-hidden="true"></span>
                        <span>{GROUP_LABEL[opt as keyof typeof GROUP_LABEL]}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            {#if !breakdownItems.length}
              <p class="ac-pd-empty-chart">No attendance records for {ev.event_id} yet.</p>
            {:else}
              <div class="ac-pd-vchart-scroll" class:is-compact={groupBy === 'major'}>
                <div class="ac-pd-vchart" class:compact-labels={groupBy === 'major'}>
                  <div class="ac-pd-vchart-grid" aria-hidden="true">
                    <span></span><span></span><span></span><span></span>
                  </div>
                  <div class="ac-pd-vchart-cols">
                    {#each breakdownItems as item (item.label)}
                      {@const h = Math.max(4, Math.round((item.value / breakdownMax) * 100))}
                      <div class="ac-pd-col" title={`${item.label}: ${item.value}`}>
                        <span class="ac-pd-val">{item.value}</span>
                        <div class="ac-pd-bar-rail">
                          <span class="ac-pd-bar-fill ochre" style={`height:${h}%`}></span>
                        </div>
                        <small>{item.shortLabel}</small>
                      </div>
                    {/each}
                  </div>
                </div>
              </div>
            {/if}

            <p class="ac-pd-subfoot">
              Views: Gender / Year / Major &middot; checked-in roster ({ev.breakdownYear})
            </p>
          </article>

          <article class="ac-card ac-pd-subcard">
            <div class="ac-card-head">
              <div>
                <h2>Budget</h2>
                <p class="ac-card-sub">Planned vs actual &middot; THB</p>
              </div>
              <span class="ac-thb-tag">THB</span>
            </div>

            <div class="ac-pd-budget-chart">
              <div class="ac-pd-col">
                <span class="ac-pd-val" class:muted-val={ev.budget_planned <= 0}>
                  {ev.budget_planned > 0 ? baht(ev.budget_planned) : 'Not recorded'}
                </span>
                <div class="ac-pd-bar-rail wide">
                  <span
                    class="ac-pd-bar-fill planned"
                    style={`height:${ev.budget_planned > 0 ? Math.max(6, Math.round((ev.budget_planned / budgetMax) * 100)) : 2}%`}
                  ></span>
                </div>
                <small>Planned</small>
              </div>

              <div class="ac-pd-col">
                <span class="ac-pd-val" class:muted-val={ev.actual <= 0}>
                  {ev.actual > 0 ? baht(ev.actual) : 'Not recorded'}
                </span>
                <div class="ac-pd-bar-rail wide">
                  <span
                    class="ac-pd-bar-fill ochre"
                    style={`height:${ev.actual > 0 ? Math.max(6, Math.round((ev.actual / budgetMax) * 100)) : 2}%`}
                  ></span>
                </div>
                <small>Actual expenses</small>
              </div>
            </div>

            {#if ev.status !== 'Cancelled' && ev.pct != null && ev.pct >= 0.8}
              <p class="ac-pd-budget-warn" class:crit={ev.pct >= 1}>
                {ev.pct >= 1 ? 'Over budget:' : 'Budget alert:'} {pct(ev.pct)} of planned budget used.
              </p>
            {:else}
              <p class="ac-pd-subfoot">
                {ev.budget_planned > 0
                  ? `${pct(ev.pct)} of planned budget spent (${baht(Math.max(0, ev.budget_planned - ev.actual))} remaining).`
                  : 'Planned budget is not recorded in the source.'}
              </p>
            {/if}
          </article>
        </div>

        <!-- 4. Transaction preview table -->
        <article class="ac-card ac-pd-tx-card">
          <div class="ac-card-head">
            <div>
              <h2>Transaction preview</h2>
              <p class="ac-card-sub">
                Latest records for {ev.event_id} &middot; Read-only
              </p>
            </div>
            {#if projectTransactions.length > 3}
              <button
                type="button"
                class="ac-tx-more-btn"
                onclick={() => (showAllTx = !showAllTx)}
              >
                {showAllTx
                  ? 'Show latest 3'
                  : `View all ${projectTransactions.length} transactions →`}
              </button>
            {/if}
          </div>

          {#if !projectTransactions.length}
            <p class="muted" style="margin-top:12px">No budget transactions recorded for {ev.event_id}.</p>
          {:else}
            <div class="ac-tx-table-wrap">
              <table class="ac-tx-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Expense type</th>
                    <th class="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {#each displayedTransactions as tx (tx.expense_id)}
                    <tr>
                      <td>{tx.date ? fmtDate(tx.date) : '–'}</td>
                      <td>
                        <span class={tx.type === 'Income' ? 'ac-tx-income' : 'ac-tx-expense'}>
                          {tx.type}
                        </span>
                      </td>
                      <td>{tx.category}</td>
                      <td class="right num">{baht(tx.amount)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </article>
      {/if}
    </div>
  </div>

  {#if onRefresh || (isAdmin && onOpenSheetPicker) || onSelectPage}
    <div class="ac-proj-footer-bar">
      <span>
        {dash?.meta?.source === 'google'
          ? `Connected to ${dash.meta.sheetTitle || 'Google Sheets'}`
          : 'Normalized Mock-Data CSVs'}
      </span>
      <div class="ac-proj-footer-actions">
        {#if onSelectPage}
          <button type="button" class="ac-text-btn" onclick={() => onSelectPage('budget')}>
            Open full budget ledger &rarr;
          </button>
        {/if}
        {#if isAdmin && onOpenSheetPicker}
          <button type="button" class="ac-text-btn" onclick={onOpenSheetPicker}>
            Configure Google Sheet
          </button>
        {/if}
        {#if onRefresh}
          <button type="button" class="ac-text-btn" disabled={refreshing} onclick={onRefresh}>
            {refreshing ? 'Syncing...' : 'Sync now'}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</section>
