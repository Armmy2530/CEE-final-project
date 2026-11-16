// Dependency-free interactive bar charts (SVG + HTML tooltip). Colors come from CSS classes,
// so switching theme needs no re-render. Used for "Attendance per event" and "Budget".
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / p;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * p;
  }
  function short(n) { return n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0).replace('.0', '') + 'k' : String(n); }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /**
   * cfg: { categories:[{label, note?, flag?}], series:[{key,name,cls,values[]}], format(v),
   *        yTitle, ariaLabel }
   */
  function renderBarChart(host, cfg) {
    host.textContent = '';
    if (!cfg.categories.length || !cfg.series.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = cfg.emptyText || 'No data to show.';
      host.appendChild(e);
      return;
    }
    var n = cfg.categories.length;
    var W = Math.max(host.clientWidth || 480, n * 56 + 60);
    var H = 300, m = { t: 16, r: 12, b: 84, l: 46 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = 0;
    cfg.series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    var top = niceMax(max * 1.08);
    var y = function (v) { return m.t + ih - (v / top) * ih; };

    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': cfg.ariaLabel || 'Chart' }, host);
    var ticks = [5, 4, 2, 3].filter(function (t) {
      var st = top / t, p = Math.pow(10, Math.floor(Math.log10(st))), f = Math.round((st / p) * 1000) / 1000;
      return f === 1 || f === 2 || f === 2.5 || f === 5;
    })[0] || 4;
    for (var i = 0; i <= ticks; i++) {
      var tv = (top / ticks) * i, ty = y(tv);
      el('line', { x1: m.l, x2: W - m.r, y1: ty, y2: ty, 'class': 'gridline' }, svg);
      var t = el('text', { x: m.l - 8, y: ty + 4, 'text-anchor': 'end', 'class': 'axis-text' }, svg);
      t.textContent = short(Math.round(tv * 10) / 10);
    }
    var band = iw / n, gap = 2;
    var vis = cfg.series.length;
    var bw = Math.min(cfg.maxBar || 28, (band * 0.7 - gap * (vis - 1)) / vis);
    var tip = host.querySelector('.chart-tooltip') || document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.hidden = true;
    host.appendChild(tip);

    function show(ci, cx) {
      var c = cfg.categories[ci];
      tip.textContent = '';
      var st = document.createElement('strong'); st.textContent = c.label; tip.appendChild(st);
      cfg.series.forEach(function (s) {
        var row = document.createElement('div'); row.className = 'row';
        var a = document.createElement('span');
        var sw = document.createElement('i'); sw.className = 'sw ' + s.cls; sw.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:2px';
        a.appendChild(sw); a.appendChild(document.createTextNode(s.name));
        var b = document.createElement('b'); b.textContent = cfg.format(s.values[ci]);
        row.appendChild(a); row.appendChild(b); tip.appendChild(row);
      });
      if (c.note) { var nt = document.createElement('div'); nt.className = 'note'; nt.textContent = c.note; tip.appendChild(nt); }
      tip.hidden = false;
      var tw = tip.offsetWidth;
      var left = Math.min(Math.max(cx - tw / 2, 4), host.scrollLeft + host.clientWidth - tw - 4);
      tip.style.left = Math.max(left, host.scrollLeft + 4) + 'px';
      tip.style.top = '4px';
    }
    function hide() { tip.hidden = true; }

    cfg.categories.forEach(function (c, ci) {
      var cx = m.l + band * ci + band / 2;
      var startX = cx - (vis * bw + gap * (vis - 1)) / 2;
      cfg.series.forEach(function (s, si) {
        var v = s.values[ci], bx = startX + si * (bw + gap), by = y(v), bh = m.t + ih - by;
        if (bh <= 0) return;
        var r = Math.min(4, bw / 2, bh);
        var d = 'M' + bx + ',' + (by + bh) + 'V' + (by + r) + 'Q' + bx + ',' + by + ' ' + (bx + r) + ',' + by +
          'H' + (bx + bw - r) + 'Q' + (bx + bw) + ',' + by + ' ' + (bx + bw) + ',' + (by + r) + 'V' + (by + bh) + 'Z';
        el('path', { d: d, 'class': s.cls === 'actual' ? 'bar-actual' : s.cls === 'planned' ? 'bar-planned' : 'bar-att' }, svg);
      });
      if (c.flag) {
        var fy = y(Math.max.apply(null, cfg.series.map(function (s) { return s.values[ci]; }))) - 6;
        var tri = el('path', { d: 'M' + cx + ',' + (fy - 9) + 'L' + (cx + 6) + ',' + fy + 'L' + (cx - 6) + ',' + fy + 'Z', 'class': 'flag-mark' }, svg);
        tri.setAttribute('aria-hidden', 'true');
      }
      var lx = cx, ly = m.t + ih + 14;
      var lab = el('text', { x: lx, y: ly, 'text-anchor': 'end', 'class': 'axis-text', transform: 'rotate(-35 ' + lx + ' ' + ly + ')' }, svg);
      lab.textContent = trunc(c.label, 16);
      var hit = el('rect', { x: m.l + band * ci, y: m.t, width: band, height: ih, 'class': 'hit', tabindex: 0,
        'aria-label': c.label + ': ' + cfg.series.map(function (s) { return s.name + ' ' + cfg.format(s.values[ci]); }).join(', ') + (c.note ? '. ' + c.note : '') }, svg);
      hit.addEventListener('mouseenter', function () { show(ci, cx); });
      hit.addEventListener('focus', function () { show(ci, cx); });
      hit.addEventListener('mouseleave', hide);
      hit.addEventListener('blur', hide);
    });
  }

  window.renderBarChart = renderBarChart;
})();
