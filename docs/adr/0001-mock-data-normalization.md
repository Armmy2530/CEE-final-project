# ADR-0001: Mock Data Normalization into 4 Canonical CSV Tabs

- **Status:** Accepted
- **Date:** 2026-11-16
- **Scope:** `Mock-Data/*.xlsx` -> `sample-sheets/{Members,Events,Attendance,Budget}.csv` via `scripts/build-mock-sheets.py`

## Context

The raw club dataset in `../Mock-Data/` is split across four Excel workbooks with structural inconsistencies that prevent direct ingestion into a 4-tab Google Sheet or the dashboard aggregator:

1. **Fragmented workbooks and 20 separate attendance tabs:**
   - `MASTERSHEET.xlsx` contains `overall`, `club member` (67 members, `MOCK-66-0001`..`MOCK-66-0067`), and `tx_id_finance` (126 rows, `TX-001`..`TX-126`).
   - `finance/budget_transactions.xlsx` contains `overall` and `Transaction_Details`.
   - `sec/academic_club_projects.xlsx` contains `academic_club_projects` (`AC-001`..`AC-020`).
   - `sec/academic_club_members.xlsx` splits event attendance across **20 separate worksheets** (`AC-001`..`AC-020`, 2,322 records total, with trailing blank XML rows on `AC-007`..`AC-010`).
2. **Schema drift across attendance tabs:**
   - Tabs `AC-001`..`AC-010` use separate `Department` and `Year` columns (`Year 1`..`Year 4`).
   - Tabs `AC-011`..`AC-020` merge them into a single `Department / Year` column (e.g., `Environmental Engineering / Year 3`).
3. **Mixed finance ledger rows:**
   - `tx_id_finance` mixes `Income` rows (with blank `Expense_Type`) and `Expense` rows in a single table.
4. **Missing fields required by the dashboard & alerts:**
   - `gender` is absent from both `club member` and `academic_club_members.xlsx` (needed for the Gender/Year/Major breakdown chart).
   - `location` is absent from `academic_club_projects.xlsx` (needed for event cards and Upcoming Event alert messages).
5. **Excel date-formatting glitch on `AC-002`:**
   - `MASTERSHEET.xlsx` `overall` carries a spreadsheet display-format glitch on `AC-002` (`Open House Engineering 2026`), whereas `finance/budget_transactions.xlsx` `overall` preserves the clean numeric `Total_Income` (`44000`) and `Total_Expenses` (`40830`).
6. **Demo timing window (Nov 16–19, 2026):**
   - None of the raw `Scheduled` / `Processing` / `Waiting for approving` events start within `0..3` days of the Nov 18–19 demo window, which would leave the Upcoming Event alert untested.

## Decision

We introduce a deterministic, zero-dependency Python 3 standard-library script ([`scripts/build-mock-sheets.py`](../../scripts/build-mock-sheets.py) using `zipfile` + `xml.etree.ElementTree`) that reads all four source `.xlsx` workbooks directly and emits four canonical CSV tabs in `sample-sheets/`:

1. **`sample-sheets/Members.csv`** (67 rows, `MOCK-66-0001`..`MOCK-66-0067`)
   - Columns: `member_id,full_name,department,role,email,joined_date,gender,year,major,member_status`
   - Maps `Student_ID -> member_id`, `Name -> full_name`, `Committee -> department`, `Role -> role`, `Email -> email`, `Join_Date -> joined_date` (ISO `YYYY-MM-DD`), `Department -> major`, `Year` (`Year N -> N`) -> `year`, and `Member_Status -> member_status`.
   - Assigns `gender` (`Female` / `Male`) deterministically from first name.
   - Keeps `MOCK-66-0001` (Aiden Adams, Academic Affairs Lead) as row 1 so the first seeded SQLite account receives the `admin` role.

2. **`sample-sheets/Events.csv`** (20 rows, `AC-001`..`AC-020`)
   - Columns: `event_id,title,date,end_date,location,description,budget_planned,status,image_url`
   - Reads `budget_planned` from `Total_Income` in `finance/budget_transactions.xlsx` `overall` (so `AC-002` is `44000`).
   - Maps status: `Done -> Completed`, `Processing -> Scheduled`, `Waiting for approving -> Scheduled`.
   - Assigns realistic Chula Engineering venues to `location`.
   - Shifts `AC-016` (`Data Analytics with Excel and Power BI`, `Scheduled`) to `2026-11-18`..`2026-11-20` and `AC-017` (`Engineering Research Showcase`, `Scheduled`) to `2026-11-20`..`2026-11-21` so at least one `Scheduled` event starts within `0..3` days across Nov 16, 17, 18, and 19.

3. **`sample-sheets/Attendance.csv`** (2,322 rows, `ATT-0001`..`ATT-2322`)
   - Columns: `attendance_id,event_id,member_id,full_name,check_in_time,status,participant_type,project_role,gender,year,major`
   - Consolidates all 20 sheets (`AC-001`..`AC-020`) of `sec/academic_club_members.xlsx`, skipping empty trailing rows and splitting `Department / Year` on `/` for `AC-011`..`AC-020`.
   - Maps `Role` in `{President, Vice President, Secretary, Treasurer, IT Head, Staff}` to `participant_type = Staff` (preserving original role in `project_role`), and `Participant` to `participant_type = Participant`.
   - Links any attendee whose `Name` matches `Members.csv` to their canonical `MOCK-66-xxxx` `member_id` and `gender`; otherwise preserves `Student_ID` and infers `gender` deterministically from first name.
   - Assigns deterministic attendance `status`: ~85% `Present`, ~10% `Late`, ~5% `Absent` on `AC-001`..`AC-016` (with all `Staff` as `Present` or `Late`), and `Present` / `Late` on `AC-017`..`AC-020` so all 20 project detail views render Staff, Participants, and breakdowns. Sets `check_in_time` to `<event_start_date> 09:00` for attended records and empty for `Absent`.

4. **`sample-sheets/Budget.csv`** (126 rows, `TX-001`..`TX-126`)
   - Columns: `expense_id,event_id,type,category,amount,date,receipt_ref`
   - Reads `MASTERSHEET.xlsx` `tx_id_finance`, preserving `Type` (`Income` / `Expense`), setting `category` to `Expense_Type` for `Expense` rows or `Club Allocation` for `Income` rows, formatting `date` as ISO `YYYY-MM-DD`, and generating sequential `receipt_ref` values `RC-2026-0001`..`RC-2026-0126`.

## Consequences

- **Positive:** Single repeatable command (`python3 scripts/build-mock-sheets.py`) regenerates all 4 canonical CSVs from the raw Excel workbooks without requiring `openpyxl` or `pandas`.
- **Positive:** All 20 projects (`AC-001`..`AC-020`), 67 club members (`MOCK-66-0001`..`MOCK-66-0067`), 2,322 attendance records, and 126 financial transactions are preserved with clean types, ISO dates, and active demo alerts.
- **Note:** `Budget.csv` includes both `Income` and `Expense` rows (`type` column); downstream aggregators (`lib/dashboard.js`) must filter or distinguish `type === 'Expense'` when summing actual expenditure so `Income` allocations are not double-counted as spending.
