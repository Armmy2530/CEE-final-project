// Loaded synchronously in <head> so the saved theme is applied before first paint.
(function () {
  var KEY = 'theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function resolve() { var s = saved(); return s === 'light' || s === 'dark' ? s : (mq && mq.matches ? 'dark' : 'light'); }
  function apply() {
    var t = resolve();
    document.documentElement.setAttribute('data-theme', t);
    document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  window.setTheme = function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(); };
  window.getTheme = resolve;
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!saved()) apply(); });
  document.documentElement.setAttribute('data-theme', resolve());
})();
