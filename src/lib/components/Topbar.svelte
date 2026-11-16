<script lang="ts">
  import { initials } from '$lib/format';
  import type { AlertItem, SessionUser, ThemeMode } from '$lib/types';

  export type PageId = 'summary' | 'projects' | 'users';

  let {
    user,
    activePage,
    theme,
    alerts,
    hasUnread,
    notifOpen = $bindable(false),
    onSelectPage,
    onSetTheme,
    onMarkSeen,
    onLogout
  }: {
    user: SessionUser;
    activePage: PageId;
    theme: ThemeMode;
    alerts: AlertItem[];
    hasUnread: boolean;
    notifOpen?: boolean;
    onSelectPage: (page: PageId) => void;
    onSetTheme: (theme: ThemeMode) => void;
    onMarkSeen: () => void;
    onLogout: () => void;
  } = $props();

  let userMenuOpen = $state(false);
  const ICON: Record<AlertItem['severity'], string> = { critical: '!', warning: '!', info: 'i' };

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
    if (!target?.closest('.menu-wrap')) {
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

<header class="topbar">
  <div class="brand">
    <img class="brand-logo" src="/image/academic-ac-logo.png" alt="" />
    <span class="brand-name">ACADEMIC AC</span>
  </div>

  <nav class="tabs" aria-label="Pages">
    <button
      class="tab"
      class:active={activePage === 'summary'}
      type="button"
      onclick={() => onSelectPage('summary')}
    >
      Summary
    </button>
    <button
      class="tab"
      class:active={activePage === 'projects'}
      type="button"
      onclick={() => onSelectPage('projects')}
    >
      Project data
    </button>
    {#if user.role === 'admin'}
      <button
        class="tab"
        class:active={activePage === 'users'}
        id="usersTab"
        type="button"
        onclick={() => onSelectPage('users')}
      >
        Users
      </button>
    {/if}
  </nav>

  <div class="top-actions">
    <div class="theme-toggle" role="group" aria-label="Theme">
      <button
        class="action-button"
        id="themeLight"
        type="button"
        aria-label="Light mode"
        aria-pressed={theme === 'light'}
        onclick={() => onSetTheme('light')}
      >
        &#9788;
      </button>
      <button
        class="action-button"
        id="themeDark"
        type="button"
        aria-label="Dark mode"
        aria-pressed={theme === 'dark'}
        onclick={() => onSetTheme('dark')}
      >
        &#9790;
      </button>
    </div>

    <div class="menu-wrap">
      <button
        class="action-button notification-button"
        id="bellBtn"
        type="button"
        aria-label={`Notifications${alerts.length ? `, ${alerts.length} active` : ', none'}`}
        aria-haspopup="true"
        aria-expanded={notifOpen}
        onclick={toggleNotif}
      >
        <img class="notification-bell" src="/image/notification-bell.png" alt="" />
        {#if hasUnread && !notifOpen}
          <span class="notification-dot" id="bellDot"></span>
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
              <li class="notif-empty">All clear. Nothing needs attention.</li>
            {:else}
              {#each alerts as a (a.id)}
                <li class="notif-item">
                  <span class={`sev ${a.severity}`} aria-hidden="true">{ICON[a.severity]}</span>
                  <div>
                    <strong>{a.title}</strong>
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
        class="user-card"
        id="userBtn"
        type="button"
        aria-haspopup="true"
        aria-expanded={userMenuOpen}
        onclick={toggleUserMenu}
      >
        <span class="user-initials" id="userInitials">{initials(user.full_name)}</span>
        <span class="user-info">
          <strong id="userName">{user.full_name}</strong>
          <small id="userRole">{user.role === 'admin' ? 'Admin' : 'Normal user'}</small>
        </span>
        <span class="user-chevron" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </button>
      {#if userMenuOpen}
        <div class="popover user-menu" id="userMenu">
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
</header>
