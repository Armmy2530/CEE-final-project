<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import AuthView from '$lib/components/AuthView.svelte';
  import ChatWidget from '$lib/components/ChatWidget.svelte';
  import ProjectsView from '$lib/components/ProjectsView.svelte';
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
  let hasUnread = $state(false);
  let toasts = $state<ToastItem[]>([]);
  let nextToastId = 1;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  $effect.pre(() => {
    user = data.user;
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

  function pushToast(title: string, body: string, severity: 'critical' | 'warning') {
    const id = nextToastId++;
    toasts = [...toasts, { id, title, body, severity }];
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

  function openProjectFromCalendar(eventId: string) {
    selectedProjectId = eventId;
    activePage = 'projects';
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
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
      onSelectPage={(p) => {
        if (p === 'projects') selectedProjectId = null;
        activePage = p;
      }}
      onSetTheme={handleSetTheme}
      onMarkSeen={markSeen}
      onLogout={handleLogout}
    />

    <main class="main-content">
      {#if activePage === 'summary'}
        <SummaryView
          {dash}
          {loadError}
          {refreshing}
          onRefresh={() => loadDashboard(true, false)}
          onOpenProject={openProjectFromCalendar}
        />
      {:else if activePage === 'projects'}
        <ProjectsView {dash} bind:selectedProjectId />
      {:else if activePage === 'users' && user.role === 'admin'}
        <UsersView currentUser={user} />
      {/if}
    </main>

    <ChatWidget firstName={user.full_name.split(' ')[0]} />

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
