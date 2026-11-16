# ACADEMIC AC - Club Activity Dashboard

Web dashboard for a student club committee. Reads one Google Sheet (5 tabs), shows metric cards,
interactive charts, an events calendar, project details, automatic alerts, light/dark theme and an
AI chatbox. Has real accounts (first-time password creation, login, logout) with two roles.

> All data in this repo is **mock data** with fictional names. Do not put real names, student IDs,
> phone numbers or photos in the sheet.

## Features

| Area | What it does |
|---|---|
| Summary | Cards: total members, total events, actual budget spent. Charts: attendance per event, planned vs actual budget (hover tooltips, legend toggles, status filter, "view as table"). Events calendar. |
| Project data | **Search box** (ranks projects by relevance to the *name*, tolerates typos, Thai works) + **Sort** (Best match / Newest / Oldest / A-Z) + project cards (name • date • status). Opening a card shows: picture/name, detail, location, status (ดำเนินการ / ปิดโครงการ / ยกเลิก), date, planned budget · Detail numbers · Project date (Day 1 ... Day n) · Staff & participants · Attendance (this year only, drop-down by gender / year / major) · Budget actual vs planned. A "project" is a row of the `Events` tab. |
| Accounts | Member ID + password. **First time:** an admin-registered ID creates its own password. Roles: **Normal user** and **Admin** (admin gets a *Users* tab: add user, reset password, delete user). Permissions are enforced on the server. |
| Alerts | Automatic, in-app (bell + toast): budget spending at **>= 80%** of plan (per event and overall) and a Scheduled event within **3 days**. |
| Theme | Light / Dark toggle, remembered in `localStorage`, follows system preference by default. |
| AI chatbox | Bottom-right. Sheet data is injected as context. Uses Claude when `ANTHROPIC_API_KEY` is set, otherwise a built-in offline answerer (Thai + English). |
| Data source | One batched Google Sheets API call for all tabs, cached 30 s, serves last good copy if Google errors. Auto-refreshes every 60 s. |

## Run locally

Requires **Node 22.13+** (uses built-in `node:sqlite`). No `npm install` needed - zero dependencies.

```bash
cp .env.example .env     # optional: works with built-in mock data without any keys
npm start                # http://localhost:3000
npm test                 # 12 automated tests
```

Mock accounts (accounts are created from the `Members` tab on first start):
`ST001` is **Admin**, `ST002`...`ST024` are normal users. Open the page, choose
**First time? Create password**, enter the ID and a password (8+ characters).

## Connect Google Sheets

1. Create a Google Sheet with tabs named exactly `Members`, `Events`, `Attendance`, `Budget`.
   Easiest: `npm run sample-sheets`, then import each CSV from `sample-sheets/` into its tab
   (File > Import > Replace current sheet). Header row = column names in the schema below.
2. Share the sheet: **Anyone with the link -> Viewer**.
3. Google Cloud Console: enable **Google Sheets API**, create an **API key** (restrict it to the Sheets API).
4. Set `GOOGLE_API_KEY` and `GOOGLE_SHEET_ID` (the long id in the sheet URL) in `.env` / hosting dashboard.

| Tab | Columns (header row, any order; extra columns are ignored) |
|---|---|
| Members | member_id, full_name, department, role, email, joined_date, **gender** (Female/Male/Other), **year** (1-4), **major** |
| Events (= projects) | event_id, title, date (start), **end_date** (optional, multi-day), location, **description**, budget_planned, status (Scheduled / Completed / Cancelled, or ดำเนินการ / ปิดโครงการ / ยกเลิก), **image_url** (optional, https only; shown in the round picture) |
| Attendance | attendance_id, event_id, member_id, check_in_time, status (Present / Absent / Late), **participant_type** (Staff / Participant) |
| Budget | expense_id, event_id, category, amount, date, receipt_ref |

Dates: `YYYY-MM-DD` or `DD/MM/YYYY` (Buddhist-era years are converted). The API key never reaches the browser.
The old `Project` tab is no longer used. Accounts are created from the `Members` tab the first time the server starts with an empty database;
afterwards use the **Users** tab. The first member listed becomes the admin.

## Deploy (public URL)

Render (free): push to GitHub -> **New > Blueprint** -> select the repo (uses `render.yaml`), then set
`GOOGLE_API_KEY`, `GOOGLE_SHEET_ID` (and optionally `ANTHROPIC_API_KEY`) in the dashboard.
Any host that can run `node server.js` works (Railway, Fly.io, a VPS).
Note: free hosts have an ephemeral disk, so the account database resets on redeploy/restart -
accounts are re-seeded from `Members` and people create their password again. Attach a persistent
disk and set `DB_PATH` to keep accounts.
Vercel/Netlify static hosting will **not** work (this app needs the Node server).

## Security notes

- Passwords: scrypt + per-user salt. Sessions: random token, only its hash stored, `HttpOnly` + `SameSite=Lax` cookie.
- Login/setup attempts are rate limited; JSON-only writes + Origin check; strict Content-Security-Policy.
- The chatbox sends the model only aggregates and event data - never member e-mails.
- Treat `ANTHROPIC_API_KEY` as a cost risk: set a spend limit in your Anthropic console.

## Project layout

```
server.js          HTTP server, routes, auth, admin API
public/search.js   project-name relevance search (also unit-tested in Node)
lib/               sheets.js (data source) · dashboard.js (aggregation) · alerts.js (80%/3-day engine)
                   db.js (accounts, sessions) · chat.js (AI + offline answerer) · mock.js · dates.js
public/            index.html · style.css (design tokens, dark mode) · app.js · charts.js · theme.js
test/              automated tests
sample-sheets/     CSVs of the mock data for importing into Google Sheets
```

License: MIT
