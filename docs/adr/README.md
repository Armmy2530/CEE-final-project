# Architecture Decision Records (ADRs)

This directory records the major architectural and product decisions for **Club Dashboard**.

| ADR | Title | Status | Date | Scope |
|---|---|---|---|---|
| [0001](./0001-mock-data-normalization.md) | Mock Data Normalization into 4 Canonical CSV Tabs | Accepted | 2026-11-16 | `Mock-Data/*.xlsx` &rarr; `sample-sheets/*.csv` via `scripts/build-mock-sheets.py` |
| [0002](./0002-bun-sveltekit-architecture.md) | Bun + SvelteKit (Svelte 5) Full-Stack Architecture | Accepted | 2026-11-16 | Migration to Bun, SvelteKit 2, Svelte 5, `bun:sqlite`, and `bun test` |
| [0003](./0003-openrouter-ai-chat.md) | OpenRouter AI Chatbox Integration & Enriched Club Context | Accepted | 2026-11-16 | OpenRouter chat client, privacy-safe aggregates, and offline lookup |
| [0004](./0004-calendar-week-and-month-views.md) | Google Calendar-Style Week & Month Views with Project Navigation | Accepted | 2026-11-16 | Pure calendar math (`calendar.ts`), Month/Week views, project navigation |
| [0005](./0005-branding-and-db-theme-preference.md) | Club Dashboard Rebranding & DB-Persisted Theme Preference | Accepted | 2026-11-16 | `Club Dashboard` branding, legacy DB migration, 3-layer theme sync |
| [0006](./0006-idempotent-admin-seeding.md) | Idempotent Member Seeding, Admin Promotion & Node/Bun Compatibility | Accepted | 2026-11-16 | Cross-runtime `mock.ts`/`db.ts`, idempotent `seedFromMembers`, `MOCK-66-0001` promotion |
| [0007](./0007-clubhouse-ui-redesign.md) | Clubhouse UI/UX Redesign with Real Mock-Data Views | Accepted | 2026-11-17 | `clubhouse.` design system, sidebar rail, enriched `DashboardPayload`, Members & Budget views |
| [0008](./0008-markdown-calendar-supabase-drive-sheets.md) | Svelte-Markdown Chat, 1-Button Theme Toggle, Calendar UX Overhaul, Supabase (`public-cee-v2`), & Google Drive Sheet Selector | Accepted | 2026-11-17 | `@humanspeak/svelte-markdown`, `#themeToggle`, split Calendar UX, `public-cee-v2` sync, `SheetPickerModal` |
| [0009](./0009-supabase-google-oauth-drive-integration.md) | Supabase Google OAuth for Sign-In & 1-Click Google Drive Sheet Picker | Accepted | 2026-11-17 | `/api/auth/google`, `/auth/callback`, root hash fallback, Bearer Google Sheets v4 & Drive OAuth |
| [0010](./0010-google-account-linking-and-admin-sheet-guard.md) | Linked-Only Google Sign-In, Admin-Only Sheet Selection, & Drive API 403 Diagnostics | Accepted | 2026-11-17 | Linked-only Google auth, `#linkGoogleBtn`/`#unlinkGoogleBtn`, admin sheet guards, Drive `SERVICE_DISABLED` link |
| [0011](./0011-svar-calendar-and-responsive-layout.md) | SVAR Svelte Calendar Integration & Mobile / Vertical Display Responsive Layout | Accepted | 2026-11-17 | `@svar-ui/svelte-calendar`, 8-color `EVENT_PALETTE`, inspector sync, off-canvas drawer, `.mobile-bottom-nav`, responsive breakpoints |
| [0012](./0012-supabase-primary-strict-sqlite-fallback.md) | Supabase Primary Store with Strict 503 & Local SQLite Startup Fallback | Accepted | 2026-11-18 | Async `AppStore` (`store.ts`), strict `SupabaseStore` (`503 StoreUnavailableError`), lazy SQLite startup fallback |
