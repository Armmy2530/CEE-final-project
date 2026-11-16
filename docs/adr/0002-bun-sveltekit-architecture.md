# ADR-0002: Bun + SvelteKit (Svelte 5) Full-Stack Architecture

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** Migration from `node:http` + imperative DOM (`server.js`, `lib/*.js`, `public/*`) to **Bun + SvelteKit 2 (Svelte 5)** with `bun:sqlite` and `bun test`.

## Context

The initial prototype of the ACADEMIC AC Club Activity Dashboard was built with a raw `node:http` server (`server.js`), CommonJS modules (`lib/*.js`), `node:sqlite`, and imperative DOM manipulation (`public/app.js`, `public/charts.js`, `public/index.html`). While functional for an early demo, this architecture has several limitations:

1. **No static type safety across server/client boundaries:** Data shapes returned by `lib/dashboard.js` and `/api/*` endpoints were untyped, making schema changes (such as integrating the normalized `sample-sheets/*.csv` `Mock-Data` dataset with `Income`/`Expense` transaction types and extended attendance metadata) error-prone.
2. **Imperative DOM rendering:** `public/app.js` manually constructed and tore down DOM nodes (`document.createElement`, `textContent = ''`) on every filter, sort, search, or project selection change, increasing maintenance overhead.
3. **Client-only theme initialization:** Theme preference lived only in browser `localStorage` via a synchronous blocking `<script src="theme.js">`, without server-side persistence per authenticated user or SSR rendering support.
4. **Separate `Mock-Data` normalization disconnect:** The runtime fallback (`lib/mock.js`) generated synthetic `ST001..ST024` / `EV001..EV009` records instead of consuming the canonical `sample-sheets/*.csv` (`MOCK-66-0001..0067`, `AC-001..AC-020`) dataset created in ADR-0001.

## Decision

We migrate the application to **Bun + SvelteKit 2 (Svelte 5)** with TypeScript across the full stack:

1. **Runtime, Framework & Build Adapter:**
   - Use **Bun** (`bun:sqlite` for accounts/sessions, `bun test` for unit and integration testing).
   - Use **SvelteKit 2 + Svelte 5 (runes) + Vite** for SSR, routing, API endpoints, and reactive UI components.
   - Configure `svelte-adapter-bun` (or `@sveltejs/adapter-node` runnable via `bun`) in `svelte.config.js` so `bun run build` emits a standalone production server.

2. **Server Business Logic (`src/lib/server/`):**
   - Modularize all domain logic in TypeScript under `src/lib/server/`:
     - `dates.ts`: Timezone-aware date formatting, Buddhist-era normalization, and day arithmetic.
     - `alerts.ts`: Automated 80%/100% budget and 0–3 day upcoming event alert engine.
     - `sheets.ts`: Batched Google Sheets API client with caching, stale-on-error fallback, extended `Mock-Data` column alias support, Thai/English status normalization, Staff role mapping, and `Income`/`Expense` budget type preservation.
     - `mock.ts`: RFC-4180 CSV parser loading `sample-sheets/{Members,Events,Attendance,Budget}.csv` through `NORMALIZERS` with deterministic `today` handling so upcoming and budget alerts remain verifiable.
     - `dashboard.ts`: Aggregation filtering `Expense`-only transactions (`b.type !== 'Income'`) into actual spending, preserving project role/major fallbacks on attendance lists, and computing `gender`/`year`/`major` breakdowns across both 2026 and 2027 projects.
     - `db.ts`: `bun:sqlite` database managing `users` (including persisted `theme` column) and `sessions`, seeded from `Members` (`MOCK-66-0001` as `admin`, `MOCK-66-0002..0067` as `user`), with `node:crypto` scrypt password hashing.
     - `chat.ts`: Anthropic Claude integration and offline Thai/English rule-based assistant.
     - `runtime.ts`: Server runtime container wiring DB, Sheets source, rate limiters, and seeding.
   - Move project relevance search to `src/lib/search.ts` for shared use by Svelte components and `bun test`.

3. **API Routes & Security (`src/hooks.server.ts`, `src/routes/api/`):**
   - Preserve and extend the REST API under `src/routes/api/`:
     - `GET /api/health`
     - `POST /api/auth/setup`, `POST /api/auth/register` (public self-registration), `POST /api/auth/login`, `POST /api/auth/logout`
     - `GET /api/me`, `PATCH /api/me/theme`
     - `GET /api/dashboard`
     - `POST /api/chat`
     - `GET/POST /api/admin/users`, `DELETE /api/admin/users/[id]`, `POST /api/admin/users/[id]/reset`
   - Enforce CSRF origin validation, JSON content-type checks on writes, fixed-window rate limiting, role-based access control (`401`/`403`), and security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, CSP) in `src/hooks.server.ts` and `svelte.config.js`.

4. **Frontend UI & Assets (`src/routes/`, `src/lib/components/`, `src/app.css`, `static/image/`):**
   - Move `public/image/*` to `static/image/*` and `public/style.css` to `src/app.css`.
   - Render `data-theme` during SSR via `hooks.server.ts` `transformPageChunk` using the logged-in user's SQLite `theme` preference (falling back to cookie/light).
   - Decompose the UI into reactive Svelte 5 components (`AuthView.svelte` with Sign in / First time? Set password / Sign up tabs, `Topbar.svelte`, `SummaryView.svelte`, `BarChart.svelte`, `ProjectsView.svelte`, `UsersView.svelte`, `ChatWidget.svelte`, `ToastContainer.svelte`) while preserving the warm cream/amber visual design system.

## Consequences

- **Positive:** End-to-end TypeScript types from CSV/Sheets normalization through API routes to Svelte 5 components; reactive SVG charts and filters without imperative DOM rebuilding; SSR theme rendering with SQLite persistence; fast test execution with `bun test`; real 67-member / 20-project / 2,322-attendance / 126-transaction `Mock-Data` dataset active out of the box.
- **Trade-off:** Introduces a build step (`bun run build`) and SvelteKit dev dependencies (`svelte`, `@sveltejs/kit`, `vite`) compared to the zero-dependency raw Node server.
