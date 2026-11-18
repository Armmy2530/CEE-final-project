<script lang="ts">
  import { baht, fmtDate, pct } from '$lib/format';
  import type { DashboardPayload } from '$lib/types';

  let {
    dash,
    onOpenProject
  }: {
    dash: DashboardPayload | null;
    onOpenProject: (eventId: string) => void;
  } = $props();

  let query = $state('');
  let typeFilter = $state<'all' | 'Income' | 'Expense'>('all');
  let categoryFilter = $state('all');

  const plannedBudget = $derived(dash?.metrics.budgetPlanned ?? 0);
  const actualSpent = $derived(dash?.metrics.budgetActual ?? 0);
  const remaining = $derived(plannedBudget - actualSpent);
  const budgetPct = $derived(dash?.metrics.budgetPct ?? null);

  const categories = $derived.by(() => {
    if (!dash) return [] as Array<{ name: string; amount: number; sharePct: number }>;
    const total = Math.max(actualSpent, 1);
    return Object.entries(dash.budgetByCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name,
        amount,
        sharePct: Math.round((amount / total) * 1000) / 10
      }));
  });

  const projectHealth = $derived.by(() => {
    if (!dash) return [];
    return dash.events
      .slice()
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  });

  const transactions = $derived(dash?.transactions ?? []);

  const txCategoryOptions = $derived.by(() => {
    const set = new Set<string>();
    for (const tx of transactions) {
      if (tx.category) set.add(tx.category);
    }
    return Array.from(set).sort();
  });

  const filteredTx = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (categoryFilter !== 'all' && tx.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        tx.expense_id.toLowerCase().includes(q) ||
        tx.receipt_ref.toLowerCase().includes(q) ||
        tx.event_title.toLowerCase().includes(q) ||
        tx.event_id.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q)
      );
    });
  });

  function healthBadge(p: number | null, status: string): { cls: string; label: string } {
    if (status === 'Cancelled') return { cls: 'cancelled', label: 'Cancelled' };
    if (p != null && p >= 1) return { cls: 'cancelled', label: `Over (${pct(p)})` };
    if (p != null && p >= 0.8) return { cls: 'leave', label: `Alert (${pct(p)})` };
    return { cls: 'active', label: pct(p) };
  }
</script>

