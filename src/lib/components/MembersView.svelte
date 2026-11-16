<script lang="ts">
  import { fmtDate, initials } from '$lib/format';
  import type { DashboardMember, DashboardPayload } from '$lib/types';

  let { dash }: { dash: DashboardPayload | null } = $props();

  let query = $state('');
  let deptFilter = $state('all');
  let yearFilter = $state('all');
  let statusFilter = $state('all');

  const members = $derived(dash?.members ?? []);

  const departments = $derived.by(() => {
    if (!dash) return [] as Array<{ name: string; count: number; pct: number }>;
    const total = Math.max(members.length, 1);
    return Object.entries(dash.membersByDepartment)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({
        name,
        count,
        pct: Math.round((count / total) * 100)
      }));
  });

  const yearEntries = $derived.by(() => {
    if (!dash) return [] as Array<{ label: string; rawYear: string; count: number; pct: number }>;
    const total = Math.max(members.length, 1);
    return Object.entries(dash.membersByYear)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, count]) => ({
        label,
        rawYear: label.replace(/^Year\s+/i, ''),
        count,
        pct: Math.round((count / total) * 100)
      }));
  });

  const genderEntries = $derived.by(() => {
    if (!dash) return [] as Array<{ label: string; count: number; pct: number }>;
    const total = Math.max(members.length, 1);
    return Object.entries(dash.membersByGender)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        pct: Math.round((count / total) * 100)
      }));
  });

  const statusOptions = $derived.by(() => {
    const set = new Set<string>();
    for (const m of members) {
      if (m.member_status) set.add(m.member_status);
    }
    return Array.from(set).sort();
  });

  const onLeaveCount = $derived.by(() => {
    return members.filter((m) => m.member_status.toLowerCase() === 'on leave').length;
  });

  const filteredMembers = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (deptFilter !== 'all' && m.department !== deptFilter) return false;
      if (yearFilter !== 'all' && m.year !== yearFilter) return false;
      if (statusFilter !== 'all' && (m.member_status || 'Active') !== statusFilter) return false;
      if (!q) return true;
      return (
        m.full_name.toLowerCase().includes(q) ||
        m.member_id.toLowerCase().includes(q) ||
        m.major.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q)
      );
    });
  });

  function statusPillClass(status: string): string {
    const s = status.toLowerCase();
    if (s === 'on leave') return 'leave';
    if (s === 'graduating') return 'graduating';
    return 'active';
  }
</script>

