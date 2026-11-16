// Project-name search with relevance ranking. Works in the browser (window.ProjectSearch)
// and in Node (require) so it can be unit-tested.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProjectSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lower-case, NFKC, strip Latin accents only (never Thai tone marks), collapse spaces.
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
      .replace(/\s+/g, ' ').trim();
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function isSubsequence(t, s) {
    var i = 0;
    for (var j = 0; j < s.length && i < t.length; j++) if (s[j] === t[i]) i++;
    return i === t.length;
  }

  // Score one query token against a (normalized) name. 0 = no match.
  function scoreToken(tok, name, words) {
    if (name === tok) return 100;
    if (name.indexOf(tok) === 0) return 92;
    var w;
    for (w = 0; w < words.length; w++) if (words[w].indexOf(tok) === 0) return 82 - Math.min(w, 5);
    var pos = name.indexOf(tok);
    if (pos > 0) return 66 - Math.min(pos, 20) / 2;
    if (tok.length >= 3) {
      var maxD = tok.length <= 5 ? 1 : 2, best = maxD + 1;
      for (w = 0; w < words.length; w++) {
        // compare with the word and with its same-length prefix (typo in the middle of a long word)
        var d = Math.min(lev(tok, words[w], maxD), lev(tok, words[w].slice(0, tok.length), maxD));
        if (d < best) best = d;
      }
      if (best <= maxD) return 48 - best * 10;
    }
    if (tok.length >= 3 && isSubsequence(tok, name)) return 20;
    return 0;
  }

  // Returns 0 when the query does not match; higher = more relevant.
  function score(query, name) {
    var q = norm(query), n = norm(name);
    if (!q) return 1;
    var words = n.split(' '), toks = q.split(' '), total = 0;
    for (var i = 0; i < toks.length; i++) {
      var s = scoreToken(toks[i], n, words);
      if (!s) return 0;                       // every word of the query must match something
      total += s;
    }
    var avg = total / toks.length;
    if (n.indexOf(q) === 0) avg += 6;         // whole phrase at the start of the name
    else if (n.indexOf(q) > 0) avg += 3;
    return avg;
  }

  // items: any objects; getName(item) -> project name. Best match first, ties by newest date.
  function rank(items, query, getName, getDate) {
    getName = getName || function (x) { return x.title; };
    getDate = getDate || function (x) { return x.date || ''; };
    if (!norm(query)) return items.slice();
    return items
      .map(function (it) { return { it: it, s: score(query, getName(it)) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s || (getDate(b.it) > getDate(a.it) ? 1 : -1); })
      .map(function (r) { return r.it; });
  }

  return { norm: norm, score: score, rank: rank };
});
