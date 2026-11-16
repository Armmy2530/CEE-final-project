(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { projectId: null, group: 'gender', user: null, dash: null, filter: 'all', calMonth: null, calSelected: null, hidden: {}, timer: null };

  // ---------- helpers ----------
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    [].concat(kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var baht = function (n) { return '฿' + Math.round(n).toLocaleString('en-US'); };
  var pct = function (x) { return x == null ? '–' : Math.round(x * 100) + '%'; };
  function fmtDate(s) {
    var p = s.split('-'); if (p.length !== 3) return s;
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function api(method, url, body) {
    var opt = { method: method, headers: {}, credentials: 'same-origin' };
    if (method !== 'GET') { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ---------- auth ----------
  var authMode = 'login';
  function setAuthMode(m) {
    authMode = m;
    $('modeLogin').setAttribute('aria-selected', m === 'login');
    $('modeSetup').setAttribute('aria-selected', m === 'setup');
    $('authTitle').textContent = m === 'login' ? 'Sign in' : 'Create your password';
    $('authPwLabel').textContent = m === 'login' ? 'Password' : 'New password';
    $('authPw').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('confirmRow').hidden = m === 'login';
    $('authSubmit').textContent = m === 'login' ? 'Sign in' : 'Create password & sign in';
    $('authError').hidden = true;
  }
  $('modeLogin').onclick = function () { setAuthMode('login'); };
  $('modeSetup').onclick = function () { setAuthMode('setup'); };
  $('authForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var id = $('authId').value.trim(), pw = $('authPw').value, err = $('authError');
    err.hidden = true;
    function bad(msg) { err.textContent = msg; err.hidden = false; }
    if (!id || !pw) return bad('Please enter your ID and password.');
    if (authMode === 'setup') {
      if (pw.length < 8) return bad('Password must be at least 8 characters.');
      if (pw !== $('authPw2').value) return bad('Passwords do not match.');
    }
    $('authSubmit').disabled = true;
    api('POST', authMode === 'login' ? '/api/auth/login' : '/api/auth/setup', { member_id: id, password: pw })
      .then(function (r) { $('authPw').value = ''; $('authPw2').value = ''; enterApp(r.user); })
      .catch(function (e) { bad(e.message); })
      .then(function () { $('authSubmit').disabled = false; });
  });

  function showAuth() {
    clearInterval(state.timer);
    $('appView').hidden = true; $('authView').hidden = false;
    setAuthMode('login');
  }
  $('logoutBtn').onclick = function () { api('POST', '/api/auth/logout').then(function () { state.user = null; state.dash = null; showAuth(); }); };

  function initials(name) { return name.split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase(); }

  function enterApp(user) {
    state.user = user;
    $('authView').hidden = true; $('appView').hidden = false;
    $('userInitials').textContent = initials(user.full_name);
    $('userName').textContent = user.full_name;
    $('userRole').textContent = user.role === 'admin' ? 'Admin' : 'Normal user';
    $('userMenuId').textContent = 'Signed in as ' + user.member_id;
    $('usersTab').hidden = user.role !== 'admin';
    $('chatLog').textContent = '';
    state.chatHistory = [];
    addMsg('bot', 'Hi ' + user.full_name.split(' ')[0] + '! Ask me about members, events, attendance or the budget.');
    showPage('summary');
    loadDashboard(false, true);
    clearInterval(state.timer);
    state.timer = setInterval(function () { if (!document.hidden) loadDashboard(false, false); }, 60000);
  }

  // ---------- navigation ----------
  function showPage(id) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.page === id); });
    document.querySelectorAll('.page-content').forEach(function (p) { p.hidden = p.id !== id; });
    if (id === 'users') loadUsers();
    if (id === 'summary' && state.dash) renderCharts();
    if (id === 'projects' && state.dash) { renderProject(); }
  }
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { showPage(t.dataset.page); }); });

  // ---------- popovers ----------
  function bindPopover(btn, panel) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.hidden;
      closePopovers();
      panel.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open && btn.id === 'bellBtn') markSeen();
    });
  }
  function closePopovers() {
    [['bellBtn', 'notifPanel'], ['userBtn', 'userMenu']].forEach(function (p) { $(p[1]).hidden = true; $(p[0]).setAttribute('aria-expanded', 'false'); });
  }
  bindPopover($('bellBtn'), $('notifPanel'));
  bindPopover($('userBtn'), $('userMenu'));
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu-wrap')) closePopovers(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePopovers(); $('chatPanel').hidden = true; $('chatFab').setAttribute('aria-expanded', 'false'); } });

  // ---------- theme ----------
  function syncThemeButtons() {
    var t = window.getTheme();
    $('themeLight').setAttribute('aria-pressed', String(t === 'light'));
    $('themeDark').setAttribute('aria-pressed', String(t === 'dark'));
  }
  $('themeLight').onclick = function () { window.setTheme('light'); };
  $('themeDark').onclick = function () { window.setTheme('dark'); };
  document.addEventListener('themechange', syncThemeButtons);
  syncThemeButtons();

  // ---------- dashboard ----------
  function loadDashboard(force, announce) {
    $('refreshBtn').disabled = true;
    return api('GET', '/api/dashboard' + (force ? '?refresh=1' : ''))
      .then(function (d) {
        state.dash = d;
        $('loadError').hidden = true;
        renderAll(announce);
      })
      .catch(function (e) {
        if (e.status === 401) { state.user = null; return showAuth(); }
        $('loadError').textContent = e.message + ' Showing the last data we have.';
        $('loadError').hidden = false;
        if (!state.dash) $('updatedText').textContent = 'Data unavailable';
      })
      .then(function () { $('refreshBtn').disabled = false; });
  }
  $('refreshBtn').onclick = function () { loadDashboard(true, false); };
  $('statusFilter').onchange = function () { state.filter = this.value; renderCharts(); };

  function renderAll(announce) {
    var d = state.dash;
    var when = new Date(d.meta.fetchedAt || Date.now());
    $('updatedText').textContent = 'Academic year ' + d.today.slice(0, 4) + ' - Last updated ' +
      when.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    var b = $('dataBanner');
    var msgs = [];
    if (d.meta.source === 'mock') msgs.push('Showing built-in mock data. Set GOOGLE_API_KEY and GOOGLE_SHEET_ID to connect Google Sheets.');
    if (d.meta.stale) msgs.push('Google Sheets could not be reached, so the last saved copy is shown.');
    b.textContent = msgs.join(' '); b.hidden = !msgs.length;
    renderMetrics(); renderCharts(); renderCalendar(); renderProject(); renderAlerts(announce);
  }

  function setMetric(id, value, sub) {
    var c = $(id); c.querySelector('.metric-value').textContent = value; c.querySelector('.metric-sub').textContent = sub;
  }
  function renderMetrics() {
    var m = state.dash.metrics, s = m.eventsByStatus;
    var depts = Object.keys(state.dash.membersByDepartment).length;
    setMetric('mMembers', m.members.toLocaleString('en-US'), 'in ' + depts + ' departments');
    setMetric('mEvents', m.events.toLocaleString('en-US'),
      (s.Completed || 0) + ' completed · ' + (s.Scheduled || 0) + ' scheduled · ' + (s.Cancelled || 0) + ' cancelled');
    setMetric('mBudget', baht(m.budgetActual), pct(m.budgetPct) + ' of ' + baht(m.budgetPlanned) + ' planned');
    var bar = $('mBudget').querySelector('.meter span');
    bar.style.width = Math.min(100, Math.round((m.budgetPct || 0) * 100)) + '%';
  }

  function filteredEvents() {
    var evs = state.dash.events.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    return state.filter === 'all' ? evs : evs.filter(function (e) { return e.status === state.filter; });
  }
  function makeTable(headers, rows) {
    var t = h('table', { 'class': 'data-table' });
    t.appendChild(h('thead', {}, h('tr', {}, headers.map(function (x) { return h('th', { text: x }); }))));
    t.appendChild(h('tbody', {}, rows.map(function (r) {
      return h('tr', {}, r.map(function (c, i) { return h('td', { text: c, 'class': i ? 'num' : '' }); }));
    })));
    return t;
  }
  function renderCharts() {
    if (!state.dash || $('summary').hidden) return;
    var evs = filteredEvents();
    // Attendance: only events that have attendance records
    var att = evs.filter(function (e) { return e.records > 0; });
    renderBarChart($('attChart'), {
      categories: att.map(function (e) { return { label: e.title, note: e.records + ' check-ins recorded' }; }),
      series: [{ key: 'att', name: 'Attendees', cls: 'att', values: att.map(function (e) { return e.attendees; }) }],
      format: function (v) { return v + ' people'; },
      ariaLabel: 'Bar chart of attendees for each event',
      emptyText: 'No attendance records for this filter.'
    });
    $('attTable').textContent = '';
    $('attTable').appendChild(makeTable(['Event', 'Attendees'], att.map(function (e) { return [e.title, String(e.attendees)]; })));

    var legend = $('budgetLegend'); legend.textContent = '';
    [['planned', 'Planned'], ['actual', 'Actual']].forEach(function (s) {
      var b = h('button', { type: 'button', 'aria-pressed': String(!state.hidden[s[0]]) }, [h('span', { 'class': 'sw ' + s[0] }), s[1]]);
      b.onclick = function () {
        var other = s[0] === 'planned' ? 'actual' : 'planned';
        if (!state.hidden[s[0]] && state.hidden[other]) return; // keep at least one series
        state.hidden[s[0]] = !state.hidden[s[0]]; renderCharts();
      };
      legend.appendChild(b);
    });
    legend.appendChild(h('span', { 'class': 'flag', title: 'Actual spending is at least 80% of plan' }, [
      (function () { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '12'); s.setAttribute('height', '12'); s.setAttribute('viewBox', '0 0 12 12');
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M6 1L11 11H1Z'); p.setAttribute('style', 'fill:var(--crit)'); s.appendChild(p); return s; })(),
      '≥ 80% of plan']));
    var series = [];
    if (!state.hidden.planned) series.push({ key: 'planned', name: 'Planned', cls: 'planned', values: evs.map(function (e) { return e.budget_planned; }) });
    if (!state.hidden.actual) series.push({ key: 'actual', name: 'Actual', cls: 'actual', values: evs.map(function (e) { return e.actual; }) });
    renderBarChart($('budgetChart'), {
      categories: evs.map(function (e) {
        var flag = e.status !== 'Cancelled' && e.pct != null && e.pct >= 0.8;
        return { label: e.title, flag: flag, note: flag ? (e.pct >= 1 ? 'Over budget: ' : 'At ') + pct(e.pct) + ' of plan' : (e.status === 'Cancelled' ? 'Cancelled' : '') };
      }),
      series: series,
      format: baht,
      ariaLabel: 'Grouped bar chart comparing planned and actual budget for each event',
      emptyText: 'No events for this filter.'
    });
    $('budgetTable').textContent = '';
    $('budgetTable').appendChild(makeTable(['Event', 'Planned', 'Actual', '% used'],
      evs.map(function (e) { return [e.title, baht(e.budget_planned), baht(e.actual), pct(e.pct)]; })));
  }
  var rzTimer;
  window.addEventListener('resize', function () { clearTimeout(rzTimer); rzTimer = setTimeout(function () { renderCharts(); drawProjectCharts(); }, 150); });

  // ---------- calendar ----------
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $('calDow').appendChild(document.createDocumentFragment());
  DOW.forEach(function (d) { $('calDow').appendChild(h('div', { text: d })); });
  function pad(n) { return String(n).padStart(2, '0'); }
  function renderCalendar() {
    var d = state.dash;
    if (!state.calMonth) state.calMonth = d.today.slice(0, 7);
    var parts = state.calMonth.split('-'), y = +parts[0], mo = +parts[1] - 1;
    $('calTitle').textContent = MONTHS[mo] + ' ' + y;
    var first = new Date(Date.UTC(y, mo, 1)), start = new Date(first.getTime() - first.getUTCDay() * 86400000);
    var byDate = {};
    d.events.forEach(function (e) {
      var days = projectDaysOf(e);
      days.forEach(function (day, i) { (byDate[day] = byDate[day] || []).push(Object.assign({}, e, { dayNo: i + 1, dayCount: days.length })); });
    });
    var grid = $('calGrid'); grid.textContent = '';
    for (var i = 0; i < 42; i++) {
      var dt = new Date(start.getTime() + i * 86400000);
      var key = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
      if (i >= 35 && dt.getUTCMonth() !== mo) break;
      var evs = byDate[key] || [];
      var cell = h('button', { type: 'button', 'class': 'cal-cell' + (dt.getUTCMonth() !== mo ? ' other' : '') + (key === d.today ? ' today' : '') + (key === state.calSelected ? ' selected' : ''),
        'aria-label': fmtDate(key) + (evs.length ? ': ' + evs.map(function (e) { return e.title + (e.dayCount > 1 ? ' day ' + e.dayNo + ' of ' + e.dayCount : '') + ' (' + e.status + ')'; }).join(', ') : ': no events') }, [
        h('span', { 'class': 'cal-num', text: String(dt.getUTCDate()) })]);
      evs.slice(0, 2).forEach(function (e) { cell.appendChild(h('span', { 'class': 'chip ' + e.status, text: (e.status === 'Completed' ? '✓ ' : '') + e.title + (e.dayCount > 1 ? ' (' + e.dayNo + '/' + e.dayCount + ')' : '') })); });
      if (evs.length > 2) cell.appendChild(h('span', { 'class': 'cal-more', text: '+' + (evs.length - 2) + ' more' }));
      if (evs.length) cell.appendChild(h('span', { 'class': 'cal-dots' }, evs.map(function () { return h('i'); })));
      (function (k) { cell.onclick = function () { state.calSelected = k; renderCalendar(); }; })(key);
      grid.appendChild(cell);
    }
    var det = $('calDetail'); det.textContent = '';
    var sel = state.calSelected;
    if (sel) {
      det.appendChild(h('strong', { text: fmtDate(sel) }));
      var list = byDate[sel] || [];
      if (!list.length) det.appendChild(h('p', { 'class': 'muted', text: 'No events on this day.' }));
      else det.appendChild(h('ul', {}, list.map(function (e) {
        return h('li', {}, [h('span', {}, [h('strong', { text: e.title }), ' · ' + e.location]), h('span', { 'class': 'muted', text: e.status + ' · ' + baht(e.budget_planned) + ' planned' })]);
      })));
    } else {
      det.appendChild(h('p', { 'class': 'muted', text: 'Select a day to see its events.' }));
    }
  }
  function shiftMonth(delta) {
    var p = state.calMonth.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1 + delta, 1));
    state.calMonth = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1); renderCalendar();
  }
  $('calPrev').onclick = function () { shiftMonth(-1); };
  $('calNext').onclick = function () { shiftMonth(1); };
  $('calToday').onclick = function () { state.calMonth = state.dash.today.slice(0, 7); state.calSelected = state.dash.today; renderCalendar(); };

  // ---------- project data (list + detail, per the Project Tab mockup) ----------
  var STATUS_TH = { Scheduled: 'ดำเนินการ', Completed: 'ปิดโครงการ', Cancelled: 'ยกเลิก' };
  var STATUS_EN = { Scheduled: 'In progress', Completed: 'Closed', Cancelled: 'Cancelled' };
  function statusBadge(st) {
    return h('span', { 'class': 'badge st-' + st, title: STATUS_EN[st] || st, text: STATUS_TH[st] || st });
  }
  function fmtRange(ev) {
    return ev.end_date && ev.end_date !== ev.date ? fmtDate(ev.date) + ' – ' + fmtDate(ev.end_date) : fmtDate(ev.date);
  }
  function avatar(ev, big) {
    var box = h('span', { 'class': 'avatar' + (big ? ' big' : ''), 'aria-hidden': 'true' });
    if (ev.image_url) {
      var img = h('img', { src: ev.image_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.onerror = function () { img.remove(); box.textContent = ev.title.trim().slice(0, 1).toUpperCase(); };
      box.appendChild(img);
    } else box.textContent = ev.title.trim().slice(0, 1).toUpperCase();
    return box;
  }

  function projectList() {
    var q = $('projectSearch').value, sort = $('projectSort').value;
    var all = state.dash.events.slice();
    var byDateDesc = function (a, b) { return b.date.localeCompare(a.date); };
    var items;
    if (sort === 'relevance') {
      items = q.trim() ? window.ProjectSearch.rank(all, q, function (e) { return e.title; }, function (e) { return e.date; }) : all.sort(byDateDesc);
    } else {
      items = q.trim() ? window.ProjectSearch.rank(all, q, function (e) { return e.title; }) : all;   // filter by match, then sort
      items = items.slice();
      if (sort === 'newest') items.sort(byDateDesc);
      else if (sort === 'oldest') items.sort(function (a, b) { return a.date.localeCompare(b.date); });
      else items.sort(function (a, b) { return a.title.localeCompare(b.title, 'th'); });
    }
    return { items: items, total: all.length, query: q.trim() };
  }

  function renderProjectList() {
    var r = projectList(), box = $('projectCards'); box.textContent = '';
    $('projectCount').textContent = r.query ? r.items.length + ' of ' + r.total + ' projects match "' + r.query + '"' : r.total + ' projects';
    if (!r.items.length) {
      var clear = h('button', { 'class': 'btn small', type: 'button', text: 'Clear search' });
      clear.onclick = function () { $('projectSearch').value = ''; renderProjectList(); $('projectSearch').focus(); };
      box.appendChild(h('div', { 'class': 'empty-card' }, [h('p', { text: 'No project matches "' + r.query + '".' }), clear]));
      return;
    }
    r.items.forEach(function (ev) {
      var card = h('button', { type: 'button', 'class': 'pcard', 'aria-label': ev.title + ', ' + fmtRange(ev) + ', ' + (STATUS_EN[ev.status] || ev.status) }, [
        h('span', { 'class': 'pcard-title', text: ev.title }),
        h('span', { 'class': 'pcard-date', text: '• ' + fmtRange(ev) }),
        statusBadge(ev.status)]);
      card.onclick = function () { openProject(ev.event_id); };
      box.appendChild(card);
    });
  }
  $('projectSearch').addEventListener('input', renderProjectList);
  $('projectSort').addEventListener('change', renderProjectList);

  function openProject(id) { state.projectId = id; renderProjectDetail(); window.scrollTo(0, 0); var b = $('projectDetail').querySelector('.back-btn'); if (b) b.focus(); }
  function closeProject() { state.projectId = null; renderProject(); var s = $('projectSearch'); if (s) s.focus(); }

  function renderProject() {
    if (state.projectId && !state.dash.events.some(function (e) { return e.event_id === state.projectId; })) state.projectId = null;
    $('projectList').hidden = !!state.projectId;
    $('projectDetail').hidden = !state.projectId;
    if (state.projectId) renderProjectDetail(); else renderProjectList();
  }

  function section(title, sub, kids) {
    return h('section', { 'class': 'card pd-section' }, [
      h('div', { 'class': 'card-head' }, [h('h2', { text: title }), sub ? h('span', { 'class': 'hint', text: sub }) : null]), kids]);
  }
  function fact(label, value) { return h('div', { 'class': 'fact' }, [h('dt', { text: label }), h('dd', {}, [].concat(value))]); }
  function stat(label, value, sub) { return h('div', { 'class': 'stat' }, [h('span', { 'class': 'stat-label', text: label }), h('strong', { text: value }), sub ? h('small', { text: sub }) : null]); }
  function legendFor(items) {
    return h('div', { 'class': 'legend' }, items.map(function (i) { return h('span', { 'class': 'flag' }, [h('span', { 'class': 'sw ' + i[0] }), i[1]]); }));
  }

  function projectDaysOf(ev) {
    var out = [], d = ev.date, n = 0;
    while (d && d <= (ev.end_date || ev.date) && n < 120) { out.push(d); d = addDayStr(d, 1); n++; }
    return out;
  }
  function addDayStr(s, n) {
    var p = s.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function renderProjectDetail() {
    var d = state.dash, ev = d.events.filter(function (e) { return e.event_id === state.projectId; })[0];
    if (!ev) return;
    $('projectList').hidden = true; $('projectDetail').hidden = false;
    var root = $('projectDetail'); root.textContent = '';

    var back = h('button', { 'class': 'btn back-btn', type: 'button', text: '← All projects' });
    back.onclick = closeProject;
    root.appendChild(h('div', { 'class': 'detail-top' }, back));

    // 1) name / picture / detail / location / status / date / planned budget
    root.appendChild(h('article', { 'class': 'card pd-head' }, [
      h('div', { 'class': 'pd-title' }, [avatar(ev, true), h('div', {}, [h('h1', { text: ev.title }), statusBadge(ev.status)])]),
      h('p', { 'class': 'pd-detail', text: ev.description || 'No description yet.' }),
      h('dl', { 'class': 'facts-row' }, [
        fact('Location', ev.location || '–'),
        fact('Status', STATUS_TH[ev.status] + ' (' + (STATUS_EN[ev.status] || ev.status) + ')'),
        fact('Date', fmtRange(ev)),
        fact('Planned budget', baht(ev.budget_planned))])]));

    // 2) Detail: numbers at a glance
    var st = ev.stats;
    root.appendChild(section('Detail', 'Numbers at a glance', h('div', { 'class': 'stats' }, [
      stat('Staff', String(st.staff)),
      stat('Participants', String(st.participants)),
      stat('Attended', String(st.attended), st.attendanceRate == null ? 'no check-ins yet' : pct(st.attendanceRate) + ' of participants'),
      stat('Budget used', pct(ev.pct), baht(ev.actual) + ' of ' + baht(ev.budget_planned)),
      stat('Duration', ev.days + (ev.days === 1 ? ' day' : ' days'))])));

    // 3) Project date: Day 1 ... Day n
    var days = projectDaysOf(ev);
    var grid = h('ol', { 'class': 'daygrid' }, days.map(function (day, i) {
      var cls = day === d.today ? 'today' : day < d.today ? 'past' : 'future';
      return h('li', { 'class': 'day ' + cls, 'aria-label': 'Day ' + (i + 1) + ', ' + fmtDate(day) + (day === d.today ? ', today' : '') }, [
        h('b', { text: 'Day ' + (i + 1) }),
        h('span', { text: new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) })]);
    }));
    root.appendChild(section('Project date', days.length === 1 ? '1 day' : 'Day 1 – Day ' + days.length, grid));

    // 4) Staff, participants
    function people(list, withStatus) {
      if (!list.length) return h('p', { 'class': 'muted', text: 'No one recorded yet.' });
      return h('ul', { 'class': 'people' }, list.map(function (p) {
        return h('li', {}, [h('span', {}, [h('strong', { text: p.name }), p.department ? h('small', { text: ' · ' + p.department }) : null]),
          withStatus ? h('span', { 'class': 'badge as-' + p.status, text: p.status }) : null]);
      }));
    }
    root.appendChild(section('Staff, participants', st.staff + ' staff · ' + st.participants + ' participants', h('div', { 'class': 'two-col' }, [
      h('div', {}, [h('h3', { text: 'Staff' }), people(ev.staff, false)]),
      h('div', {}, [h('h3', { text: 'Participants' }), people(ev.participants, true)])])));

    // 5) Attendance - this year's data only, drop-down: gender / year / major
    var sel = h('select', { id: 'groupBy', 'aria-label': 'Display attendance by' }, [
      h('option', { value: 'gender', text: 'Gender' }), h('option', { value: 'year', text: 'Year' }), h('option', { value: 'major', text: 'Major' })]);
    sel.value = state.group;
    var attHost = h('div', { 'class': 'chart', id: 'pdAtt' }), attTable = h('div', { id: 'pdAttTable' });
    sel.onchange = function () { state.group = sel.value; drawAttendance(ev); };
    root.appendChild(h('section', { 'class': 'card pd-section' }, [
      h('div', { 'class': 'card-head' }, [h('h2', { text: 'Attendance' }),
        h('label', { 'class': 'inline-select' }, ['Display by ', sel])]),
      h('p', { 'class': 'hint', text: 'This year only (' + ev.breakdownYear + ') · counts people who checked in (Present or Late)' }),
      attHost, h('details', { 'class': 'table-view' }, [h('summary', { text: 'View as table' }), attTable])]));

    // 6) Budget: actual vs planned
    var budHost = h('div', { 'class': 'chart', id: 'pdBud' }), budTable = h('div', { id: 'pdBudTable' });
    var note = null;
    if (ev.status !== 'Cancelled' && ev.pct != null && ev.pct >= 0.8) {
      note = h('p', { 'class': 'banner ' + (ev.pct >= 1 ? 'error' : ''), text: (ev.pct >= 1 ? '! Over budget: ' : '! Budget alert: ') + pct(ev.pct) + ' of the planned budget has been used.' });
    }
    root.appendChild(h('section', { 'class': 'card pd-section' }, [
      h('div', { 'class': 'card-head' }, [h('h2', { text: 'Budget' }), legendFor([['planned', 'Planned'], ['actual', 'Actual']])]),
      h('p', { 'class': 'hint', text: 'Actual vs planned budget (ใช้จริง, ที่ประมาณไว้)' }),
      note, budHost, h('details', { 'class': 'table-view' }, [h('summary', { text: 'View as table' }), budTable])]));

    drawProjectCharts();
  }

  function drawAttendance(ev) {
    var g = ev.breakdown[state.group] || {}, keys = Object.keys(g);
    if (state.group === 'year') keys.sort(); else keys.sort(function (a, b) { return g[b] - g[a] || a.localeCompare(b); });
    renderBarChart($('pdAtt'), {
      categories: keys.map(function (k) { return { label: k }; }),
      series: [{ key: 'att', name: 'Attendees', cls: 'att', values: keys.map(function (k) { return g[k]; }) }],
      format: function (v) { return v + (v === 1 ? ' person' : ' people'); }, maxBar: 56,
      ariaLabel: 'Attendees of ' + ev.title + ' by ' + state.group,
      emptyText: 'No attendance data for this year.'
    });
    var t = $('pdAttTable'); t.textContent = '';
    if (keys.length) t.appendChild(makeTable([state.group.charAt(0).toUpperCase() + state.group.slice(1), 'Attendees'], keys.map(function (k) { return [k, String(g[k])]; })));
  }
  function drawBudget(ev) {
    renderBarChart($('pdBud'), {
      categories: [{ label: ev.title }],
      series: [{ key: 'planned', name: 'Planned', cls: 'planned', values: [ev.budget_planned] }, { key: 'actual', name: 'Actual', cls: 'actual', values: [ev.actual] }],
      format: baht, maxBar: 72, ariaLabel: 'Planned versus actual budget of ' + ev.title,
      emptyText: 'No budget data.'
    });
    var t = $('pdBudTable'); t.textContent = '';
    t.appendChild(makeTable(['', 'Amount'], [['Planned', baht(ev.budget_planned)], ['Actual', baht(ev.actual)], ['% used', pct(ev.pct)]]));
  }
  function drawProjectCharts() {
    if (!state.projectId || $('projects').hidden || !state.dash) return;
    var ev = state.dash.events.filter(function (e) { return e.event_id === state.projectId; })[0];
    if (!ev || !$('pdAtt')) return;
    drawAttendance(ev); drawBudget(ev);
  }

  // ---------- alerts / notifications ----------
  function seenKey() { return 'seenAlerts:' + state.user.member_id; }
  function seenSet() { try { return JSON.parse(lsGet(seenKey()) || '[]'); } catch (e) { return []; } }
  function alertSig(a) { return a.id + '@' + a.title; }
  function markSeen() {
    lsSet(seenKey(), JSON.stringify(state.dash.alerts.map(alertSig)));
    $('bellDot').hidden = true;
  }
  var ICON = { critical: '!', warning: '!', info: 'i' };
  function renderAlerts(announce) {
    var alerts = state.dash.alerts, seen = seenSet();
    var fresh = alerts.filter(function (a) { return seen.indexOf(alertSig(a)) < 0; });
    $('bellDot').hidden = !fresh.length || !$('notifPanel').hidden;
    $('bellBtn').setAttribute('aria-label', 'Notifications' + (alerts.length ? ', ' + alerts.length + ' active' : ', none'));
    $('notifCount').textContent = alerts.length + ' active';
    var ul = $('notifList'); ul.textContent = '';
    if (!alerts.length) ul.appendChild(h('li', { 'class': 'notif-empty', text: 'All clear. Nothing needs attention.' }));
    alerts.forEach(function (a) {
      ul.appendChild(h('li', { 'class': 'notif-item' }, [
        h('span', { 'class': 'sev ' + a.severity, 'aria-hidden': 'true', text: ICON[a.severity] }),
        h('div', {}, [h('strong', { text: a.title }), h('span', { 'class': 'nmsg', text: a.message })])]));
    });
    if (announce && fresh.length) {
      var worst = fresh.some(function (a) { return a.severity === 'critical'; });
      toast(fresh.length + (fresh.length === 1 ? ' alert needs' : ' alerts need') + ' your attention', fresh[0].title + (fresh.length > 1 ? ' and ' + (fresh.length - 1) + ' more' : ''), worst ? 'critical' : 'warning');
    }
  }
  function toast(title, body, sev) {
    var t = h('div', { 'class': 'toast ' + sev, role: 'status' });
    var view = h('button', { 'class': 'link', type: 'button', text: 'View' });
    var close = h('button', { 'class': 'icon-btn', type: 'button', 'aria-label': 'Dismiss', text: '×' });
    t.appendChild(h('span', { 'class': 'sev ' + sev, 'aria-hidden': 'true', text: '!' }));
    t.appendChild(h('div', {}, [h('strong', { text: title }), h('div', { text: body }), view]));
    t.appendChild(close);
    var rm = function () { t.remove(); };
    close.onclick = rm;
    view.onclick = function () { rm(); $('bellBtn').click(); };
    $('toasts').appendChild(t);
    setTimeout(rm, 9000);
  }

  // ---------- admin: users ----------
  function userMsg(text, err) { var m = $('userMsg'); m.textContent = text; m.className = 'form-note' + (err ? ' err' : ''); m.hidden = !text; }
  function renderUsers(users) {
    var tb = $('userRows'); tb.textContent = '';
    users.forEach(function (u) {
      var self = u.member_id === state.user.member_id;
      var reset = h('button', { 'class': 'btn small', type: 'button', text: 'Reset password' });
      var del = h('button', { 'class': 'btn small danger', type: 'button', text: 'Delete' });
      if (self) del.disabled = true;
      reset.onclick = function () {
        if (!confirm('Reset the password of ' + u.member_id + '? They will create a new one at next sign-in.')) return;
        api('POST', '/api/admin/users/' + encodeURIComponent(u.member_id) + '/reset').then(function (r) { renderUsers(r.users); userMsg('Password reset for ' + u.member_id + '.'); }).catch(function (e) { userMsg(e.message, true); });
      };
      del.onclick = function () {
        if (!confirm('Delete user ' + u.member_id + ' (' + u.full_name + ')? This cannot be undone.')) return;
        api('DELETE', '/api/admin/users/' + encodeURIComponent(u.member_id)).then(function (r) { renderUsers(r.users); userMsg('Deleted ' + u.member_id + '.'); }).catch(function (e) { userMsg(e.message, true); });
      };
      tb.appendChild(h('tr', {}, [
        h('td', { text: u.member_id }), h('td', { text: u.full_name + (self ? ' (you)' : '') }),
        h('td', {}, h('span', { 'class': 'badge' + (u.role === 'admin' ? ' admin' : ''), text: u.role === 'admin' ? 'Admin' : 'Normal user' })),
        h('td', {}, h('span', { 'class': 'badge ' + (u.has_password ? 'ok' : 'wait'), text: u.has_password ? 'Active' : 'Waiting for first sign-in' })),
        h('td', { 'class': 'right' }, [reset, ' ', del])]));
    });
  }
  function loadUsers() {
    if (state.user.role !== 'admin') return;
    api('GET', '/api/admin/users').then(function (r) { renderUsers(r.users); }).catch(function (e) { userMsg(e.message, true); });
  }
  $('addUserForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = { member_id: $('newId').value.trim(), full_name: $('newName').value.trim(), role: $('newRole').value };
    if (!body.member_id || !body.full_name) return userMsg('Enter both an ID and a name.', true);
    api('POST', '/api/admin/users', body).then(function (r) {
      renderUsers(r.users); userMsg('Added ' + body.member_id + '. They can now use "First time? Create password".');
      $('newId').value = ''; $('newName').value = '';
    }).catch(function (e) { userMsg(e.message, true); });
  });

  // ---------- chat ----------
  var CHIPS = ['Budget status', 'Upcoming events', 'Best attendance', 'จำนวนสมาชิก'];
  function addMsg(who, text, cls) { var m = h('div', { 'class': 'msg ' + who + (cls ? ' ' + cls : ''), text: text }); $('chatLog').appendChild(m); $('chatLog').scrollTop = 1e6; return m; }
  CHIPS.forEach(function (c) { var b = h('button', { type: 'button', text: c }); b.onclick = function () { ask(c); }; $('chatChips').appendChild(b); });
  function setChat(open) { $('chatPanel').hidden = !open; $('chatFab').setAttribute('aria-expanded', String(open)); if (open) $('chatInput').focus(); }
  $('chatFab').onclick = function () { setChat($('chatPanel').hidden); };
  $('chatClose').onclick = function () { setChat(false); $('chatFab').focus(); };
  var asking = false;
  function ask(text) {
    if (asking || !text.trim()) return;
    asking = true; addMsg('user', text); $('chatInput').value = '';
    var wait = addMsg('bot', 'Thinking…', 'typing');
    api('POST', '/api/chat', { message: text, history: state.chatHistory })
      .then(function (r) {
        wait.remove(); addMsg('bot', r.reply || '(no answer)');
        state.chatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply || '' });
        $('chatMode').textContent = r.mode === 'ai' ? 'AI answers from the sheet data' : 'Offline mode (no AI key configured)';
      })
      .catch(function (e) { wait.remove(); addMsg('bot', 'Sorry, ' + e.message); })
      .then(function () { asking = false; });
  }
  $('chatForm').addEventListener('submit', function (ev) { ev.preventDefault(); ask($('chatInput').value); });

  // ---------- boot ----------
  api('GET', '/api/me').then(function (r) { enterApp(r.user); }).catch(showAuth);
})();
