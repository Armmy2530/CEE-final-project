<script lang="ts">
  import { apiFetch } from '$lib/format';
  import { validatePassword } from '$lib/validation';
  import type { SessionUser } from '$lib/types';

  type AuthMode = 'login' | 'register';

  interface SetupLookup {
    found: boolean;
    alreadySetup: boolean;
    full_name?: string;
    subtitle?: string;
  }

  let {
    onSuccess,
    externalError = ''
  }: {
    onSuccess: (user: SessionUser) => void;
    externalError?: string;
  } = $props();

  let mode = $state<AuthMode>('login');
  let memberId = $state('');
  let fullName = $state('');
  let password = $state('');
  let confirm = $state('');
  let showPw = $state(false);
  let showConfirmPw = $state(false);
  let error = $state('');
  let busy = $state(false);
  let lookup = $state<SetupLookup | null>(null);
  let lookupId = $state('');
  let lookupSeq = 0;

  $effect(() => {
    if (externalError) {
      error = externalError;
    }
  });

  $effect(() => {
    const id = memberId.trim();
    if (mode !== 'register' || id.length < 2) {
      lookup = null;
      lookupId = '';
      return;
    }
    const seq = ++lookupSeq;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<SetupLookup>(
          'GET',
          `/api/auth/setup?member_id=${encodeURIComponent(id)}`
        );
        if (seq === lookupSeq) {
          lookup = res;
          lookupId = id;
        }
      } catch {
        if (seq === lookupSeq) {
          lookup = null;
          lookupId = '';
        }
      }
    }, 180);
    return () => clearTimeout(timer);
  });

  const activeLookup = $derived(lookup && lookupId === memberId.trim() ? lookup : null);
  const foundPendingSetup = $derived(Boolean(activeLookup?.found && !activeLookup.alreadySetup));
  const alreadyHasAccount = $derived(Boolean(activeLookup?.alreadySetup));

  const hasMinLen = $derived(password.length >= 8);
  const hasNumber = $derived(/\d/.test(password));
  const hasUpper = $derived(/[A-Z]/.test(password));
  const strengthScore = $derived.by(() => {
    if (!password) return 0;
    let s = 0;
    if (hasMinLen) s++;
    if (hasNumber) s++;
    if (hasUpper) s++;
    if (password.length >= 12 || /[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(4, Math.max(1, s));
  });

  const heroHeading = $derived(
    mode === 'login' ? 'Everything your club does, in one place.' : 'Join the Academic AC hub.'
  );

  const heroCopy = $derived(
    mode === 'login'
      ? 'Track activities, budgets and members for the Engineering Academic Club.'
      : foundPendingSetup
        ? 'Your student ID is already on the member list. Create a password once and you are ready to go.'
        : 'Sign up with your student ID to follow upcoming activities, attendance records, and budgets.'
  );

  const title = $derived(mode === 'login' ? 'Welcome back' : 'Sign up');
  const subtitle = $derived(
    mode === 'login'
      ? 'Sign in with your student ID to continue.'
      : foundPendingSetup
        ? 'We found your profile in the database. Choose a password to activate your account.'
        : 'Enter your 10-digit student ID. Existing club members only need to create a password.'
  );
  const pwLabel = $derived(mode === 'login' ? 'Password' : 'New password');
  const submitLabel = $derived(
    mode === 'login'
      ? 'Sign in'
      : foundPendingSetup
        ? 'Create password & sign in'
        : 'Sign up & sign in'
  );

  function setMode(m: AuthMode) {
    mode = m;
    error = '';
    password = '';
    confirm = '';
    showPw = false;
    showConfirmPw = false;
    if (m === 'login') {
      lookup = null;
      lookupId = '';
    }
  }

  async function handleSubmit(ev: SubmitEvent) {
    ev.preventDefault();
    error = '';
    const id = memberId.trim();
    const name = fullName.trim();

    if (!id || !password) {
      error = 'Please enter your student ID and password.';
      return;
    }

    let currentLookup = activeLookup;
    if (mode === 'register' && !currentLookup && id.length >= 2) {
      try {
        currentLookup = await apiFetch<SetupLookup>(
          'GET',
          `/api/auth/setup?member_id=${encodeURIComponent(id)}`
        );
        lookup = currentLookup;
        lookupId = id;
      } catch {
        currentLookup = null;
      }
    }

    if (mode === 'register') {
      if (currentLookup?.alreadySetup) {
        error = 'This student ID already has a password. Please sign in instead.';
        return;
      }
      if (!currentLookup?.found && !name) {
        error = 'Please enter your full name.';
        return;
      }
      const pwErr = validatePassword(password);
      if (pwErr) {
        error = pwErr;
        return;
      }
      if (password !== confirm) {
        error = 'Passwords do not match.';
        return;
      }
    }

    busy = true;
    try {
      const isSetup = mode === 'register' && Boolean(currentLookup?.found && !currentLookup.alreadySetup);
      const endpoint =
        mode === 'login' ? '/api/auth/login' : isSetup ? '/api/auth/setup' : '/api/auth/register';
      const payload =
        mode === 'register' && !isSetup
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

<main id="authView" class="auth-split">
  <section class="auth-hero-panel" aria-label="Engineering Academic Club overview">
    <div class="auth-hero-brand">
      <span class="ac-brand-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M2 9.5 12 5l10 4.5-10 4.5L2 9.5Z" />
          <path d="M6 11.5v4.3c0 1.4 2.7 2.7 6 2.7s6-1.3 6-2.7v-4.3" />
          <path d="M20.5 10.2v5.3" stroke-linecap="round" />
        </svg>
      </span>
      <span class="ac-brand-copy">
        <strong>ACADEMIC AC</strong>
        <small>Engineering Academic Club</small>
      </span>
    </div>

    <div class="auth-hero-center">
      <h1>{heroHeading}</h1>
      <p>{heroCopy}</p>
    </div>

    <div class="auth-stats-row">
      <div class="auth-mini-stat">
        <span class="auth-stat-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M5 21V4" stroke-linecap="round" />
            <path d="M5 4h11l-1.5 4L16 12H5" stroke-linejoin="round" />
          </svg>
        </span>
        <div>
          <strong>20</strong>
          <small>activities</small>
        </div>
      </div>

      <div class="auth-mini-stat">
        <span class="auth-stat-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="3.5" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a3.5 3.5 0 0 1 0 6.74" />
          </svg>
        </span>
        <div>
          <strong>67</strong>
          <small>members</small>
        </div>
      </div>
    </div>
  </section>

  <section class="auth-form-panel">
    <div class="auth-form-box">
      {#if mode !== 'login'}
        <button
          type="button"
          id="modeLogin"
          class="auth-back-link"
          onclick={() => setMode('login')}
        >
          <span aria-hidden="true">&larr;</span> Back to sign in
        </button>
      {/if}

      <h2 id="authTitle" class="auth-form-title">{title}</h2>
      <p class="auth-form-sub">{subtitle}</p>

      <form id="authForm" novalidate onsubmit={handleSubmit}>
        <label class="auth-label" for="authId">Student ID</label>
        <input
          id="authId"
          class="auth-input"
          name="member_id"
          autocomplete="username"
          autocapitalize="characters"
          placeholder="e.g. 6600000001"
          bind:value={memberId}
          required
        />

        {#if mode === 'register' && foundPendingSetup}
          <div class="account-found-card" role="status">
            <span class="account-found-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.2 2.3 2.3 4.7-4.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <div>
              <strong>Found in database</strong>
              <small>
                {activeLookup?.full_name}{activeLookup?.subtitle ? ` · ${activeLookup.subtitle}` : ''}
              </small>
            </div>
          </div>
        {:else if mode === 'register' && alreadyHasAccount}
          <p class="auth-inline-note">
            This student ID already has a password.
            <button type="button" class="auth-inline-link" onclick={() => setMode('login')}>
              Sign in instead
            </button>
          </p>
        {:else if mode === 'register'}
          <label class="auth-label" for="authName">Full name</label>
          <input
            id="authName"
            class="auth-input"
            name="full_name"
            autocomplete="name"
            placeholder="Your full name"
            bind:value={fullName}
            required
          />
        {/if}

        <label class="auth-label" for="authPw" id="authPwLabel">{pwLabel}</label>
        <div class="pw-field">
          <input
            id="authPw"
            class="auth-input"
            name="password"
            type={showPw ? 'text' : 'password'}
            placeholder="••••••••"
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
            bind:value={password}
            required
          />
          <button
            type="button"
            class="pw-eye-btn"
            aria-label={showPw ? 'Hide password' : 'Show password'}
            onclick={() => (showPw = !showPw)}
          >
            {#if showPw}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 3l18 18" stroke-linecap="round" />
                <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c5.5 0 9.5 4.2 10.5 8-.4 1.5-1.3 3.1-2.6 4.4M6.6 6.6C4.4 8 3 10.1 1.5 12c1 3.8 5 8 10.5 8 1.8 0 3.5-.5 5-1.3" stroke-linecap="round" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M1.5 12S5.5 4 12 4s10.5 8 10.5 8-4 8-10.5 8S1.5 12 1.5 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            {/if}
          </button>
        </div>

        {#if mode !== 'login'}
          <div id="confirmRow">
            <label class="auth-label" for="authPw2">Confirm password</label>
            <div class="pw-field">
              <input
                id="authPw2"
                class="auth-input"
                name="confirm"
                type={showConfirmPw ? 'text' : 'password'}
                placeholder="••••••••"
                autocomplete="new-password"
                bind:value={confirm}
              />
              <button
                type="button"
                class="pw-eye-btn"
                aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
                onclick={() => (showConfirmPw = !showConfirmPw)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M1.5 12S5.5 4 12 4s10.5 8 10.5 8-4 8-10.5 8S1.5 12 1.5 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>

          <div class="pw-strength-block" aria-live="polite">
            <div class="pw-strength-bars" aria-hidden="true">
              {#each [1, 2, 3, 4] as idx}
                <span class:active={strengthScore >= idx} class:strong={strengthScore >= 3 && strengthScore >= idx}></span>
              {/each}
            </div>
            <ul class="pw-checklist">
              <li class:met={hasMinLen}>
                <span class="pw-check-dot" aria-hidden="true">{hasMinLen ? '✓' : ''}</span>
                At least 8 characters
              </li>
              <li class:met={hasNumber}>
                <span class="pw-check-dot" aria-hidden="true">{hasNumber ? '✓' : ''}</span>
                Contains a number
              </li>
              <li class:met={hasUpper}>
                <span class="pw-check-dot" aria-hidden="true">{hasUpper ? '✓' : ''}</span>
                Contains an uppercase letter
              </li>
            </ul>
          </div>
        {/if}

        {#if error}
          <p id="authError" class="form-error" role="alert">{error}</p>
        {/if}

        <button
          id="authSubmit"
          class="auth-submit-btn"
          type="submit"
          disabled={busy || (mode === 'register' && alreadyHasAccount)}
        >
          {submitLabel}
        </button>
      </form>

      {#if mode === 'login'}
        <p class="auth-switch-row">
          New here or first time setting a password?
          <button
            type="button"
            id="modeRegister"
            class="auth-inline-link"
            onclick={() => setMode('register')}
          >
            Sign up
          </button>
        </p>

        <div class="auth-alt-actions">
          <button
            id="googleAuthBtn"
            type="button"
            class="auth-ghost-btn google-text-btn"
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
            Google sign-in
          </button>
        </div>
      {/if}
    </div>
  </section>
</main>