<section id="budget" class="page-content">
  <div class="page-heading">
    <div>
      <p class="eyebrow">MANAGE <span class="heading-dot">&middot;</span> BUDGET</p>
      <h1>Budget</h1>
      <p class="subheading">Stay on top of planned and actual club spending.</p>
    </div>
  </div>

  <div class="overview-4">
    <div>
      <span class="overview-label">PLANNED BUDGET</span>
      <b>{baht(plannedBudget)}</b>
    </div>
    <div>
      <span class="overview-label">ACTUAL SPENT</span>
      <b>{baht(actualSpent)}</b>
    </div>
    <div>
      <span class="overview-label">REMAINING</span>
      <b>{baht(remaining)}</b>
    </div>
    <div>
      <span class="overview-label">BUDGET USED</span>
      <b>{budgetPct == null ? '–' : `${(budgetPct * 100).toFixed(1)}%`}</b>
    </div>
  </div>

  <div class="two-panel-grid">
    <article class="panel">
      <div class="panel-heading">
        <div>
          <h3>Spending by category</h3>
          <p>All expense categories across {transactions.filter((t) => t.type === 'Expense').length} expense entries</p>
        </div>
      </div>
      <div class="breakdown-bars">
        {#each categories as cat, idx (cat.name)}
          {@const cls = idx % 4 === 1 ? 'gold' : idx % 4 === 2 ? 'lilac-fill' : idx % 4 === 3 ? 'sage' : ''}
          <div class="budget-row">
            <div>
              <span>{cat.name}</span>
              <b>{baht(cat.amount)} <small>({cat.sharePct}%)</small></b>
            </div>
            <div class={`h-progress ${cls}`}>
              <i style={`width:${Math.min(100, cat.sharePct)}%`}></i>
            </div>
          </div>
        {/each}
      </div>
    </article>

    <article class="panel">
      <div class="panel-heading">
        <div>
          <h3>Project budget health</h3>
          <p>Sorted by utilization; highlights &ge; 80% warning and &ge; 100% over budget</p>
        </div>
      </div>
      <div class="health-list">
        {#each projectHealth as ev (ev.event_id)}
          {@const badge = healthBadge(ev.pct, ev.status)}
          {@const barW = ev.pct == null ? 0 : Math.min(100, Math.round(ev.pct * 100))}
          <button type="button" class="health-item" onclick={() => onOpenProject(ev.event_id)}>
            <div class="health-item-top">
              <b>{ev.event_id} &middot; {ev.title}</b>
              <span class={`status-pill ${badge.cls}`}>{badge.label}</span>
            </div>
            <div class="table-progress">
              <i
                style={`width:${barW}%;background:${
                  ev.pct != null && ev.pct >= 1
                    ? 'var(--crit)'
                    : ev.pct != null && ev.pct >= 0.8
                      ? 'var(--warn)'
                      : 'var(--accent)'
                }`}
              ></i>
            </div>
            <div class="health-item-meta">
              <span>Actual {baht(ev.actual)}</span>
              <span>Planned {baht(ev.budget_planned)}</span>
            </div>
          </button>
        {/each}
      </div>
    </article>
  </div>

  <div class="project-toolbar">
    <div class="search-box ac-proj-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" stroke-linecap="round" />
      </svg>
      <label class="sr-only" for="txSearch">Search transactions</label>
      <input
        id="txSearch"
        type="search"
        placeholder="Search TX ID, receipt ref, or project..."
        autocomplete="off"
        bind:value={query}
      />
    </div>

    <div class="filter-actions">
      <select id="txTypeFilter" aria-label="Filter by transaction type" bind:value={typeFilter}>
        <option value="all">All types ({transactions.length})</option>
        <option value="Expense">Expense</option>
        <option value="Income">Income</option>
      </select>

      <select id="txCategoryFilter" aria-label="Filter by category" bind:value={categoryFilter}>
        <option value="all">All categories</option>
        {#each txCategoryOptions as cat (cat)}
          <option value={cat}>{cat}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="table-wrap">
    {#if !filteredTx.length}
      <div class="empty-state">
        <p>No transactions match your filters.</p>
        <button
          class="btn small"
          type="button"
          onclick={() => {
            query = '';
            typeFilter = 'all';
            categoryFilter = 'all';
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
              <th>TX ID</th>
              <th>DATE</th>
              <th>PROJECT</th>
              <th>CATEGORY</th>
              <th>TYPE</th>
              <th>RECEIPT REF</th>
              <th class="right">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredTx as tx (tx.expense_id)}
              <tr>
                <td class="budget-cell">{tx.expense_id}</td>
                <td class="due-cell">{tx.date ? fmtDate(tx.date) : '–'}</td>
                <td>
                  <button
                    type="button"
                    class="cal-detail-link"
                    onclick={() => onOpenProject(tx.event_id)}
                  >
                    <strong>{tx.event_title}</strong>
                  </button>
                  <span class="project-category">{tx.event_id}</span>
                </td>
                <td>{tx.category}</td>
                <td>
                  <span class={`status-pill ${tx.type === 'Income' ? 'income' : 'expense'}`}>
                    {tx.type}
                  </span>
                </td>
                <td>{tx.receipt_ref || '–'}</td>
                <td class="budget-cell right">{baht(tx.amount)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>Showing <b>{filteredTx.length}</b> of {transactions.length} transactions</span>
        <span>Click any project title to open its budget detail</span>
      </div>
    {/if}
  </div>
</section>
