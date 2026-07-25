//! The two chunks of front-end the shell owns: the offline splash, and the
//! script that turns the deck's decorative titlebar into a real one.

/// Shown until the server answers, and again if it goes away.
/// `__NEONAMP_URL__` is substituted at load time.
pub const SPLASH: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NEONAMP</title>
<style>
  :root {
    --void: #07040f; --panel: #0d0820; --panel2: #150c30;
    --line: #2b1b55; --line2: #3d2a75;
    --cyan: #21e6c1; --mag: #ff4f9a; --amber: #ffb24d;
    --text: #cfd6f2; --dim: #6f6d99;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: var(--text);
    background:
      radial-gradient(1100px 520px at 50% -10%, #1b0f3d 0%, transparent 60%),
      radial-gradient(900px 600px at 85% 110%, rgba(255, 79, 154, .10) 0%, transparent 55%),
      var(--void);
    display: flex; flex-direction: column;
    overflow: hidden; user-select: none; cursor: default;
  }
  /* perspective floor grid, same trick as the deck */
  body::before {
    content: ''; position: fixed; left: 0; right: 0; bottom: 0; height: 42vh;
    pointer-events: none;
    background:
      repeating-linear-gradient(to top, rgba(33, 230, 193, .14) 0 1px, transparent 1px 44px),
      repeating-linear-gradient(to right, rgba(255, 79, 154, .10) 0 1px, transparent 1px 54px);
    transform: perspective(420px) rotateX(58deg); transform-origin: bottom;
    -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,.9), transparent 85%);
  }

  .titlebar {
    display: flex; align-items: center; gap: 12px; padding: 9px 14px;
    background: linear-gradient(180deg, var(--panel2), var(--panel));
    border-bottom: 1px solid var(--line2);
    flex: none; position: relative; z-index: 2;
  }
  .logo {
    font-family: 'Orbitron', 'Segoe UI', sans-serif; font-weight: 900;
    font-size: 17px; letter-spacing: 3px; color: var(--cyan);
    text-shadow: 0 0 12px rgba(33, 230, 193, .55);
  }
  .logo em { font-style: normal; color: var(--mag); text-shadow: 0 0 12px rgba(255, 79, 154, .55); }
  .tag { font-size: 11px; letter-spacing: 2px; color: var(--dim); text-transform: uppercase; }
  .winbtns { margin-left: auto; display: flex; gap: 6px; }
  .winbtns i { width: 9px; height: 9px; border: 1px solid var(--line2); background: var(--panel); }
  .winbtns i:nth-child(1) { border-color: var(--cyan); }
  .winbtns i:nth-child(2) { border-color: var(--amber); }
  .winbtns i:nth-child(3) { border-color: var(--mag); }

  main {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px;
    padding: 24px; text-align: center; position: relative; z-index: 1;
  }
  .status {
    font-family: 'Consolas', monospace; font-size: 15px; letter-spacing: 4px;
    text-transform: uppercase; color: var(--cyan);
    text-shadow: 0 0 14px rgba(33, 230, 193, .5);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) {
    .status, .bar span { animation: none; }
  }

  .bar {
    width: min(280px, 70vw); height: 4px; background: #060312;
    border: 1px solid var(--line); overflow: hidden;
  }
  .bar span {
    display: block; width: 34%; height: 100%;
    background: linear-gradient(90deg, transparent, var(--cyan), transparent);
    animation: sweep 1.5s linear infinite;
  }
  @keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(390%); } }

  .url {
    font-family: 'Consolas', monospace; font-size: 12px; color: var(--text);
    background: #060312; border: 1px solid var(--line);
    padding: 7px 12px; letter-spacing: 1px; user-select: text; cursor: text;
    max-width: 90vw; overflow-wrap: anywhere;
  }
  .hint { font-size: 12px; color: var(--dim); line-height: 1.7; letter-spacing: .5px; }
  .hint code {
    font-family: 'Consolas', monospace; color: var(--amber);
    background: rgba(255, 178, 77, .08); padding: 1px 6px; border: 1px solid rgba(255, 178, 77, .25);
  }
