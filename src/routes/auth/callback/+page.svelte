<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '$lib/format';
  import type { SessionUser } from '$lib/types';

  interface OAuthExchangeResponse {
    user: SessionUser;
    hasDriveAccess: boolean;
    googleEmail: string;
  }

  let statusMessage = $state('Completing Google sign-in...');
  let error = $state('');

  function surfaceFailure(msg: string, intent: string) {
    error = msg;
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        { type: 'supabase-google-oauth', ok: false, error: msg, intent },
        window.location.origin
      );
      return;
    }
    const param = intent === 'login' ? 'authError' : 'oauthError';
    window.location.replace(`/?${param}=${encodeURIComponent(msg)}`);
  }

  onMount(async () => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);

    const accessToken =
      hashParams.get('access_token') || searchParams.get('access_token') || '';
    const providerToken =
      hashParams.get('provider_token') || searchParams.get('provider_token') || '';
    const providerRefreshToken =
      hashParams.get('provider_refresh_token') ||
      searchParams.get('provider_refresh_token') ||
      '';
    const oauthError =
      hashParams.get('error_description') ||
      hashParams.get('error') ||
      searchParams.get('error_description') ||
      searchParams.get('error') ||
      '';
    const intent =
      searchParams.get('intent') ||
      hashParams.get('intent') ||
      sessionStorage.getItem('oauth_intent') ||
      'login';

    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    if (oauthError) {
      sessionStorage.removeItem('oauth_intent');
      surfaceFailure(oauthError, intent);
      return;
    }

    if (!accessToken) {
      sessionStorage.removeItem('oauth_intent');
      surfaceFailure('No OAuth access token was returned in the callback URL.', intent);
      return;
    }

    try {
      const res = await apiFetch<OAuthExchangeResponse>('POST', '/api/auth/google', {
        access_token: accessToken,
        provider_token: providerToken || undefined,
        provider_refresh_token: providerRefreshToken || undefined,
        intent
      });
      sessionStorage.removeItem('oauth_intent');

      if (window.opener && window.opener !== window) {
        window.opener.postMessage(
          {
            type: 'supabase-google-oauth',
            ok: true,
            intent,
            user: res.user,
            hasDriveAccess: res.hasDriveAccess,
            googleEmail: res.googleEmail
          },
          window.location.origin
        );
        statusMessage = 'Connected! Closing window...';
        window.close();
        return;
      }

      if (intent === 'drive' && res.user.role === 'admin') {
        window.location.replace('/?openSheetPicker=1');
      } else if (intent === 'link') {
        window.location.replace('/?googleLinked=1');
      } else {
        window.location.replace('/');
      }
    } catch (e) {
      sessionStorage.removeItem('oauth_intent');
      const msg = (e as Error).message || 'Could not complete Google authentication.';
      surfaceFailure(msg, intent);
    }
  });
</script>

<main class="auth-view">
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

    <h1>Google Authentication</h1>

    {#if error}
      <p class="form-error" role="alert">{error}</p>
      <div style="margin-top: 18px">
        <a class="btn primary block" href="/">Back to Club Dashboard</a>
      </div>
    {:else}
      <p class="auth-sub">{statusMessage}</p>
    {/if}
  </div>
</main>
