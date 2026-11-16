# ADR-0010: Linked-Only Google Sign-In, Admin-Only Sheet Selection, & Drive API 403 Diagnostics

- **Status:** Accepted
- **Date:** 2026-11-17
- **Scope:** Google OAuth account linking (`src/routes/api/auth/google/+server.ts`), Drive API error diagnostics (`src/routes/api/sheets/drive/+server.ts`, `src/lib/components/SheetPickerModal.svelte`), admin-only sheet selection (`src/routes/api/sheets/config/+server.ts`, `src/routes/+page.svelte`, `src/lib/components/Topbar.svelte`, `src/lib/components/SummaryView.svelte`, `src/lib/components/ProjectsView.svelte`), session enrichment (`src/lib/types.ts`, `src/lib/server/db.ts`, `src/lib/server/runtime.ts`), and legacy `GOOGLE-*` database cleanup.

## Context

Following ADR-0009, three issues emerged during live testing with Supabase Google OAuth:

1. **Unwanted `GOOGLE-XXXXXX` Auto-Provisioning:** Signing in with an unlinked Google account (`sutigran2557@gmail.com`) auto-created a synthetic `GOOGLE-809B18` admin user instead of authenticating an existing club member account (`MOCK-66-0001..0067` or admin-created user). This bypassed the club roster and gave unlinked Google logins full `admin` privileges.
2. **Unrestricted Sheet Selection:** Any authenticated user (including `role: 'user'`) could open `SheetPickerModal` or call `POST /api/sheets/config` and `GET /api/sheets/drive`, and any Google login overwrote the shared `google_provider_token`.
3. **Opaque Google Drive API 403 Error:** When Google Cloud Project `802882631291` had not enabled the Google Drive API (`drive.googleapis.com`), `/api/sheets/drive` returned a generic `"Google Drive API responded 403"` message instead of surfacing Google's `SERVICE_DISABLED` / `accessNotConfigured` error message and Cloud Console activation URL.

## Decision

1. **Google Sign-In Hooks ONLY to Existing Club Accounts (No `GOOGLE-XXXXXX` Creation):**
   - `POST /api/auth/google` never provisions synthetic `GOOGLE-XXXXXX` accounts.
   - **Linking while signed in (`intent=link` or `intent=drive`):** When `locals.user` is present, `POST /api/auth/google` maps `email.toLowerCase()` bidirectionally to `locals.user.member_id` via `google_user_map:<email>` and `user_google_email:<member_id>` in both local SQLite `app_settings` and Supabase `public-cee-v2.app_settings`.
   - **Unlinking (`DELETE /api/auth/google`):** Signed-in users can remove their Google link (`deleteSetting` on both `google_user_map:<email>` and `user_google_email:<member_id>` in SQLite and Supabase).
   - **Signing in while signed out (`intent=login`):** `POST /api/auth/google` looks up `google_user_map:<email>` and verifies the mapped `member_id` exists. Unlinked Google accounts receive `403` with instructions to sign in with their Member ID first and click **"Link Google account"** in the profile menu. `/auth/callback/+page.svelte` and `src/routes/+page.svelte` forward this error to `AuthView.svelte` via `?authError=...` (and `postMessage` / root hash fallback).
   - **Profile Menu UI:** `SessionUser` includes `linkedGoogleEmail: string | null`, populated across `hooks.server.ts`, `/api/me`, `/api/auth/login`, `/api/auth/setup`, `/api/auth/register`, and `/api/auth/google`. `Topbar.svelte` renders **Link Google account** (`#linkGoogleBtn`) or `Google linked: <email>` + **Unlink Google** (`#unlinkGoogleBtn`) inside `#userMenu`.

2. **Admin-Only Google Sheet Selection (`user.role === 'admin'`):**
   - **Backend Guards:** `POST /api/sheets/config` and `GET /api/sheets/drive` reject non-admin users with `403`. `POST /api/auth/google` only stores or overwrites the global `google_provider_token` and `google_connected_email` when the authenticated/mapped user has `role === 'admin'`.
   - **Frontend Guards:** `SheetPickerModal` is only mounted and openable when `user.role === 'admin'`. In `Topbar.svelte`, `.source-card` shows the `···` selector button (`#openSheetPickerBtn`) only for admins and shows a read-only sync card + refresh action for normal users. `SummaryView.svelte` and `ProjectsView.svelte` hide the **Connect Google Sheet** button when `!isAdmin`.

3. **Google Drive API `403 SERVICE_DISABLED` Diagnostics:**
   - `/api/sheets/drive` parses Google's JSON error body (`details` / `errors` / `message`) for `SERVICE_DISABLED` / `accessNotConfigured`, returning HTTP `403` with Google's exact `error` message, `code: 'SERVICE_DISABLED'`, and `activationUrl` (`https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=...`).
   - `SheetPickerModal.svelte` renders a clickable **"Enable Google Drive API in Google Cloud Console ↗"** link whenever `activationUrl` is returned.

4. **Legacy `GOOGLE-809B18` Migration:**
   - `runtime.ts` includes an idempotent cleanup step in `ensureSeeded()` (and a one-off live migration ran against `data/app.db` and Supabase `public-cee-v2`) that reassigns any sessions from legacy `GOOGLE-*` users to `MOCK-66-0001`, updates `google_user_map:sutigran2557@gmail.com` and `user_google_email:MOCK-66-0001`, and deletes `GOOGLE-809B18` from both SQLite and Supabase.

## Consequences

- **Positive:** All authentication remains anchored to canonical club accounts (`MOCK-66-0001..0067` or admin-provisioned users); normal members cannot alter the club's connected Google Sheet or overwrite Drive credentials; admins get direct 1-click navigation to enable the Google Drive API in Google Cloud Console when `SERVICE_DISABLED` occurs.
- **Note:** Existing users who previously logged in only with Google must sign in once with their Member ID and link their Google account from the profile menu (`#userMenu`), after which Google Sign-In works directly for their account.