<section id="members" class="page-content">
  <div class="page-heading">
    <div>
      <p class="eyebrow">WORKSPACE <span class="heading-dot">&middot;</span> MEMBERS</p>
      <h1>Members</h1>
      <p class="subheading">Get a clear picture of your club community.</p>
    </div>
  </div>

  <div class="overview-4">
    <div>
      <span class="overview-label">TOTAL MEMBERS</span>
      <b>{dash ? dash.metrics.members : 0}</b>
    </div>
    <div>
      <span class="overview-label">ACTIVE MEMBERS</span>
      <b>{dash ? dash.metrics.activeMembers : 0}</b>
    </div>
    <div>
      <span class="overview-label">ON LEAVE</span>
      <b>{onLeaveCount}</b>
    </div>
    <div>
      <span class="overview-label">DEPARTMENTS</span>
      <b>{departments.length}</b>
    </div>
  </div>

  <div class="two-panel-grid">
    <article class="panel">
      <div class="panel-heading">
        <div>
          <h3>Members by department / committee</h3>
          <p>Distribution across club committees and general membership</p>
        </div>
      </div>
      <div class="breakdown-bars">
        {#each departments as d, i (d.name)}
          {@const cls = i % 4 === 1 ? 'gold' : i % 4 === 2 ? 'lilac-fill' : i % 4 === 3 ? 'sage' : ''}
          <div class="budget-row">
            <div>
              <span>{d.name}</span>
              <b>{d.count} <small>({d.pct}%)</small></b>
            </div>
            <div class={`h-progress ${cls}`}>
              <i style={`width:${d.pct}%`}></i>
            </div>
          </div>
        {/each}
      </div>
    </article>

    <article class="panel">
      <div class="panel-heading">
        <div>
          <h3>Demographics (Year &amp; Gender)</h3>
          <p>Academic year and gender composition across {members.length} members</p>
        </div>
      </div>
      <div class="demographics-split">
        <div>
          <p class="sub-label">Academic Year</p>
          <div class="breakdown-bars">
            {#each yearEntries as y (y.label)}
              <div class="budget-row">
                <div>
                  <span>{y.label}</span>
                  <b>{y.count} <small>({y.pct}%)</small></b>
                </div>
                <div class="h-progress gold">
                  <i style={`width:${y.pct}%`}></i>
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div>
          <p class="sub-label">Gender</p>
          <div class="breakdown-bars">
            {#each genderEntries as g, i (g.label)}
              <div class="budget-row">
                <div>
                  <span>{g.label}</span>
                  <b>{g.count} <small>({g.pct}%)</small></b>
                </div>
                <div class={`h-progress ${i === 0 ? 'sage' : 'lilac-fill'}`}>
                  <i style={`width:${g.pct}%`}></i>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </article>
  </div>

  <div class="project-toolbar">
    <div class="search-box">
      <span aria-hidden="true">&#8981;</span>
      <label class="sr-only" for="memberSearch">Search members</label>
      <input
        id="memberSearch"
        type="search"
        placeholder="Search name, ID, major, or role..."
        autocomplete="off"
        bind:value={query}
      />
    </div>

    <div class="filter-actions">
      <select id="memberDeptFilter" aria-label="Filter by department" bind:value={deptFilter}>
        <option value="all">All departments</option>
        {#each departments as d (d.name)}
          <option value={d.name}>{d.name} ({d.count})</option>
        {/each}
      </select>

      <select id="memberYearFilter" aria-label="Filter by academic year" bind:value={yearFilter}>
        <option value="all">All years</option>
        {#each yearEntries as y (y.label)}
          {#if y.rawYear !== 'Unknown'}
            <option value={y.rawYear}>{y.label}</option>
          {/if}
        {/each}
      </select>

      <select id="memberStatusFilter" aria-label="Filter by status" bind:value={statusFilter}>
        <option value="all">All statuses</option>
        {#each statusOptions as st (st)}
          <option value={st}>{st}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="table-wrap">
    {#if !filteredMembers.length}
      <div class="empty-state">
        <p>No members match your filters.</p>
        <button
          class="btn small"
          type="button"
          onclick={() => {
            query = '';
            deptFilter = 'all';
            yearFilter = 'all';
            statusFilter = 'all';
          }}
        >
          Clear filters
        </button>
      </div>
    {:else}
      <div class="table-scroll">
        <table class="project-table">
          <thead>
            <tr>
              <th>MEMBER</th>
              <th>DEPARTMENT &amp; ROLE</th>
              <th>MAJOR</th>
              <th>YEAR</th>
              <th>JOINED DATE</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredMembers as m (m.member_id)}
              {@const st = m.member_status || 'Active'}
              <tr>
                <td>
                  <div class="project-title-cell">
                    <span class="lead-avatar">{initials(m.full_name)}</span>
                    <span>
                      <span class="project-name">{m.full_name}</span>
                      <span class="project-category">{m.member_id} &middot; {m.gender || '—'}</span>
                    </span>
                  </div>
                </td>
                <td>
                  <span class="project-name">{m.department || 'General Members'}</span>
                  <span class="project-category">{m.role || 'Member'}</span>
                </td>
                <td>{m.major || '–'}</td>
                <td>{m.year ? `Year ${m.year}` : '–'}</td>
                <td class="due-cell">{m.joined_date ? fmtDate(m.joined_date) : '–'}</td>
                <td>
                  <span class={`status-pill ${statusPillClass(st)}`}>{st}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>Showing <b>{filteredMembers.length}</b> of {members.length} members</span>
        <span>Privacy-safe directory (emails omitted)</span>
      </div>
    {/if}
  </div>
</section>
