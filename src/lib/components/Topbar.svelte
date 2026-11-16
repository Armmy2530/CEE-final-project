<script lang="ts">
  import type { Snippet } from 'svelte';
  import { initials } from '$lib/format';
  import type { AlertItem, SessionUser, ThemeMode } from '$lib/types';

  export type PageId = 'summary' | 'projects' | 'calendar' | 'members' | 'budget' | 'users';

  const PAGE_TITLES: Record<PageId, string> = {
    summary: 'Summary',
    projects: 'Project data',
    calendar: 'Events calendar',
    members: 'Members',
    budget: 'Budget',
    users: 'Users'
  };

  let {
    user,
    activePage,
    theme,
    alerts,
    hasUnread,
    notifOpen = $bindable(false),
    projectCount = 0,
    memberCount = 0,
    sourceLabel = 'Master sheet',
    syncedLabel = 'Synced just now',
    stale = false,
    refreshing = false,
    onSelectPage,
    onOpenProject,
    onSetTheme,
    onMarkSeen,
    onRefresh,
    onOpenSheetPicker,
    onLogout,
    children
  }: {
    user: SessionUser;
    activePage: PageId;
    theme: ThemeMode;
    alerts: AlertItem[];
    hasUnread: boolean;
    notifOpen?: boolean;
    projectCount?: number;
    memberCount?: number;
    sourceLabel?: string;
    syncedLabel?: string;
    stale?: boolean;
    refreshing?: boolean;
    onSelectPage: (page: PageId) => void;
    onOpenProject?: (eventId: string) => void;
    onSetTheme: (theme: ThemeMode) => void;
    onMarkSeen: () => void;
    onRefresh: () => void;
    onOpenSheetPicker?: () => void;
    onLogout: () => void;
    children?: Snippet;
  } = $props();

  let userMenuOpen = $state(false);
  const ICON: Record<AlertItem['severity'], string> = { critical: '!', warning: '!', info: 'i' };
  const breadcrumbTitle = $derived(PAGE_TITLES[activePage] || 'Summary');

  function toggleNotif(e: MouseEvent) {
    e.stopPropagation();
    const next = !notifOpen;
    userMenuOpen = false;
    notifOpen = next;
    if (next) onMarkSeen();
  }

  function toggleUserMenu(e: MouseEvent) {
    e.stopPropagation();
    const next = !userMenuOpen;
    notifOpen = false;
    userMenuOpen = next;
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.menu-wrap') && !target?.closest('.profile-wrap')) {
      notifOpen = false;
      userMenuOpen = false;
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      notifOpen = false;
      userMenuOpen = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<aside class="sidebar">
  <button
    type="button"
    class="brand"
    aria-label="Clubhouse home"
    onclick={() => onSelectPage('summary')}
  >
    <span class="brand-mark">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M4 14.2 20 7l16 7.2-16 7.1L4 14.2Z" />
        <path d="M10 18v7.4c5.9 4.3 14.1 4.3 20 0V18l-10 4.5L10 18Z" />
        <path d="M35.8 15v9.2" />
        <circle cx="35.8" cy="27" r="1.7" />
      </svg>
    </span>
    <span class="brand-word">clubhouse<span>.</span></span>
  </button>

  <div class="workspace-switch">
    <span class="workspace-icon">A</span>
    <span>
      <b>Academic AC</b>
      <small>Club workspace</small>
    </span>
    <span class="chevron" aria-hidden="true">&#8964;</span>
  </div>

  <p class="nav-label">WORKSPACE</p>
  <nav class="primary-nav" aria-label="Main navigation">
    <button
      type="button"
      class="nav-item"
      class:active={activePage === 'summary'}
      onclick={() => onSelectPage('summary')}
    >
      <span class="nav-icon" aria-hidden="true">&#9638;</span>
      Summary
    </button>
    <button
      type="button"
      class="nav-item"
      class:active={activePage === 'projects'}
      onclick={() => onSelectPage('projects')}
    >
      <span class="nav-icon" aria-hidden="true">&#9636;</span>
      Project data
      <span class="nav-count">{projectCount}</span>
    </button>
    <button
      type="button"
      class="nav-item"
      class:active={activePage === 'calendar'}
      onclick={() => onSelectPage('calendar')}
    >
      <span class="nav-icon" aria-hidden="true">&#9635;</span>
      Events calendar
    </button>
    <button
      type="button"
      class="nav-item"
      class:active={activePage === 'members'}
      onclick={() => onSelectPage('members')}
    >
      <span class="nav-icon" aria-hidden="true">&#9817;</span>
      Members
      <span class="nav-count">{memberCount}</span>
    </button>
  </nav>

  <p class="nav-label second-label">MANAGE</p>
  <nav class="primary-nav" aria-label="Management navigation">
    <button
      type="button"
      class="nav-item"
      class:active={activePage === 'budget'}
      onclick={() => onSelectPage('budget')}
    >
      <span class="nav-icon" aria-hidden="true">&#9707;</span>
      Budget
    </button>
    {#if user.role === 'admin'}
      <button
        type="button"
        id="usersTab"
        class="nav-item"
        class:active={activePage === 'users'}
        onclick={() => onSelectPage('users')}
      >
        <span class="nav-icon" aria-hidden="true">&#9639;</span>
        Users
      </button>
    {/if}
  </nav>

  <div class="sidebar-bottom">
    <div class="source-card">
      <button
        type="button"
        class="source-card-trigger"
        id="sourceCardBtn"
        title="Configure Google Sheet or data source"
        onclick={() => onOpenSheetPicker?.()}
      >
        <span class="source-dot" class:stale></span>
        <span>
          <b>{sourceLabel}</b>
          <small>{syncedLabel}</small>
        </span>
      </button>
      <button
        type="button"
        class="source-sync-btn"
        aria-label="Sync data source"
        title="Sync data now"
        disabled={refreshing}
        onclick={onRefresh}
      >
        &#8635;
      </button>
    </div>

    <div class="profile-wrap">
      <button
        type="button"
        class="profile"
        id="userBtn"
        aria-haspopup="true"
        aria-expanded={userMenuOpen}
        onclick={toggleUserMenu}
      >
        <span class="avatar" id="userInitials">{initials(user.full_name)}</span>
        <span>
          <b id="userName">{user.full_name}</b>
          <small id="userRole">{user.role === 'admin' ? 'Admin' : 'Normal user'}</small>
        </span>
        <span class="chevron" aria-hidden="true">&#8964;</span>
      </button>

      {#if userMenuOpen}
        <div class="user-menu sidebar-user-menu" id="userMenu">
          <div class="user-menu-id" id="userMenuId">Signed in as {user.member_id}</div>
          <button
            class="menu-item"
            id="logoutBtn"
            type="button"
            onclick={() => {
              userMenuOpen = false;
              onLogout();
            }}
          >
            Log out
          </button>
        </div>
      {/if}
    </div>
  </div>
</aside>

<div class="main-area">
  <header class="topbar">
    <div class="breadcrumbs">
      <span>Workspace</span>
      <span class="crumb-slash">/</span>
      <b id="breadcrumb-current">{breadcrumbTitle}</b>
    </div>

    <div class="top-actions">
      <span class="sync-status">
        <i></i>
        {refreshing ? 'Refreshing...' : 'All changes saved'}
      </span>

      <button
        class="icon-button theme-button"
        id="themeToggle"
        type="button"
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-pressed={theme === 'dark'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onclick={() => onSetTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <div class="menu-wrap">
        <button
          class="icon-button notification-button"
          id="bellBtn"
          type="button"
          aria-label={`Notifications${alerts.length ? `, ${alerts.length} active` : ', none'}`
          }
          aria-haspopup="true"
          aria-expanded={notifOpen}
          onclick={toggleNotif}
        >
          &#9831;
          {#if hasUnread && !notifOpen}
            <i class="notice-dot" id="bellDot"></i>
          {/if}
        </button>

        {#if notifOpen}
          <div class="popover notif-panel" id="notifPanel">
            <div class="popover-head">
              <strong>Notifications</strong>
              <span id="notifCount" class="pill">{alerts.length} active</span>
            </div>
            <ul id="notifList" class="notif-list">
              {#if !alerts.length}
                <li class="notif-empty">
                  All clear. We'll let you know when an event is coming up or a budget needs attention.
                </li>
              {:else}
                {#each alerts as a (a.id)}
                  <li class="notif-item" class:clickable={Boolean(a.event_id)}>
                    <span class={`sev ${a.severity}`} aria-hidden="true">{ICON[a.severity]}</span>
                    <div>
                      {#if a.event_id && onOpenProject}
                        <button
                          type="button"
                          class="cal-detail-link"
                          onclick={() => {
                            notifOpen = false;
                            onOpenProject(a.event_id!);
                          }}
                        >
                          <strong>{a.title}</strong>
                        </button>
                      {:else}
                        <strong>{a.title}</strong>
                      {/if}
                      <span class="nmsg">{a.message}</span>
                    </div>
                  </li>
                {/each}
              {/if}
            </ul>
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="avatar top-avatar"
        aria-label="Toggle user menu"
        onclick={toggleUserMenu}
      >
        {initials(user.full_name)}
      </button>
    </div>
  </header>

  <main class="content-wrap">
    {@render children?.()}
  </main>
</div>
