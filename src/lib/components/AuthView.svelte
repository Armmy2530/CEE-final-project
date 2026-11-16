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
</script>

<main id="authView" class="auth-view">
  <div class="auth-card">
    <div class="brand auth-brand">
      <img class="brand-logo" src="/image/academic-ac-logo.png" alt="" />
      <span class="brand-name">ACADEMIC AC</span>
    </div>
    <h1 id="authTitle">{title}</h1>
    <p class="auth-sub">Club Activity Dashboard</p>

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

    <p class="hint demo-hint">
      Demo data only. In the normalized mock dataset, <strong>MOCK-66-0001</strong> is the Admin and
      <strong>MOCK-66-0002&ndash;MOCK-66-0067</strong> are Members (use <em>First time? Set password</em>).
      Or create a brand-new account via <em>Sign up</em>.
    </p>
  </div>
</main>
