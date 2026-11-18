<script lang="ts">
  import type { Snippet } from 'svelte';
  import { initials } from '$lib/format';
  import type { AlertItem, SessionUser, ThemeMode } from '$lib/types';

  export type PageId = 'summary' | 'projects' | 'calendar' | 'members' | 'budget' | 'users';

  let {
    user,
    activePage,
    theme,
    alerts,
    hasUnread,
    notifOpen = $bindable(false),
    projectCount = 0,
    memberCount = 0,
    sourceLabel = 'Mock CSV data',
    syncedLabel = 'Synced just now',
    stale = false,
    refreshing = false,
    onSelectPage,
    onOpenProject,
    onSetTheme,
    onMarkSeen,
    onRefresh,
    onOpenSheetPicker,
    onLinkGoogle,
    onUnlinkGoogle,
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
    onLinkGoogle?: () => void;
    onUnlinkGoogle?: () => void;
    onLogout: () => void;
    children?: Snippet;
  } = $props();

  let userMenuOpen = $state(false);
  let summaryMenuOpen = $state(false);
  const ICON: Record<AlertItem['severity'], string> = { critical: '!', warning: '!', info: 'i' };

  const isSummaryGroup = $derived(
    activePage === 'summary' ||
      activePage === 'members' ||
      activePage === 'budget' ||
      activePage === 'calendar'
  );

  function navigate(page: PageId) {
    summaryMenuOpen = false;
    userMenuOpen = false;
    notifOpen = false;
    onSelectPage(page);
  }

  function toggleNotif(e: MouseEvent) {
    e.stopPropagation();
    const next = !notifOpen;
    userMenuOpen = false;
    summaryMenuOpen = false;
    notifOpen = next;
    if (next) onMarkSeen();
  }

  function toggleUserMenu(e: MouseEvent) {
    e.stopPropagation();
    const next = !userMenuOpen;
    notifOpen = false;
    summaryMenuOpen = false;
    userMenuOpen = next;
  }

  function toggleSummaryMenu(e: MouseEvent) {
    e.stopPropagation();
    const next = !summaryMenuOpen;
    notifOpen = false;
    userMenuOpen = false;
    summaryMenuOpen = next;
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.menu-wrap')) {
      notifOpen = false;
      userMenuOpen = false;
      summaryMenuOpen = false;
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      notifOpen = false;
      userMenuOpen = false;
      summaryMenuOpen = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="ac-shell">
  <header class="ac-topbar">
    <div class="ac-topbar-inner">
      <div class="ac-topbar-left">
        <button
          type="button"
          class="ac-top-brand"
          aria-label="Academic AC home"
          onclick={() => navigate('summary')}
        >
          <span class="ac-top-cap" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M2 9.5 12 5l10 4.5-10 4.5L2 9.5Z" />
              <path d="M6 11.5v4.3c0 1.4 2.7 2.7 6 2.7s6-1.3 6-2.7v-4.3" />
              <path d="M20.5 10.2v5.3" stroke-linecap="round" />
            </svg>
          </span>
          <span class="ac-top-word">ACADEMIC AC</span>
        </button>

        <nav class="ac-top-nav" aria-label="Main navigation">
          <div class="menu-wrap ac-more-wrap">
            <button
              type="button"
              class="ac-nav-pill ac-more-btn"
              class:active={isSummaryGroup}
              aria-haspopup="true"
              aria-expanded={summaryMenuOpen}
              onclick={toggleSummaryMenu}
            >
              {#if activePage === 'members'}
                Members
              {:else if activePage === 'budget'}
                Budget
              {:else if activePage === 'calendar'}
                Calendar
              {:else}
                Summary
              {/if}
              <span class="ac-caret" aria-hidden="true">&#8964;</span>
            </button>

            {#if summaryMenuOpen}
              <div class="popover ac-more-menu" role="menu" aria-label="Summary pages">
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item ac-more-item"
                  class:current={activePage === 'summary'}
                  onclick={() => navigate('summary')}
                >
                  <span>Summary</span>
                </button>
                <div class="ac-menu-divider"></div>
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item ac-more-item"
                  class:current={activePage === 'members'}
                  onclick={() => navigate('members')}
                >
                  <span>Members</span>
                  <span class="pill">{memberCount}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item ac-more-item"
                  class:current={activePage === 'budget'}
                  onclick={() => navigate('budget')}
                >
                  <span>Budget</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item ac-more-item"
                  class:current={activePage === 'calendar'}
                  onclick={() => navigate('calendar')}
                >
                  <span>Events calendar</span>
                  <span class="pill">{projectCount}</span>
                </button>
              </div>
            {/if}
          </div>

          <button
            type="button"
            class="ac-nav-pill"
            class:active={activePage === 'projects'}
            onclick={() => navigate('projects')}
          >
            Project data
          </button>
        </nav>
      </div>

      <div class="ac-top-actions">
        <button
          type="button"
          id="themeToggle"
          class="ac-theme-btn"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'dark'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onclick={() => onSetTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {#if theme === 'dark'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke-linecap="round" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke-linejoin="round" />
            </svg>
          {/if}
        </button>

        <div class="menu-wrap">
          <button
            class="ac-bell-btn"
            id="bellBtn"
            type="button"
            aria-label={`Notifications${alerts.length ? `, ${alerts.length} active` : ', none'}`}
            aria-haspopup="true"
            aria-expanded={notifOpen}
            onclick={toggleNotif}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke-linejoin="round" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke-linecap="round" />
            </svg>
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

        <div class="menu-wrap">
          <button
            type="button"
            class="ac-user-pill"
            id="userBtn"
            aria-haspopup="true"
            aria-expanded={userMenuOpen}
            onclick={toggleUserMenu}
          >
            <span class="ac-user-avatar" id="userInitials">{initials(user.full_name)}</span>
            <span class="ac-user-meta">
              <b id="userName">{user.full_name}</b>
              <small id="userRole">{user.role === 'admin' ? 'Admin' : 'Member'}</small>
            </span>
            <span class="ac-user-caret" aria-hidden="true">&#8964;</span>
          </button>

          {#if userMenuOpen}
            <div class="popover user-menu top-user-menu" id="userMenu" role="menu">
              <div class="user-menu-id" id="userMenuId">
                <strong>{user.full_name}</strong> &middot; {user.member_id}
              </div>
              <div class="user-menu-source">
                <span class="source-dot" class:stale></span>
                <span>{sourceLabel} &middot; {syncedLabel}</span>
              </div>
              {#if user.role === 'admin'}
                <button
                  class="menu-item"
                  type="button"
                  role="menuitem"
                  disabled={refreshing}
                  onclick={() => {
                    userMenuOpen = false;
                    onRefresh();
                  }}
                >
                  {refreshing ? 'Syncing data...' : 'Sync data now'}
                </button>
                <button
                  type="button"
                  id="usersTab"
                  role="menuitem"
                  class="menu-item ac-more-item"
                  class:current={activePage === 'users'}
                  onclick={() => navigate('users')}
                >
                  <span>Users</span>
                </button>
                {#if onOpenSheetPicker}
                  <button
                    type="button"
                    id="openSheetPickerBtn"
                    role="menuitem"
                    class="menu-item ac-more-item"
                    onclick={() => {
                      userMenuOpen = false;
                      onOpenSheetPicker?.();
                    }}
                  >
                    <span>Data source</span>
                  </button>
                {/if}
                <div class="ac-menu-divider"></div>
                {#if user.linkedGoogleEmail}
                  <div class="user-menu-google" id="linkedGoogleStatus">
                    Google linked: <strong>{user.linkedGoogleEmail}</strong>
                  </div>
                  <button
                    class="menu-item"
                    id="unlinkGoogleBtn"
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      userMenuOpen = false;
                      onUnlinkGoogle?.();
                    }}
                  >
                    Unlink Google
                  </button>
                {:else}
                  <button
                    class="menu-item"
                    id="linkGoogleBtn"
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      userMenuOpen = false;
                      onLinkGoogle?.();
                    }}
                  >
                    Link Google account
                  </button>
                {/if}
                <div class="ac-menu-divider"></div>
              {/if}
              <button
                class="menu-item"
                id="logoutBtn"
                type="button"
                role="menuitem"
                onclick={() => {
                  userMenuOpen = false;
                  onLogout();
                }}
              >
                Sign out
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </header>

  <main class="ac-main-wrap">
    {@render children?.()}
  </main>

  <nav class="mobile-bottom-nav" aria-label="Quick navigation">
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'summary'}
      onclick={() => navigate('summary')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      </span>
      <span>Summary</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'projects'}
      onclick={() => navigate('projects')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
      </span>
      <span>Projects</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'calendar'}
      onclick={() => navigate('calendar')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      </span>
      <span>Calendar</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'members'}
      onclick={() => navigate('members')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3.5" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a3.5 3.5 0 0 1 0 6.74" />
        </svg>
      </span>
      <span>Members</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'budget'}
      onclick={() => navigate('budget')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <path d="M16 14h2" />
        </svg>
      </span>
      <span>Budget</span>
    </button>
  </nav>
</div>
