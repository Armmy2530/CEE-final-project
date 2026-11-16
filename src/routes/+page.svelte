<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import AuthView from '$lib/components/AuthView.svelte';
  import BudgetView from '$lib/components/BudgetView.svelte';
  import Calendar from '$lib/components/Calendar.svelte';
  import ChatWidget from '$lib/components/ChatWidget.svelte';
  import MembersView from '$lib/components/MembersView.svelte';
  import ProjectsView from '$lib/components/ProjectsView.svelte';
  import SheetPickerModal from '$lib/components/SheetPickerModal.svelte';
  import SummaryView from '$lib/components/SummaryView.svelte';
  import ToastContainer, { type ToastItem } from '$lib/components/ToastContainer.svelte';
  import Topbar, { type PageId } from '$lib/components/Topbar.svelte';
  import UsersView from '$lib/components/UsersView.svelte';
  import { apiFetch } from '$lib/format';
  import type { AlertItem, DashboardPayload, SessionUser, ThemeMode } from '$lib/types';

  let { data } = $props();

  const themeCtx = getContext<{ readonly value: ThemeMode; set: (t: ThemeMode) => void }>('theme');

  let user = $state<SessionUser | null>(null);
  let activePage = $state<PageId>('summary');
  let selectedProjectId = $state<string | null>(null);
  let dash = $state<DashboardPayload | null>(null);
  let loadError = $state('');
  let refreshing = $state(false);
  let notifOpen = $state(false);
  let sheetPickerOpen = $state(false);
  let hasUnread = $state(false);
  let toasts = $state<ToastItem[]>([]);
  let nextToastId = 1;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  $effect.pre(() => {
    user = data.user;
  });

  const sourceLabel = $derived(
    dash?.meta?.source === 'google'
      ? dash.meta.sheetTitle || 'Google Sheet'
      : 'Mock CSV data'
  );

  const syncedLabel = $derived.by(() => {
    if (refreshing) return 'Syncing...';
    if (!dash?.meta?.fetchedAt) return 'Waiting to sync';
    return (
      'Synced ' +
      new Date(dash.meta.fetchedAt).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      })
    );
  });

  function seenKey(memberId: string): string {
    return `seenAlerts:${memberId}`;
  }

  function getSeenSet(memberId: string): string[] {
    try {
      return JSON.parse(localStorage.getItem(seenKey(memberId)) || '[]');
    } catch {
      return [];
    }
  }

  function alertSig(a: AlertItem): string {
    return `${a.id}@${a.title}`;
  }

  function markSeen() {
    if (!user || !dash) return;
    try {
      localStorage.setItem(seenKey(user.member_id), JSON.stringify(dash.alerts.map(alertSig)));
    } catch {
      // ignore
    }
    hasUnread = false;
  }

  function pushToast(
    title: string,
    body: string,
    severity: ToastItem['severity'],
    hideView = false
  ) {
    const id = nextToastId++;
    toasts = [...toasts, { id, title, body, severity, hideView }];
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, 9000);
  }

  function processAlerts(d: DashboardPayload, announce: boolean) {
    if (!user) return;
    const seen = getSeenSet(user.member_id);
    const fresh = d.alerts.filter((a) => !seen.includes(alertSig(a)));
    hasUnread = fresh.length > 0 && !notifOpen;
    if (announce && fresh.length) {
      const worst = fresh.some((a) => a.severity === 'critical');
      pushToast(
        `${fresh.length}${fresh.length === 1 ? ' alert needs' : ' alerts need'} your attention`,
        `${fresh[0].title}${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ''}`,
        worst ? 'critical' : 'warning'
      );
    }
  }

  async function loadDashboard(force = false, announce = false) {
    if (!user) return;
    refreshing = true;
    try {
      const d = await apiFetch<DashboardPayload>('GET', `/api/dashboard${force ? '?refresh=1' : ''}`);
      dash = d;
      loadError = '';
      processAlerts(d, announce);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) {
        stopPolling();
        user = null;
        dash = null;
        return;
      }
      loadError = err.message;
    } finally {
      refreshing = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && user) {
        loadDashboard(false, false);
      }
    }, 60000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function enterApp(u: SessionUser) {
    user = u;
    activePage = 'summary';
    if (u.theme === 'light' || u.theme === 'dark') {
      themeCtx.set(u.theme);
    }
    loadDashboard(false, true);
    startPolling();
  }

  async function handleLogout() {
    await apiFetch('POST', '/api/auth/logout');
    stopPolling();
    user = null;
    dash = null;
    toasts = [];
    notifOpen = false;
    sheetPickerOpen = false;
  }

  async function handleSetTheme(t: ThemeMode) {
    themeCtx.set(t);
    if (user) {
      user = { ...user, theme: t };
      try {
        await apiFetch('PATCH', '/api/me/theme', { theme: t });
      } catch {
        // local preference still saved
      }
    }
  }

  function selectPage(p: PageId) {
    if (p === 'projects') selectedProjectId = null;
    activePage = p;
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openProject(eventId: string) {
    selectedProjectId = eventId;
    activePage = 'projects';
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }

  async function handleSheetConnected(message: string) {
    await loadDashboard(true, false);
    pushToast('Data source updated', message, 'ok', true);
  }

  onMount(() => {
    if (user) {
      loadDashboard(false, true);
      startPolling();
    }
    return () => stopPolling();
  });
</script>

{#if !user}
  <AuthView onSuccess={enterApp} />
{:else}
  <div id="appView" class="app-shell">
    <Topbar
      {user}
      {activePage}
      theme={themeCtx.value}
      alerts={dash?.alerts ?? []}
      {hasUnread}
      bind:notifOpen
      projectCount={dash?.events.length ?? 0}
      memberCount={dash?.metrics.members ?? 0}
      {sourceLabel}
      {syncedLabel}
      stale={dash?.meta?.stale ?? false}
      {refreshing}
      onSelectPage={selectPage}
      onOpenProject={openProject}
      onSetTheme={handleSetTheme}
      onMarkSeen={markSeen}
      onRefresh={() => loadDashboard(true, false)}
      onOpenSheetPicker={() => (sheetPickerOpen = true)}
      onLogout={handleLogout}
    >
      {#if activePage === 'summary'}
        <SummaryView
          {dash}
          {loadError}
          {refreshing}
          firstName={user.full_name.split(' ')[0]}
          onRefresh={() => loadDashboard(true, false)}
          onOpenProject={openProject}
          onSelectPage={selectPage}
          onOpenSheetPicker={() => (sheetPickerOpen = true)}
        />
      {:else if activePage === 'projects'}
        <ProjectsView
          {dash}
          bind:selectedProjectId
          {refreshing}
          onRefresh={() => loadDashboard(true, false)}
          onSelectPage={selectPage}
          onOpenSheetPicker={() => (sheetPickerOpen = true)}
        />
      {:else if activePage === 'calendar'}
        <Calendar
          events={dash?.events ?? []}
          today={dash?.today ?? ''}
          onOpenProject={openProject}
        />
      {:else if activePage === 'members'}
        <MembersView {dash} />
      {:else if activePage === 'budget'}
        <BudgetView {dash} onOpenProject={openProject} />
      {:else if activePage === 'users' && user.role === 'admin'}
        <UsersView currentUser={user} />
      {/if}
    </Topbar>

    <ChatWidget firstName={user.full_name.split(' ')[0]} />

    <SheetPickerModal
      open={sheetPickerOpen}
      onClose={() => (sheetPickerOpen = false)}
      onConnected={handleSheetConnected}
    />

    <ToastContainer
      {toasts}
      onDismiss={(id) => (toasts = toasts.filter((t) => t.id !== id))}
      onView={(id) => {
        toasts = toasts.filter((t) => t.id !== id);
        notifOpen = true;
        markSeen();
      }}
    />
  </div>
{/if}
