#!/usr/bin/env python3
"""Normalize Mock-Data/*.xlsx into 4 canonical CSVs in sample-sheets/.

Uses only the Python standard library (zipfile + xml.etree.ElementTree).
See docs/adr/0001-mock-data-normalization.md for schema and mapping rules.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"main": NS_MAIN}

FEMALE_NAMES = {
    "Abigail", "Amelia", "Ava", "Charlotte", "Chloe", "Claire", "Ella",
    "Emily", "Emma", "Evelyn", "Grace", "Hailey", "Hannah", "Harper",
    "Isabella", "Layla", "Lily", "Maya", "Mia", "Natalie", "Nora",
    "Olivia", "Ruby", "Sofia", "Sophia", "Stella", "Zoe",
}

MALE_NAMES = {
    "Adam", "Aiden", "Benjamin", "Caleb", "Daniel", "Dylan", "Elijah",
    "Ethan", "Henry", "Isaac", "Jack", "Jackson", "James", "Leo",
    "Liam", "Logan", "Lucas", "Mason", "Nathan", "Noah", "Oliver",
    "Owen", "Ryan", "Samuel", "Sebastian",
}

EVENT_STATUS_MAP = {
    "done": "Completed",
    "processing": "Scheduled",
    "waiting for approving": "Scheduled",
}

EVENT_LOCATIONS = {
    "AC-001": "Eng 3 Building, Room 301",
    "AC-002": "Centennial Memorial Hall",
    "AC-003": "iScale Lab, Eng 4",
    "AC-004": "Eng 3 Building, Room 302",
    "AC-005": "Chula Engineering Courtyard",
    "AC-006": "IoT Innovation Lab, Eng 4",
    "AC-007": "Eng 100 Auditorium",
    "AC-008": "Eng 2 Building, Lecture Hall 201",
    "AC-009": "CAD/CAM Studio, Eng 3",
    "AC-010": "Eng 3 Building, Room 304",
    "AC-011": "Student Commons, Eng 4",
    "AC-012": "Amata Nakorn Industrial Estate",
    "AC-013": "Eng 100 Seminar Room",
    "AC-014": "Electronics Lab, Eng 2",
    "AC-015": "Engineering Library Hall",
    "AC-016": "Data Science Lab, Eng 4",
    "AC-017": "Centennial Memorial Hall",
    "AC-018": "Robotics Arena, Eng 4",
    "AC-019": "Chula Engineering Courtyard",
    "AC-020": "Eng 100 Auditorium",
}

# Shift AC-016 and AC-017 so an upcoming Scheduled event starts within 0..3 days
# across Nov 16, 17, 18, and 19, 2026.
EVENT_DATE_OVERRIDES = {
    "AC-016": ("2026-11-18", "2026-11-20"),
    "AC-017": ("2026-11-20", "2026-11-21"),
}

STAFF_ROLES = {
    "President",
    "Vice President",
    "Secretary",
    "Treasurer",
    "IT Head",
    "Staff",
}


def col_ref_to_index(ref: str) -> int:
    match = re.match(r"([A-Z]+)", ref or "")
    if not match:
        return 0
    idx = 0
    for ch in match.group(1):
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx - 1


def read_xlsx(path: Path) -> dict[str, list[list[str]]]:
    with zipfile.ZipFile(path) as zf:
        sst: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sst_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sst_root.findall("main:si", NS):
                sst.append("".join(t.text or "" for t in si.iter(f"{{{NS_MAIN}}}t")))

        wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
        rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {
            rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root
        }

        sheets: dict[str, list[list[str]]] = {}
        for sh in wb_root.findall(".//main:sheet", NS):
            name = sh.attrib["name"]
            rid = sh.attrib[f"{{{NS_REL}}}id"]
            target = rid_to_target[rid].lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"

            sheet_root = ET.fromstring(zf.read(target))
            rows: list[list[str]] = []
            for row in sheet_root.findall(".//main:sheetData/main:row", NS):
                cells: dict[int, str] = {}
                max_col = -1
                for cell in row.findall("main:c", NS):
                    col_idx = col_ref_to_index(cell.attrib.get("r", ""))
                    max_col = max(max_col, col_idx)
                    ctype = cell.attrib.get("t", "")
                    v_node = cell.find("main:v", NS)
                    is_node = cell.find("main:is", NS)
                    val = ""
                    if ctype == "s" and v_node is not None and v_node.text is not None:
                        val = sst[int(v_node.text)]
                    elif ctype == "inlineStr" and is_node is not None:
                        val = "".join(t.text or "" for t in is_node.iter(f"{{{NS_MAIN}}}t"))
                    elif v_node is not None and v_node.text is not None:
                        val = v_node.text
                    cells[col_idx] = val.strip()
                if max_col >= 0:
                    row_list = [cells.get(i, "") for i in range(max_col + 1)]
                    if any(row_list):
                        rows.append(row_list)
            sheets[name] = rows
        return sheets


def excel_serial_to_iso(val: str) -> str:
    raw = (val or "").strip()
    if not raw:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        return raw
    serial = int(round(float(raw)))
    return (dt.date(1899, 12, 30) + dt.timedelta(days=serial)).isoformat()


def clean_num(val: str) -> str:
    raw = (val or "").strip()
    if not raw:
        return "0"
    num = float(raw)
    if num.is_integer():
        return str(int(num))
    return f"{num:.2f}".rstrip("0").rstrip(".")


def parse_year(val: str) -> str:
    match = re.search(r"(\d+)", val or "")
    return match.group(1) if match else ""


def infer_gender(full_name: str) -> str:
    first = (full_name or "").strip().split()[0] if full_name.strip() else ""
    if first in FEMALE_NAMES:
        return "Female"
    if first in MALE_NAMES:
        return "Male"
    digest = int(hashlib.md5(first.encode("utf-8")).hexdigest(), 16)
    return "Female" if digest % 2 == 0 else "Male"


def deterministic_pct(key: str) -> int:
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def rows_to_dicts(rows: list[list[str]]) -> list[dict[str, str]]:
    if not rows:
        return []
    header = [h.strip() for h in rows[0]]
    out: list[dict[str, str]] = []
    for r in rows[1:]:
        item = {header[i]: (r[i].strip() if i < len(r) else "") for i in range(len(header)) if header[i]}
        if any(item.values()):
            out.append(item)
    return out


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def build_members(mastersheet: dict[str, list[list[str]]]) -> list[dict[str, str]]:
    raw_members = rows_to_dicts(mastersheet["club member"])
    members: list[dict[str, str]] = []
    for r in raw_members:
        full_name = r["Name"]
        members.append({
            "member_id": r["Student_ID"],
            "full_name": full_name,
            "department": r["Committee"],
            "role": r["Role"],
            "email": r["Email"],
            "joined_date": excel_serial_to_iso(r["Join_Date"]),
            "gender": infer_gender(full_name),
            "year": parse_year(r["Year"]),
            "major": r["Department"],
            "member_status": r["Member_Status"],
        })
    return members


def build_events(
    projects_wb: dict[str, list[list[str]]],
    finance_wb: dict[str, list[list[str]]],
) -> list[dict[str, str]]:
    projects = rows_to_dicts(projects_wb["academic_club_projects"])
    fin_overall = {r["Project_ID"]: r for r in rows_to_dicts(finance_wb["overall"])}

    events: list[dict[str, str]] = []
    for p in projects:
        eid = p["Project_ID"]
        fin = fin_overall[eid]
        if eid in EVENT_DATE_OVERRIDES:
            start_iso, end_iso = EVENT_DATE_OVERRIDES[eid]
        else:
            start_iso = excel_serial_to_iso(p["Start_Date"])
            end_iso = excel_serial_to_iso(p["End_Date"]) or start_iso

        raw_status = p["Status"].strip().lower()
        status = EVENT_STATUS_MAP.get(raw_status, "Scheduled")

        events.append({
            "event_id": eid,
            "title": p["Project_Name"],
            "date": start_iso,
            "end_date": end_iso,
            "location": EVENT_LOCATIONS.get(eid, "Chula Engineering Building"),
            "description": p["Description"],
            "budget_planned": clean_num(fin["Total_Income"]),
            "status": status,
            "image_url": "",
        })
    return events


def build_attendance(
    members_wb: dict[str, list[list[str]]],
    members: list[dict[str, str]],
    events: list[dict[str, str]],
) -> list[dict[str, str]]:
    member_by_name = {m["full_name"]: m for m in members}
    event_start_by_id = {e["event_id"]: e["date"] for e in events}

    attendance: list[dict[str, str]] = []
    seq = 1
    for idx in range(1, 21):
        eid = f"AC-{idx:03d}"
        rows = rows_to_dicts(members_wb[eid])
        ev_date = event_start_by_id[eid]
        is_future_waiting = idx >= 17

        for row_idx, r in enumerate(rows, start=1):
            full_name = r["Name"]
            proj_role = r["Role"]
            participant_type = "Staff" if proj_role in STAFF_ROLES else "Participant"

            if "Department / Year" in r:
                parts = [p.strip() for p in r["Department / Year"].split("/", 1)]
                major = parts[0] if parts else ""
                year = parse_year(parts[1]) if len(parts) > 1 else ""
            else:
                major = r.get("Department", "")
                year = parse_year(r.get("Year", ""))

            matched = member_by_name.get(full_name)
            if matched:
                member_id = matched["member_id"]
                gender = matched["gender"]
            else:
                member_id = r["Student_ID"]
                gender = infer_gender(full_name)

            roll = deterministic_pct(f"{eid}:{row_idx}:{member_id}")
            if participant_type == "Staff":
                status = "Late" if roll < 10 else "Present"
            elif is_future_waiting:
                status = "Late" if roll >= 90 else "Present"
            else:
                if roll < 85:
                    status = "Present"
                elif roll < 95:
                    status = "Late"
                else:
                    status = "Absent"

            check_in_time = "" if status == "Absent" else f"{ev_date} 09:00"

            attendance.append({
                "attendance_id": f"ATT-{seq:04d}",
                "event_id": eid,
                "member_id": member_id,
                "full_name": full_name,
                "check_in_time": check_in_time,
                "status": status,
                "participant_type": participant_type,
                "project_role": proj_role,
                "gender": gender,
                "year": year,
                "major": major,
            })
            seq += 1

    return attendance


def build_budget(mastersheet: dict[str, list[list[str]]]) -> list[dict[str, str]]:
    tx_rows = rows_to_dicts(mastersheet["tx_id_finance"])
    budget: list[dict[str, str]] = []
    for idx, r in enumerate(tx_rows, start=1):
        tx_type = r["Type"]
        category = "Club Allocation" if tx_type == "Income" else (r.get("Expense_Type") or "Miscellaneous")
        budget.append({
            "expense_id": r["TX_ID"],
            "event_id": r["Project_ID"],
            "type": tx_type,
            "category": category,
            "amount": clean_num(r["Amount"]),
            "date": excel_serial_to_iso(r["Date"]),
            "receipt_ref": f"RC-2026-{idx:04d}",
        })
    return budget


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    default_src = repo_root.parent / "Mock-Data"
    default_out = repo_root / "sample-sheets"

    parser = argparse.ArgumentParser(description="Normalize Mock-Data xlsx files into 4 canonical CSVs.")
    parser.add_argument("--src", type=Path, default=default_src, help="Path to Mock-Data directory")
    parser.add_argument("--out", type=Path, default=default_out, help="Path to output sample-sheets directory")
    args = parser.parse_args()

    mastersheet = read_xlsx(args.src / "MASTERSHEET.xlsx")
    finance_wb = read_xlsx(args.src / "finance" / "budget_transactions.xlsx")
    projects_wb = read_xlsx(args.src / "sec" / "academic_club_projects.xlsx")
    members_wb = read_xlsx(args.src / "sec" / "academic_club_members.xlsx")

    members = build_members(mastersheet)
    events = build_events(projects_wb, finance_wb)
    attendance = build_attendance(members_wb, members, events)
    budget = build_budget(mastersheet)

    write_csv(
        args.out / "Members.csv",
        ["member_id", "full_name", "department", "role", "email", "joined_date", "gender", "year", "major", "member_status"],
        members,
    )
    write_csv(
        args.out / "Events.csv",
        ["event_id", "title", "date", "end_date", "location", "description", "budget_planned", "status", "image_url"],
        events,
    )
    write_csv(
        args.out / "Attendance.csv",
        ["attendance_id", "event_id", "member_id", "full_name", "check_in_time", "status", "participant_type", "project_role", "gender", "year", "major"],
        attendance,
    )
    write_csv(
        args.out / "Budget.csv",
        ["expense_id", "event_id", "type", "category", "amount", "date", "receipt_ref"],
        budget,
    )

    print(f"Wrote Members.csv: {len(members)} rows")
    print(f"Wrote Events.csv: {len(events)} rows")
    print(f"Wrote Attendance.csv: {len(attendance)} rows")
    print(f"Wrote Budget.csv: {len(budget)} rows")


if __name__ == "__main__":
    main()