</style>
</head>
<body>
  <header class="titlebar">
    <span class="logo">NEON<em>AMP</em></span>
    <span class="tag">insert3coins edition</span>
    <span class="winbtns" aria-hidden="true"><i></i><i></i><i></i></span>
  </header>
  <main>
    <div class="status">Waiting for server</div>
    <div class="bar"><span></span></div>
    <div class="url">__NEONAMP_URL__</div>
    <p class="hint">
      Start the deck with <code>npm start</code> in the NEONAMP folder.<br>
      This window connects on its own the moment the server answers.
    </p>
  </main>
</body>
</html>
"#;

/// Injected into every page the webview loads, splash and deck alike.
///
/// The deck already draws a titlebar with three decorative dots
/// (`public/index.html`); rather than restyle anything we adopt that markup —
/// the bar becomes the drag region and the dots become minimize / maximize /
/// close, tinted by whichever theme is active.
pub const INIT_SCRIPT: &str = r#"
(function () {
  if (window.__neonampShell) return;
  window.__neonampShell = true;

  var send = function (msg) {
    if (window.ipc && window.ipc.postMessage) window.ipc.postMessage(msg);
  };
  // The shell hit-tests in physical pixels; page coordinates are CSS pixels.
  var phys = function (n) { return Math.round(n * (window.devicePixelRatio || 1)); };

  var BUTTONS = [
    { action: 'minimize', label: 'Minimize' },
    { action: 'maximize', label: 'Maximize' },
    { action: 'close',    label: 'Close' }
  ];

  // ── popups go to the browser ──────────────────────────────────────────
  // MANAGE and friends are full pages that want room and a URL bar, and they
  // drive the deck over /ws rather than through this window handle, so the
  // browser serves them better than a 476px player.
  //
  // This has to be intercepted here and not only in the shell: openers such
  // as app.js's openPlaylistManager fall back to `location.href = url` when
  // window.open returns null, which would send the very same page to the
  // browser a second time. Returning a stub keeps that fallback asleep.
  var nativeOpen = window.open;
  window.open = function (url) {
    if (!url) return nativeOpen.apply(window, arguments);
    var absolute;
    try { absolute = new URL(url, location.href).href; } catch (e) { absolute = String(url); }
    send('open:' + absolute);
    return {
      closed: false,
      focus: function () {}, blur: function () {}, close: function () {},
      postMessage: function () {}
    };
  };

  function injectStyle() {
    var css = document.createElement('style');
    css.textContent = [
      '[data-neonamp-drag] { app-region: drag; -webkit-app-region: drag;',
      /* Without an OS frame the titlebar is the only way to move or close the
         window, so it must never scroll out of reach on a short window. */
      '  position: sticky; top: 0; z-index: 60; }',
      '[data-neonamp-btn] { app-region: no-drag; -webkit-app-region: no-drag;',
      '  cursor: pointer; position: relative;',
      '  transition: background .12s ease, box-shadow .12s ease; }',
      /* invisible padding so a 9px dot is comfortably clickable */
      '[data-neonamp-btn]::after { content: ""; position: absolute; inset: -5px; }',
      '[data-neonamp-btn="minimize"]:hover { background: var(--cyan);  box-shadow: 0 0 9px var(--cyan); }',
      '[data-neonamp-btn="maximize"]:hover { background: var(--amber); box-shadow: 0 0 9px var(--amber); }',
      '[data-neonamp-btn="close"]:hover    { background: var(--mag);   box-shadow: 0 0 9px var(--mag); }',

      /* A native window that highlights its own labels when you shove it
         around reads as broken. Nothing here is prose, so drop selection
         everywhere and hand it back to the fields that actually need it. */
      'html { user-select: none; -webkit-user-select: none; }',
      'input, textarea, select, [contenteditable], [contenteditable] * {',
      '  user-select: text; -webkit-user-select: text; }',
      'img { -webkit-user-drag: none; }'
    ].join('\n');
    document.head.appendChild(css);
  }

  function wireTitlebar() {
    var bar = document.querySelector('header.titlebar, .titlebar');
    if (!bar || bar.hasAttribute('data-neonamp-drag')) return !!bar;
    bar.setAttribute('data-neonamp-drag', '');

    var tray = bar.querySelector('.winbtns');
    if (tray) {
      tray.removeAttribute('aria-hidden');
      var dots = tray.querySelectorAll('i');
      BUTTONS.forEach(function (btn, i) {
        var dot = dots[i];
        if (!dot) return;
        dot.setAttribute('data-neonamp-btn', btn.action);
        dot.setAttribute('role', 'button');
        dot.setAttribute('tabindex', '-1');
        dot.setAttribute('aria-label', btn.label);
        dot.title = btn.label;
        dot.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          send(btn.action);
        });
      });
    }
    return true;
  }

  function ready() {
    injectStyle();
    if (wireTitlebar()) return;
    // Deck markup is static, but don't assume it — watch until the bar exists.
    var observer = new MutationObserver(function () {
      if (wireTitlebar()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }

  // ── borderless resize + drag ──────────────────────────────────────────
  var INSET = 6;   // resize band, CSS px
  var SLOP = 3;    // movement before an armed backdrop press becomes a drag
  var wasNearEdge = false;
  var armed = null;

  function nearEdge(e) {
    return e.clientX < INSET || e.clientY < INSET ||
           e.clientX >= document.documentElement.clientWidth - INSET ||
           e.clientY >= document.documentElement.clientHeight - INSET;
  }

  // Bare backdrop — the stage padding around the deck, including the strip
  // above the titlebar. In a browser that's inert margin; in a frameless
  // window it's exactly where people grab to move the thing, so let them.
  function isBackdrop(el) {
    return el === document.body || el === document.documentElement ||
           (el.classList && el.classList.contains('stage'));
  }

  // Only chat over IPC around the frame, so the visualizer and sliders
  // aren't competing with a message per mouse move.
  document.addEventListener('mousemove', function (e) {
    if (armed && (Math.abs(e.clientX - armed.x) > SLOP ||
                  Math.abs(e.clientY - armed.y) > SLOP)) {
      armed = null;
      send('drag');
      return;
    }
    var edge = nearEdge(e);
    if (edge || wasNearEdge) send('hover:' + phys(e.clientX) + ',' + phys(e.clientY));
    wasNearEdge = edge;
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('[data-neonamp-btn]')) return;

    var onBar = !!(e.target.closest && e.target.closest('[data-neonamp-drag]'));
    // Deliberately no preventDefault anywhere here: it stops WebView2
    // releasing mouse capture, which leaves drag_window with nothing to
    // follow. Stray text selection is handled in CSS instead.
    if (onBar && e.detail === 2) { send('maximize'); return; }

    // Backdrop drags are armed rather than started, because handing the mouse
    // to the shell immediately would eat plain clicks — including the one that
    // dismisses PRESS ANY KEY. Moving past the slop commits to the drag.
    if (!onBar && !nearEdge(e) && isBackdrop(e.target)) {
      armed = { x: e.clientX, y: e.clientY };
      return;
    }

    // The shell resolves this: an edge wins over the drag region.
    send('press:' + phys(e.clientX) + ',' + phys(e.clientY) + ',' + (onBar ? 1 : 0));
  }, true);

  document.addEventListener('mouseup', function () { armed = null; }, true);

  // Touch has no edge affordance to preserve, so it drags unconditionally.
  document.addEventListener('touchstart', function (e) {
    if (e.target.closest && e.target.closest('[data-neonamp-drag]') &&
        !e.target.closest('[data-neonamp-btn]')) {
      send('drag');
    }
  }, true);
})();
"#;
