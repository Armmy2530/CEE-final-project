# ADR-0009: Supabase Google OAuth for Sign-In & 1-Click Google Drive Sheet Picker

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** Supabase Google OAuth endpoints (`src/routes/api/auth/google/+server.ts`), OAuth callback & root hash fallback (`src/routes/auth/callback/+page.svelte`, `src/routes/+page.svelte`), authenticated Google Sheets v4 & Drive APIs (`src/lib/server/sheets.ts`, `src/lib/server/runtime.ts`, `src/routes/api/sheets/drive/+server.ts`, `src/routes/api/sheets/config/+server.ts`), and UI integration (`src/lib/components/AuthView.svelte`, `src/lib/components/SheetPickerModal.svelte`).

## Context

Following ADR-0008, Club Dashboard supported Supabase PostgreSQL (`public-cee-v2`) persistence and a Google Drive / Google Sheets selector (`SheetPickerModal.svelte`). However:

1. **Public-Only Sheets Without OAuth:** Without a Google OAuth access token, `src/lib/server/sheets.ts` could only read spreadsheets shared as *"Anyone with the link can view"* (via API key or keyless `gviz/tq?tqx=out:csv`). Private and organization-shared spreadsheets in a user's Google Drive were inaccessible.
2. **Manual Drive Token Setup:** Browsing Google Drive inside `SheetPickerModal.svelte` previously required configuring a standalone `PUBLIC_GOOGLE_CLIENT_ID` for Google Identity Services or pasting a raw OAuth token manually.
3. **Single-Click Sign-In:** Evaluators and club officers already have Google accounts managed by the project's Supabase Auth configuration (`external.google: true`), making a unified Supabase Google OAuth flow ideal for both login and Google Drive/Sheets access.

## Decision

1. **Unified Supabase Google OAuth Endpoint (`/api/auth/google`):**
   - `GET /api/auth/google` builds `${SUPABASE_URL}/auth/v1/authorize` with `provider=google`, `redirect_to=${origin}/auth/callback?intent=${intent}`, `scopes=https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly`, `access_type=offline`, and `prompt=consent`. Supports `?json=1` for programmatic inspection and `302` redirect for browser flows.
   - `POST /api/auth/google` validates the Supabase `access_token` against `${SUPABASE_URL}/auth/v1/user` (with `apikey` + `Authorization: Bearer`) and persists `provider_token` (`google_provider_token`) and `email` (`google_connected_email`) into SQLite `app_settings` and Supabase `public-cee-v2.app_settings` via `runtime.saveSettingToSupabase`.
   - **Session Handling:** If the caller already has an active `locals.user` session (e.g., an admin connecting Google Drive from `SheetPickerModal`), the existing session user is preserved. Otherwise, the handler looks up or provisions a user mapped by `google_user_map:<email>` (e.g. `GOOGLE-${id.slice(0, 6).toUpperCase()}` with `role: 'admin'`) and issues a standard `sid` HTTP-only session cookie.

2. **Popup + Full-Page Redirect & Root Hash Fallback:**
   - `src/routes/auth/callback/+page.svelte` parses `#access_token=...` and `#provider_token=...` (plus query parameters), exchanges them via `POST /api/auth/google`, notifies `window.opener` via `postMessage({ type: 'supabase-google-oauth', ok: true, ... }, window.location.origin)` when opened in a popup (`window.open`), or redirects back to `/` (or `/?openSheetPicker=1` when `intent=drive`).
   - `src/routes/+page.svelte` includes a root `onMount` hash listener (`handleRootOAuthHash`) so that even if Supabase Auth falls back to redirecting to the configured Site URL `/`, `#access_token=` and `#provider_token=` are still exchanged seamlessly without losing the session or Drive token.

3. **Authenticated Google Sheets v4 Fetching & Drive Expiry Recovery:**
   - `createSource` in `src/lib/server/sheets.ts` accepts `getAccessToken?: () => string | null`, wired in `src/lib/server/runtime.ts` to `rawDb.getSetting('google_provider_token')`.
   - When `oauthToken` is present, `fetchGoogleBatch` calls `https://sheets.googleapis.com/v4/spreadsheets/{sheetId}/values:batchGet` with `Authorization: Bearer ${oauthToken}` (omitting the public `?key=` parameter), enabling reads from both private and shared spreadsheets. If the OAuth call returns `400`/`401`/`403`, `fetchGoogleForId` gracefully falls back to `GOOGLE_API_KEY` and then keyless `gviz` CSV export.
   - `/api/sheets/drive` falls back to the stored `google_provider_token`, automatically clears the stored token and returns `{ hasDriveAccess: false, tokenExpired: true }` if Google Drive responds `401`, and `/api/sheets/config` exposes `supabaseOAuthAvailable`, `hasDriveToken`, and `googleEmail`.

4. **Sign-In & Sheet Picker UI (`AuthView.svelte` & `SheetPickerModal.svelte`):**
   - `AuthView.svelte` adds a **"Continue with Google"** button below the credentials form (`sessionStorage.setItem('oauth_intent', 'login')` → `/api/auth/google?intent=login`).
   - `SheetPickerModal.svelte` auto-loads Drive spreadsheets on open when `hasDriveToken` is true, launches the Supabase OAuth popup on **"Connect Google Drive"** / **"Reconnect"**, displays a `Google Drive connected (<email>)` badge, and provides a live name filter above the Drive spreadsheet list.

## Consequences

- **Positive:** Users can sign in with Google in one click and browse or connect private and shared Google Sheets directly from Google Drive without manual API keys or OAuth token pasting.
- **Positive:** Existing `MOCK-66-0001` / password sessions remain intact when linking Google Drive from `SheetPickerModal`, and offline/public CSV fallbacks continue to work when no OAuth token is present.
- **Operational Note:** Ensure the deployment origin's `/auth/callback` URL is added to the Supabase project's **Authentication → URL Configuration → Redirect URLs** allow-list (though the root hash fallback in `+page.svelte` also covers redirects to Site URL `/`).
