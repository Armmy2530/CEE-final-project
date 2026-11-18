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
  let moreMenuOpen = $state(false);
  const ICON: Record<AlertItem['severity'], string> = { critical: '!', warning: '!', info: 'i' };

  const isMorePage = $derived(
    activePage === 'calendar' ||
      activePage === 'members' ||
      activePage === 'budget' ||
      activePage === 'users'
  );

  function navigate(page: PageId) {
    moreMenuOpen = false;
    userMenuOpen = false;
    notifOpen = false;
    onSelectPage(page);
  }

  function toggleNotif(e: MouseEvent) {
    e.stopPropagation();
    const next = !notifOpen;
    userMenuOpen = false;
    moreMenuOpen = false;
    notifOpen = next;
    if (next) onMarkSeen();
  }

  function toggleUserMenu(e: MouseEvent) {
    e.stopPropagation();
    const next = !userMenuOpen;
    notifOpen = false;
    moreMenuOpen = false;
    userMenuOpen = next;
  }

  function toggleMoreMenu(e: MouseEvent) {
    e.stopPropagation();
    const next = !moreMenuOpen;
    notifOpen = false;
    userMenuOpen = false;
    moreMenuOpen = next;
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.menu-wrap')) {
      notifOpen = false;
      userMenuOpen = false;
      moreMenuOpen = false;
    }
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      notifOpen = false;
      userMenuOpen = false;
      moreMenuOpen = false;
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
          <button
            type="button"
            class="ac-nav-pill"
            class:active={activePage === 'summary'}
            onclick={() => navigate('summary')}
          >
            Summary
          </button>
          <button
            type="button"
            class="ac-nav-pill"
            class:active={activePage === 'projects'}
            onclick={() => navigate('projects')}
          >
            Project data
          </button>

          <div class="menu-wrap ac-more-wrap">
            <button
              type="button"
              class="ac-nav-pill ac-more-btn"
              class:active={isMorePage}
              aria-haspopup="true"
              aria-expanded={moreMenuOpen}
              onclick={toggleMoreMenu}
            >
              {#if activePage === 'members'}
                Members
              {:else if activePage === 'budget'}
                Budget
              {:else if activePage === 'calendar'}
                Calendar
              {:else if activePage === 'users'}
                Users
              {:else}
                More
              {/if}
              <span class="ac-caret" aria-hidden="true">&#8964;</span>
            </button>

            {#if moreMenuOpen}
              <div class="popover ac-more-menu" role="menu">
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
                {#if user.role === 'admin'}
                  <div class="ac-menu-divider"></div>
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
                        moreMenuOpen = false;
                        onOpenSheetPicker?.();
                      }}
                    >
                      <span>Data source</span>
                    </button>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        </nav>
      </div>

      <div class="ac-top-actions">
        <div class="ac-theme-switch" role="group" aria-label="Color theme">
          <button
            type="button"
            id={theme === 'dark' ? 'themeToggle' : undefined}
            class="ac-theme-icon"
            class:active={theme === 'light'}
            aria-label="Switch to light mode"
            aria-pressed={theme === 'light'}
            title="Light mode"
            onclick={() => onSetTheme('light')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke-linecap="round" />
            </svg>
          </button>
          <button
            type="button"
            id={theme === 'light' ? 'themeToggle' : undefined}
            class="ac-theme-icon"
            class:active={theme === 'dark'}
            aria-label="Switch to dark mode"
            aria-pressed={theme === 'dark'}
            title="Dark mode"
            onclick={() => onSetTheme('dark')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

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
            <div class="popover user-menu top-user-menu" id="userMenu">
              <div class="user-menu-id" id="userMenuId">
                <strong>{user.full_name}</strong> &middot; {user.member_id}
              </div>
              <div class="user-menu-source">
                <span class="source-dot" class:stale></span>
                <span>{sourceLabel} &middot; {syncedLabel}</span>
              </div>
              <button
                class="menu-item"
                type="button"
                disabled={refreshing}
                onclick={() => {
                  userMenuOpen = false;
                  onRefresh();
                }}
              >
                {refreshing ? 'Syncing data...' : 'Sync data now'}
              </button>
              {#if user.role === 'admin' && onOpenSheetPicker}
                <button
                  class="menu-item"
                  type="button"
                  onclick={() => {
                    userMenuOpen = false;
                    onOpenSheetPicker?.();
                  }}
                >
                  Google Sheet source
                </button>
              {/if}
              {#if user.linkedGoogleEmail}
                <div class="user-menu-google" id="linkedGoogleStatus">
                  Google linked: <strong>{user.linkedGoogleEmail}</strong>
                </div>
                <button
                  class="menu-item"
                  id="unlinkGoogleBtn"
                  type="button"
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
                  onclick={() => {
                    userMenuOpen = false;
                    onLinkGoogle?.();
                  }}
                >
                  Link Google account
                </button>
              {/if}
              <div class="ac-menu-divider"></div>
              <button
                class="menu-item"
                id="logoutBtn"
                type="button"
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

  <nav class="mobile-bottom-nav" class:has-users={user.role === 'admin'} aria-label="Quick navigation">
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'summary'}
      onclick={() => navigate('summary')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">&#9638;</span>
      <span>Summary</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'projects'}
      onclick={() => navigate('projects')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">&#9636;</span>
      <span>Projects</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'calendar'}
      onclick={() => navigate('calendar')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">&#9635;</span>
      <span>Calendar</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'members'}
      onclick={() => navigate('members')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">&#9817;</span>
      <span>Members</span>
    </button>
    <button
      type="button"
      class="mobile-nav-item"
      class:active={activePage === 'budget'}
      onclick={() => navigate('budget')}
    >
      <span class="mobile-nav-icon" aria-hidden="true">&#9707;</span>
      <span>Budget</span>
    </button>
    {#if user.role === 'admin'}
      <button
        type="button"
        class="mobile-nav-item"
        class:active={activePage === 'users'}
        onclick={() => navigate('users')}
      >
        <span class="mobile-nav-icon" aria-hidden="true">&#9639;</span>
        <span>Users</span>
      </button>
    {/if}
  </nav>
</div>
