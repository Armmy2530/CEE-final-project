'use strict';
// Built-in MOCK data (fictional people only). Dates are relative to "today" so the
// demo always contains an upcoming event and budgets over 80%.
const { addDays } = require('./dates');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ploy', 'Nara', 'Mali', 'Kanda', 'Tawan', 'Pim', 'Arun', 'Fah', 'Ben', 'Nok', 'Ton', 'Mint',
  'Beam', 'Aom', 'Prae', 'Pat', 'Jin', 'Cream', 'Ice', 'Fern', 'Gun', 'Hana', 'Kluay', 'Dao'];
const GENDER = ['Female', 'Male', 'Female', 'Male', 'Female', 'Other', 'Male', 'Female'];
const MAJORS = ['Computer Engineering', 'Civil Engineering', 'Chemistry', 'Accounting', 'Design', 'Biology'];
const DEPTS = ['Academic', 'Events', 'Publicity', 'Finance', 'Logistics'];
const CATS = ['Venue', 'Food & Drink', 'Equipment', 'Printing', 'Transport', 'Prizes'];

// [title, startOffset, durationDays, status, planned, actualRatio, location, description]
const EVENT_DEFS = [
  ['Orientation Day', -80, 2, 'Completed', 8000, 0.78, 'Main Hall', 'Welcome event for new members: club tour, team games and a short talk about what the club does during the year.'],
  ['Welcome Workshop', -62, 1, 'Completed', 12000, 0.82, 'Room 301', 'Hands-on workshop on study planning and note-taking, run by senior members.'],
  ['Study Camp', -45, 3, 'Completed', 20000, 0.87, 'Hill Resort', 'Three-day overnight camp with tutoring sessions, group projects and evening activities before mid-term exams.'],
  ['Charity Run', -30, 1, 'Completed', 15000, 1.06, 'City Park', 'A 5 km fun run that raised funds for a school library. Includes registration, water stations and prizes.'],
  ['Career Talk', -18, 1, 'Completed', 6000, 0.52, 'Auditorium', 'Alumni speakers share how they found their first job and answer questions from members.'],
  ['Board Game Night', -9, 1, 'Cancelled', 3000, 0.1, 'Club Room', 'Casual evening of board games. Cancelled because the venue was no longer available.'],
  ['Photography Walk', 2, 1, 'Scheduled', 5000, 0.82, 'Old Town', 'Guided photo walk through the old town with a mini photo contest at the end.'],
  ['Mid-term Review Session', 12, 5, 'Scheduled', 7000, 0.17, 'Library Hall', 'Five days of review sessions for mid-term exams, one subject per day, led by volunteer tutors.'],
  ['Year-End Party', 26, 1, 'Scheduled', 25000, 0.12, 'Rooftop Garden', 'Celebration for all members with food, performances and awards for the year.'],
];

function generateMock(today) {
  const rand = rng(2026);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const Members = FIRST.map((name, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      member_id: `ST${n}`,
      full_name: `${name} Sample`,
      department: DEPTS[i % DEPTS.length],
      role: i === 0 ? 'President' : i === 1 ? 'Vice President' : i < 7 ? 'Head' : 'Member',
      email: `st${n}@example.com`,
      joined_date: addDays(today, -Math.floor(120 + rand() * 600)),
      gender: GENDER[(i * 3 + 1) % GENDER.length],
      year: String((i % 4) + 1),
      major: MAJORS[(i * 5 + 2) % MAJORS.length],
    };
  });

  const Events = EVENT_DEFS.map(([title, off, days, status, planned, , location, description], i) => ({
    event_id: `EV${String(i + 1).padStart(3, '0')}`,
    title,
    date: addDays(today, off),
    end_date: addDays(today, off + days - 1),
    location,
    description,
    budget_planned: planned,
    status,
    image_url: '',
  }));

  const Budget = [];
  let expenseNo = 1;
  EVENT_DEFS.forEach(([, , , , planned, ratio], i) => {
    const total = Math.round((planned * ratio) / 50) * 50;
    const parts = 2 + Math.floor(rand() * 3);
    let left = total;
    for (let p = 0; p < parts; p++) {
      const amount = p === parts - 1 ? left : Math.round((total * (0.2 + rand() * 0.25)) / 50) * 50;
      left -= amount;
      Budget.push({
        expense_id: `EX${String(expenseNo++).padStart(3, '0')}`,
        event_id: Events[i].event_id,
        category: CATS[(i + p) % CATS.length],
        amount,
        date: addDays(Events[i].date, Math.min(0, -Math.floor(rand() * 5))),
        receipt_ref: `RC-${2026}-${String(expenseNo).padStart(4, '0')}`,
      });
    }
  });

  const Attendance = [];
  let attNo = 1;
  const quality = [0.9, 0.7, 0.85, 0.6, 0.75];
  Events.forEach((ev, i) => {
    if (ev.status !== 'Completed') return;
    Members.forEach((m, mi) => {
      const isStaff = mi % 6 === i % 6;           // 4 staff members per project
      if (!isStaff && rand() > quality[i % quality.length] + 0.1) return;
      const r = rand();
      const status = isStaff ? (r < 0.9 ? 'Present' : 'Late') : r < 0.72 ? 'Present' : r < 0.84 ? 'Late' : 'Absent';
      Attendance.push({
        attendance_id: `AT${String(attNo++).padStart(4, '0')}`,
        event_id: ev.event_id,
        member_id: m.member_id,
        check_in_time: status === 'Absent' ? '' : `${ev.date} ${pick(['09', '10', '13', '14'])}:${pick(['00', '05', '10', '25'])}`,
        status,
        participant_type: isStaff ? 'Staff' : 'Participant',
      });
    });
  });

  return { Members, Events, Attendance, Budget };
}

module.exports = { generateMock };
