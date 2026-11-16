<script lang="ts">
  import { apiFetch } from '$lib/format';
  import type { SessionUser } from '$lib/types';

  type AuthMode = 'login' | 'setup' | 'register';

  let { onSuccess }: { onSuccess: (user: SessionUser) => void } = $props();

  let mode = $state<AuthMode>('login');
  let memberId = $state('');
  let fullName = $state('');
  let password = $state('');
  let confirm = $state('');
  let error = $state('');
  let busy = $state(false);

  const title = $derived(
    mode === 'login' ? 'Sign in' : mode === 'setup' ? 'Create your password' : 'Create account'
  );
  const pwLabel = $derived(mode === 'login' ? 'Password' : 'New password');
  const submitLabel = $derived(
    mode === 'login'
      ? 'Sign in'
      : mode === 'setup'
        ? 'Create password & sign in'
        : 'Sign up & sign in'
  );

  function setMode(m: AuthMode) {
    mode = m;
    error = '';
  }

  async function handleSubmit(ev: SubmitEvent) {
    ev.preventDefault();
    error = '';
    const id = memberId.trim();
    const name = fullName.trim();

    if (!id || !password) {
      error = 'Please enter your ID and password.';
      return;
    }
    if (mode === 'register' && !name) {
      error = 'Please enter your full name.';
      return;
    }
    if (mode !== 'login') {
      if (password.length < 8) {
        error = 'Password must be at least 8 characters.';
        return;
      }
      if (password !== confirm) {
        error = 'Passwords do not match.';
        return;
      }
    }

    busy = true;
    try {
      const endpoint =
        mode === 'login'
          ? '/api/auth/login'
          : mode === 'setup'
            ? '/api/auth/setup'
            : '/api/auth/register';
      const payload =
        mode === 'register'
          ? { member_id: id, full_name: name, password }
          : { member_id: id, password };
      const res = await apiFetch<{ user: SessionUser }>('POST', endpoint, payload);
      password = '';
      confirm = '';
      onSuccess(res.user);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function handleGoogleSignIn() {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem('oauth_intent', 'login');
    window.location.href = '/api/auth/google?intent=login';
  }
</script>

<main id="authView" class="auth-view">
  <div class="auth-card">
    <div class="auth-brand">
      <span class="brand-mark">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="M4 14.2 20 7l16 7.2-16 7.1L4 14.2Z" />
          <path d="M10 18v7.4c5.9 4.3 14.1 4.3 20 0V18l-10 4.5L10 18Z" />
          <path d="M35.8 15v9.2" />
          <circle cx="35.8" cy="27" r="1.7" />
        </svg>
      </span>
      <span class="brand-word">clubhouse<span>.</span></span>
    </div>
    <h1 id="authTitle">{title}</h1>
    <p class="auth-sub">Club Activity Dashboard &middot; Academic AC Workspace</p>

    <div class="seg" role="tablist" aria-label="Account">
      <button
        type="button"
        role="tab"
        id="modeLogin"
        aria-selected={mode === 'login'}
        onclick={() => setMode('login')}
      >
        Sign in
      </button>
      <button
        type="button"
        role="tab"
        id="modeSetup"
        aria-selected={mode === 'setup'}
        onclick={() => setMode('setup')}
      >
        First time? Set password
      </button>
      <button
        type="button"
        role="tab"
        id="modeRegister"
        aria-selected={mode === 'register'}
        onclick={() => setMode('register')}
      >
        Sign up
      </button>
    </div>

    <form id="authForm" novalidate onsubmit={handleSubmit}>
      <label for="authId">Member ID</label>
      <input
        id="authId"
        name="member_id"
        autocomplete="username"
        autocapitalize="characters"
        placeholder="e.g. MOCK-66-0001"
        bind:value={memberId}
        required
      />

      {#if mode === 'register'}
        <label for="authName">Full name</label>
        <input
          id="authName"
          name="full_name"
          autocomplete="name"
          placeholder="Your full name"
          bind:value={fullName}
          required
        />
      {/if}

      <label for="authPw" id="authPwLabel">{pwLabel}</label>
      <input
        id="authPw"
        name="password"
        type="password"
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        bind:value={password}
        required
      />

      {#if mode !== 'login'}
        <div id="confirmRow">
          <label for="authPw2">Confirm password</label>
          <input
            id="authPw2"
            name="confirm"
            type="password"
            autocomplete="new-password"
            bind:value={confirm}
          />
          <p class="hint">At least 8 characters.</p>
        </div>
      {/if}

      {#if error}
        <p id="authError" class="form-error" role="alert">{error}</p>
      {/if}

      <button id="authSubmit" class="btn primary block" type="submit" disabled={busy}>
        {submitLabel}
      </button>
    </form>

    <div class="auth-divider" aria-hidden="true"><span>or</span></div>

    <button
      id="googleAuthBtn"
      type="button"
      class="btn block google-oauth-btn"
      disabled={busy}
      onclick={handleGoogleSignIn}
    >
      <svg class="google-g-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
        />
      </svg>
      Continue with Google
    </button>

    <p class="hint demo-hint">
      Demo data only. In the normalized mock dataset, <strong>MOCK-66-0001</strong> is the Admin and
      <strong>MOCK-66-0002&ndash;MOCK-66-0067</strong> are Members (use <em>First time? Set password</em>).
      Or create a brand-new account via <em>Sign up</em>.
    </p>
  </div>
</main>
