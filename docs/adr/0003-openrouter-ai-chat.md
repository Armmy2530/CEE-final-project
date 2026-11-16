# ADR-0003: OpenRouter AI Chatbox Integration & Enriched Club Context

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** AI chatbox server client (`src/lib/server/chat.ts`), API route (`src/routes/api/chat/+server.ts`), UI widget (`src/lib/components/ChatWidget.svelte`), environment/deployment config (`.env.example`, `render.yaml`), and tests (`tests/app.test.ts`).

## Context

The initial dashboard prototype integrated an AI assistant in `src/lib/server/chat.ts` using Anthropic's `/v1/messages` endpoint with `claude-haiku-5-5` as the default model. That model identifier does not exist, causing API requests to fail and silently fall back to the rule-based offline answerer whenever an API key was tested. In addition, binding the backend to a single vendor's proprietary message format prevented the team from swapping between cost-effective or fast models (such as Gemini Flash, GPT-4o-mini, Claude, Llama, or DeepSeek) without rewriting request/response code.

The team chose **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`) because it exposes a single OpenAI-compatible Chat Completions endpoint across all major model providers, controllable solely via environment configuration. At the same time, the assistant's context payload and offline fallback needed to be enriched with committee counts, spending-by-category totals, per-project budgets/attendance, and active alerts—while strictly excluding any personal member emails or phone numbers.

## Decision

1. **OpenRouter Client (`askOpenRouter` in `src/lib/server/chat.ts`):**
   - Implement `askOpenRouter({ env, dash, message, history, fetchImpl })` targeting `OPENROUTER_BASE_URL` (default: `https://openrouter.ai/api/v1/chat/completions`) and `OPENROUTER_MODEL` (default: `google/gemini-2.5-flash`).
   - Send standard OpenRouter headers:
     - `content-type: application/json`
     - `authorization: Bearer ${env.OPENROUTER_API_KEY}`
     - `http-referer: ${env.PUBLIC_APP_URL || 'http://localhost:3000'}`
     - `x-title: Club Dashboard`
   - Send an OpenAI-compatible payload:
     - `model`, `max_tokens: 500`, `temperature: 0.2`
     - `messages`: `[{ role: 'system', content: SYSTEM(buildContext(dash)) }, ...history.slice(-6), { role: 'user', content: message }]`
   - Parse `json.choices?.[0]?.message?.content?.trim()`, supporting both plain string `content` and array-of-parts content blocks returned by multimodal/provider adapters.
   - Enforce a 20-second `AbortSignal.timeout(20000)` and throw on non-2xx responses or empty replies so the route can fall back cleanly.

2. **Provider Priority & Graceful Fallback (`src/routes/api/chat/+server.ts`):**
   - Prioritize `OPENROUTER_API_KEY` whenever configured.
   - Retain legacy `askClaude` in `src/lib/server/chat.ts` only as a fallback when `OPENROUTER_API_KEY` is absent and `ANTHROPIC_API_KEY` is set.
   - On missing API keys or any upstream OpenRouter error, catch and log the error server-side and return `{ reply: answerOffline(message, dash), mode: 'offline' }` with HTTP 200 so the UI remains usable.

3. **Enriched, Privacy-Safe Context (`buildContext` in `src/lib/server/chat.ts`):**
   - Inject structured JSON aggregates into the system prompt:
     - `today`, `metrics` (`members`, `events`, `eventsByStatus`, `budgetActual`, `budgetPlanned`, `budgetIncome`, `budgetPct`)
     - `members_by_department` (committee headcounts)
     - `spending_by_category` (expense totals across categories such as `Speaker Honorarium`, `Food & Beverages`, etc.)
     - `events` (`id`, `title`, `description`, `date`, `end_date`, `location`, `status`, `staff_count`, `participant_count`, `attended_participants`, `attendance_by_group_this_year`, `planned_budget`, `actual_spent`, `spent_pct`, `expenses_by_category`, `attendees`, `attendance_records`)
     - `active_alerts`
   - **Privacy invariant:** Never include personal member email addresses or phone numbers in `buildContext` or model prompts.

4. **Enhanced Offline Answerer (`answerOffline` in `src/lib/server/chat.ts`):**
   - Extend the rule-based Thai/English offline answerer so evaluators without an API key can also ask about:
     - Specific project codes (e.g., `AC-002`) or project titles (e.g., `Open House`), returning status, dates, venue, budget vs. actual, attendance, and top expense categories.
     - Expense categories (both full category breakdown queries and specific category lookups such as `Food & Beverages` or `Speaker Honorarium`).

5. **UI & Deployment Configuration (`ChatWidget.svelte`, `.env.example`, `render.yaml`):**
   - Update `.env.example` and `render.yaml` to use `OPENROUTER_API_KEY=` and `OPENROUTER_MODEL=google/gemini-2.5-flash`.
   - Update `ChatWidget.svelte` mode labels and quick-prompt chips to reflect OpenRouter AI mode, offline fallback, project lookups, and category queries.

## Consequences

- **Positive:** Any OpenRouter-hosted model (`google/gemini-2.5-flash`, `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`, `deepseek/deepseek-chat`, etc.) can be selected via a single `OPENROUTER_MODEL` environment variable with zero code changes.
- **Positive:** The AI assistant has complete aggregate visibility into committees, per-project metrics, and expense categories without leaking member PII, and offline mode covers project and category lookups out of the box.
- **Note:** OpenRouter keys still incur usage costs; operators should configure credit caps on their OpenRouter key and keep the existing `/api/chat` rate limiter active.
