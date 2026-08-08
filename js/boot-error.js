// Loaded as a classic script before the modules, so it is already listening if
// module loading itself fails.
//
// A failed import leaves the stage black and silent, which mid-set is
// indistinguishable from a dead projector or an unplugged HDMI cable. The most
// common cause is a browser running a cached copy of one module against a fresh
// copy of another, which reports as a missing export for a symbol that is
// plainly there on disk — so the hint names the fix.

(function () {
  'use strict';

  var shown = false;

  function show(text) {
    if (shown) return;
    var box = document.getElementById('error') || document.getElementById('notice');
    if (!box) return;
    shown = true;
    box.textContent = text + ' — try a hard reload (Cmd+Shift+R).';
    box.hidden = false;
    var hud = document.getElementById('hud');
    if (hud) hud.classList.remove('hidden');
  }

  // Capture phase: resource load failures do not bubble.
  window.addEventListener('error', function (event) {
    if (event.message) return show(event.message);
    var el = event.target;
    if (el && el.tagName === 'SCRIPT') show('Could not load ' + (el.src || 'a script'));
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    show((reason && reason.message) || String(reason) || 'Startup failed');
  });
}());
