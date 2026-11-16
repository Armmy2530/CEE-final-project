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
