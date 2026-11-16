<script lang="ts">
  import { apiFetch } from '$lib/format';
  import type { DbBackend, SupabaseStatus } from '$lib/types';

  interface RecentSheetItem {
    sheetId: string;
    sheetTitle: string;
    connectedAt: number;
  }

  interface DriveFileItem {
    id: string;
    name: string;
    modifiedTime?: string;
    webViewLink?: string;
  }

  interface ConfigResponse {
    mode: 'mock' | 'google';
    sheetId: string;
    sheetTitle: string;
    hasGoogleApiKey: boolean;
    googleClientId: string;
    supabaseOAuthAvailable?: boolean;
    hasDriveToken?: boolean;
    googleEmail?: string;
    supabaseStatus: SupabaseStatus;
    dbBackend: DbBackend;
    recentSheets: RecentSheetItem[];
  }

  interface SwitchResponse {
    ok: boolean;
    config: { mode: 'mock' | 'google'; sheetId: string; sheetTitle?: string };
    recentSheets: RecentSheetItem[];
    summary: { members: number; events: number; attendance: number; budget: number };
  }

  let {
    open,
    onClose,
    onConnected
  }: {
    open: boolean;
    onClose: () => void;
    onConnected: (message: string) => void;
  } = $props();

  let loadingConfig = $state(false);
  let busy = $state(false);
  let driveLoading = $state(false);
  let error = $state('');

  let mode = $state<'mock' | 'google'>('mock');
  let activeSheetId = $state('');
  let activeSheetTitle = $state('');
  let googleClientId = $state('');
  let supabaseOAuthAvailable = $state(false);
  let hasDriveToken = $state(false);
  let hasDriveAccess = $state(false);
  let googleEmail = $state('');
  let supabaseStatus = $state<SupabaseStatus>('disabled');
  let dbBackend = $state<DbBackend>('sqlite');
  let recentSheets = $state<RecentSheetItem[]>([]);

  let sheetUrlOrId = $state('');
  let sheetTitleInput = $state('');
  let driveFiles = $state<DriveFileItem[]>([]);
  let driveSearch = $state('');
  let showTokenPrompt = $state(false);
  let manualAccessToken = $state('');
  let driveNote = $state('');

  const filteredDriveFiles = $derived.by(() => {
    const q = driveSearch.trim().toLowerCase();
    if (!q) return driveFiles;
    return driveFiles.filter((f) => f.name.toLowerCase().includes(q));
  });

  async function loadConfig() {
    loadingConfig = true;
    error = '';
    try {
      const cfg = await apiFetch<ConfigResponse>('GET', '/api/sheets/config');
      mode = cfg.mode;
      activeSheetId = cfg.sheetId;
      activeSheetTitle = cfg.sheetTitle;
      googleClientId = cfg.googleClientId;
      supabaseOAuthAvailable = Boolean(cfg.supabaseOAuthAvailable);
      hasDriveToken = Boolean(cfg.hasDriveToken);
      googleEmail = cfg.googleEmail || '';
      supabaseStatus = cfg.supabaseStatus;
      dbBackend = cfg.dbBackend;
      recentSheets = cfg.recentSheets || [];
      if (cfg.hasDriveToken) {
        await fetchDriveFiles();
      } else {
        hasDriveAccess = false;
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loadingConfig = false;
    }
  }

  $effect(() => {
    if (open) {
      driveNote = '';
      driveSearch = '';
      loadConfig();
    }
  });

  function loadGoogleIdentityScript(): Promise<void> {
    if (typeof window === 'undefined') return Promise.reject(new Error('Browser required'));
    const win = window as unknown as { google?: { accounts?: { oauth2?: unknown } } };
    if (win.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-gis-client="1"]') as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In script')), {
          once: true
        });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.gisClient = '1';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  async function fetchDriveFiles(accessToken?: string) {
    driveLoading = true;
    error = '';
    driveNote = '';
    try {
      const res = await fetch(
        accessToken
          ? `/api/sheets/drive?access_token=${encodeURIComponent(accessToken)}`
          : '/api/sheets/drive'
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Drive error ${res.status}`);
      if (Array.isArray(data.recentSheets)) recentSheets = data.recentSheets;
      if (typeof data.supabaseOAuthAvailable === 'boolean') {
        supabaseOAuthAvailable = data.supabaseOAuthAvailable;
      }
      if (typeof data.googleEmail === 'string' && data.googleEmail) {
        googleEmail = data.googleEmail;
      }
      if (data.hasDriveAccess) {
        hasDriveAccess = true;
        hasDriveToken = true;
        driveFiles = data.files || [];
        showTokenPrompt = false;
        if (!driveFiles.length) {
          driveNote = 'No Google Spreadsheets found in your Google Drive.';
        }
      } else {
        hasDriveAccess = false;
        if (data.tokenExpired) {
          hasDriveToken = false;
          driveFiles = [];
        }
        showTokenPrompt = !supabaseOAuthAvailable && !googleClientId;
        driveNote = data.tokenExpired
          ? 'Your Google Drive session expired. Click Connect Google Drive to authorize again.'
          : supabaseOAuthAvailable || googleClientId
            ? 'Authorize Google Drive access to list your spreadsheets.'
            : 'Configure SUPABASE_URL or PUBLIC_GOOGLE_CLIENT_ID in .env for 1-click Google OAuth, or paste a Drive OAuth token below.';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      driveLoading = false;
    }
  }

  function startSupabaseDriveOAuth() {
    if (typeof window === 'undefined') return;
    error = '';
    sessionStorage.setItem('oauth_intent', 'drive');
    const popup = window.open(
      '/api/auth/google?intent=drive',
      'supabase-google-oauth',
      'width=520,height=640'
    );
    if (!popup) {
      window.location.href = '/api/auth/google?intent=drive';
    }
  }

  async function handleWindowMessage(e: MessageEvent) {
    if (typeof window === 'undefined' || e.origin !== window.location.origin) return;
    const payload = e.data as {
      type?: string;
      ok?: boolean;
      error?: string;
      hasDriveAccess?: boolean;
      googleEmail?: string;
    } | null;
    if (!payload || payload.type !== 'supabase-google-oauth') return;
    if (payload.ok) {
      if (payload.googleEmail) googleEmail = payload.googleEmail;
      await loadConfig();
      if (!hasDriveToken) {
        await fetchDriveFiles();
      }
    } else if (payload.error) {
      error = payload.error;
    }
  }

  async function browseGoogleDrive() {
    error = '';
    if (manualAccessToken.trim()) {
      await fetchDriveFiles(manualAccessToken.trim());
      return;
    }
    if (supabaseOAuthAvailable && !hasDriveAccess) {
      startSupabaseDriveOAuth();
      return;
    }
    if (hasDriveAccess) {
      await fetchDriveFiles();
      return;
    }
    if (googleClientId) {
      driveLoading = true;
      try {
        await loadGoogleIdentityScript();
        const win = window as unknown as {
          google: {
            accounts: {
              oauth2: {
                initTokenClient: (cfg: {
                  client_id: string;
                  scope: string;
                  callback: (resp: { access_token?: string; error?: string }) => void;
                }) => { requestAccessToken: () => void };
              };
            };
          };
        };
        const token = await new Promise<string>((resolve, reject) => {
          const client = win.google.accounts.oauth2.initTokenClient({
            client_id: googleClientId,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            callback: (resp) => {
              if (resp.error || !resp.access_token) {
                reject(new Error(resp.error || 'Google Drive authorization cancelled'));
              } else {
                resolve(resp.access_token);
              }
            }
          });
          client.requestAccessToken();
        });
        await fetchDriveFiles(token);
      } catch (e) {
        error = (e as Error).message;
        driveLoading = false;
      }
      return;
    }
    await fetchDriveFiles();
  }

  async function connectGoogleSheet(targetUrlOrId: string, title?: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const res = await apiFetch<SwitchResponse>('POST', '/api/sheets/config', {
        mode: 'google',
        sheetUrlOrId: targetUrlOrId,
        sheetTitle: title || ''
      });
      const label = res.config.sheetTitle || res.config.sheetId;
      onConnected(
        `Connected "${label}" (${res.summary.members} members, ${res.summary.events} events, ${res.summary.budget} budget rows)`
      );
      onClose();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function useMockData() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const res = await apiFetch<SwitchResponse>('POST', '/api/sheets/config', {
        mode: 'mock'
      });
      onConnected(
        `Switched to built-in Mock-Data (${res.summary.members} members, ${res.summary.events} events)`
      );
      onClose();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} onmessage={handleWindowMessage} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      class="modal-card sheet-picker-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheetPickerTitle"
    >
      <div class="modal-head">
        <div>
          <p class="eyebrow">DATA SOURCE &amp; PERSISTENCE</p>
          <h2 id="sheetPickerTitle">Connect Google Sheet</h2>
        </div>
        <button type="button" class="icon-btn" aria-label="Close modal" onclick={onClose}>
          &times;
        </button>
      </div>

      <div class="sheet-status-bar">
        <div class="sheet-status-item">
          <span class="sheet-status-label">Active sheet</span>
          <strong>
            {#if mode === 'google'}
              Google Sheet: {activeSheetTitle || activeSheetId}
            {:else}
              Built-in Mock-Data CSVs
            {/if}
          </strong>
        </div>
        <span
          class={`badge ${
            supabaseStatus === 'connected'
              ? 'ok'
              : supabaseStatus === 'schema_missing'
                ? 'wait'
                : ''
          }`}
        >
          {#if dbBackend === 'supabase'}
            Supabase (public-cee-v2)
          {:else if supabaseStatus === 'schema_missing'}
            Local SQLite (run schema.sql)
          {:else}
            Local SQLite
          {/if}
        </span>
      </div>

      {#if error}
        <p class="banner error" role="alert">{error}</p>
      {/if}

      <div class="sheet-sections">
        <!-- Section A: Google Drive & Recent Sheets -->
        <section class="sheet-section">
          <div class="sheet-section-head">
            <div>
              <h3>Select from Google Drive</h3>
              <p class="muted">Browse your Google Drive spreadsheets (private or shared) or switch to a recent sheet.</p>
            </div>
            <button
              type="button"
              id="browseDriveBtn"
              class="btn small"
              disabled={driveLoading || busy || loadingConfig}
              onclick={browseGoogleDrive}
            >
              {#if driveLoading}
                Loading Drive...
              {:else if hasDriveAccess}
                Refresh Drive
              {:else if supabaseOAuthAvailable}
                Connect Google Drive
              {:else}
                Browse Google Drive
              {/if}
            </button>
          </div>

          {#if hasDriveAccess || hasDriveToken}
            <div class="drive-connected-bar">
              <span class="badge ok">
                Google Drive connected{googleEmail ? ` (${googleEmail})` : ''}
              </span>
              {#if supabaseOAuthAvailable}
                <button
                  type="button"
                  class="text-link"
                  disabled={driveLoading || busy}
                  onclick={startSupabaseDriveOAuth}
                >
                  Reconnect
                </button>
              {/if}
            </div>
          {/if}

          {#if driveNote}
            <p class="hint">{driveNote}</p>
          {/if}

          {#if showTokenPrompt}
            <div class="drive-token-row">
              <input
                type="password"
                placeholder="Paste Google Drive OAuth access token (drive.readonly)..."
                aria-label="Google Drive OAuth access token"
                bind:value={manualAccessToken}
              />
              <button
                type="button"
                class="btn small primary"
                disabled={driveLoading || !manualAccessToken.trim()}
                onclick={() => fetchDriveFiles(manualAccessToken.trim())}
              >
                Load files
              </button>
            </div>
          {/if}

          {#if driveFiles.length}
            <div class="drive-search-row">
              <input
                type="search"
                placeholder="Search Google Drive spreadsheets by name..."
                aria-label="Search Google Drive spreadsheets"
                bind:value={driveSearch}
              />
            </div>
            {#if filteredDriveFiles.length}
              <ul class="sheet-list" aria-label="Google Drive spreadsheets">
                {#each filteredDriveFiles as file (file.id)}
                  <li class="sheet-list-item">
                    <div class="sheet-list-meta">
                      <strong>{file.name}</strong>
                      <small class="muted">
                        {file.modifiedTime
                          ? `Updated ${new Date(file.modifiedTime).toLocaleDateString('en-GB')}`
                          : file.id}
                      </small>
                    </div>
                    <button
                      type="button"
                      class="btn small primary"
                      disabled={busy}
                      onclick={() => connectGoogleSheet(file.id, file.name)}
                    >
                      {activeSheetId === file.id && mode === 'google' ? 'Connected' : 'Connect'}
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="hint">No spreadsheets match "{driveSearch}".</p>
            {/if}
          {/if}

          {#if recentSheets.length}
            <div class="recent-sheets-block">
              <span class="sub-label">Recently connected</span>
              <ul class="sheet-list">
                {#each recentSheets as item (item.sheetId)}
                  <li class="sheet-list-item">
                    <div class="sheet-list-meta">
                      <strong>{item.sheetTitle}</strong>
                      <small class="muted">{item.sheetId}</small>
                    </div>
                    <button
                      type="button"
                      class="btn small"
                      disabled={busy}
                      onclick={() => connectGoogleSheet(item.sheetId, item.sheetTitle)}
                    >
                      {activeSheetId === item.sheetId && mode === 'google' ? 'Reconnect' : 'Connect'}
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </section>

        <!-- Section B: Instant Paste URL/ID -->
        <section class="sheet-section">
          <h3>Paste Google Sheet Link or ID (Instant Connect)</h3>
          <p class="muted">
            Share your sheet as <b>"Anyone with the link can view"</b> (or connect Google Drive above for private sheets) with tabs
            <code>Members</code>, <code>Events</code>, <code>Attendance</code>, and <code>Budget</code>.
          </p>
          <form
            class="sheet-url-form"
            onsubmit={(e) => {
              e.preventDefault();
              connectGoogleSheet(sheetUrlOrId, sheetTitleInput);
            }}
          >
            <div class="sheet-url-fields">
              <div>
                <label for="sheetUrlInput">Google Sheet URL or Spreadsheet ID</label>
                <input
                  id="sheetUrlInput"
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  bind:value={sheetUrlOrId}
                  required
                />
              </div>
              <div>
                <label for="sheetTitleInput">Display label (optional)</label>
                <input
                  id="sheetTitleInput"
                  placeholder="e.g. Academic Club 2026"
                  bind:value={sheetTitleInput}
                />
              </div>
            </div>
            <button
              type="submit"
              class="btn primary"
              id="connectSheetSubmit"
              disabled={busy || !sheetUrlOrId.trim()}
            >
              {busy ? 'Validating & syncing...' : 'Connect & Sync Sheet'}
            </button>
          </form>
        </section>

        <!-- Section C: Built-in Mock-Data & Starter Templates -->
        <section class="sheet-section">
          <div class="sheet-section-head">
            <div>
              <h3>Built-in Mock-Data &amp; Starter Templates</h3>
              <p class="muted">
                Switch back to local Mock-Data anytime or download the 4 canonical CSV tabs to import into Google Sheets.
              </p>
            </div>
            <button
              type="button"
              class="btn"
              id="useMockDataBtn"
              disabled={busy || mode === 'mock'}
              onclick={useMockData}
            >
              Use Built-in Mock-Data (67 members, 20 events)
            </button>
          </div>
          <div class="template-links">
            <a class="btn small" href="/api/sheets/export-csv?tab=Members" download="Members.csv">
              &#8615; Members.csv
            </a>
            <a class="btn small" href="/api/sheets/export-csv?tab=Events" download="Events.csv">
              &#8615; Events.csv
            </a>
            <a class="btn small" href="/api/sheets/export-csv?tab=Attendance" download="Attendance.csv">
              &#8615; Attendance.csv
            </a>
            <a class="btn small" href="/api/sheets/export-csv?tab=Budget" download="Budget.csv">
              &#8615; Budget.csv
            </a>
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}
