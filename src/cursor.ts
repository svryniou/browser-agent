/**
 * JavaScript injected into every page via context.addInitScript().
 *
 * Renders a classic arrow-pointer cursor overlay.
 *
 * Design constraints:
 *  - addInitScript fires BEFORE page HTML is parsed; document.body doesn't
 *    exist yet. Appending a DOM node at that moment would be discarded when
 *    the browser builds the real DOM tree. Therefore mk() is called LAZILY —
 *    only on the first mousemove event, at which point document.body always
 *    exists.
 *  - All cursor movement is driven from Node.js via page.mouse.move() calls
 *    in a timed loop (executor.ts → moveMouse). No rAF animation runs inside
 *    the page, so rAF throttling in headless Chrome is irrelevant.
 *  - Hot-spot is the TIP of the arrow (top-left corner of the element).
 *    We do NOT use transform:translate(-50%,-50%); instead left/top are set
 *    directly to the target coordinates.
 */
export const CURSOR_INIT_SCRIPT = `(function () {
  'use strict';
  var ID = '__ba_cursor__';
  var lastX = -200, lastY = -200;
  var observerAttached = false;

  // Arrow cursor shape: 24×32 element, clip-path cuts it into a pointer.
  // The polygon tip is at (0,0) = top-left corner = hot-spot.
  var CLIP = 'polygon(0% 0%, 0% 87%, 29% 72%, 42% 100%, 63% 94%, 50% 69%, 83% 69%)';

  function mk() {
    var el = document.getElementById(ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = ID;
    var s = el.style;
    s.setProperty('position',       'fixed',        'important');
    s.setProperty('width',          '24px',         'important');
    s.setProperty('height',         '32px',         'important');
    s.setProperty('background',     'white',        'important');
    s.setProperty('clip-path',      CLIP,           'important');
    // Outline via drop-shadow + realistic cursor shadow
    s.setProperty('filter',
      'drop-shadow(0 0 1px rgba(0,0,0,0.9)) ' +
      'drop-shadow(1px 2px 4px rgba(0,0,0,0.4))',   'important');
    s.setProperty('pointer-events', 'none',         'important');
    s.setProperty('z-index',        '2147483647',   'important');
    s.setProperty('transform',      'none',         'important');
    s.setProperty('border',         'none',         'important');
    s.setProperty('border-radius',  '0',            'important');
    s.setProperty('will-change',    'left,top',     'important');
    s.setProperty('left',           lastX + 'px',   'important');
    s.setProperty('top',            lastY + 'px',   'important');

    // Append to body — guaranteed available when called from event handlers.
    var target = document.body || document.documentElement;
    target.appendChild(el);

    // Watch for the cursor being removed by SPA framework DOM resets.
    if (!observerAttached && target) {
      observerAttached = true;
      new MutationObserver(function () {
        if (!document.getElementById(ID)) {
          observerAttached = false;
          if (lastX > -100) setPos(lastX, lastY);
        }
      }).observe(target, { childList: true });
    }

    return el;
  }

  function setPos(x, y) {
    lastX = x; lastY = y;
    var el = mk();
    el.style.setProperty('left', x + 'px', 'important');
    el.style.setProperty('top',  y + 'px', 'important');
  }

  function ripple(x, y) {
    var r = document.createElement('div');
    var s = r.style;
    s.setProperty('position',      'fixed',                          'important');
    s.setProperty('width',         '38px',                           'important');
    s.setProperty('height',        '38px',                           'important');
    s.setProperty('border',        '2px solid rgba(239,68,68,0.6)',  'important');
    s.setProperty('border-radius', '50%',                            'important');
    s.setProperty('pointer-events','none',                           'important');
    s.setProperty('z-index',       '2147483646',                     'important');
    s.setProperty('left',          x + 'px',                        'important');
    s.setProperty('top',           y + 'px',                        'important');
    s.setProperty('transform',     'translate(-50%,-50%) scale(0)',  'important');
    s.setProperty('opacity',       '1',                              'important');
    s.setProperty('transition',
      'transform 0.35s ease-out, opacity 0.35s ease-out',           'important');
    var target = document.body || document.documentElement;
    target.appendChild(r);
    requestAnimationFrame(function () {
      s.setProperty('transform', 'translate(-50%,-50%) scale(2.5)', 'important');
      s.setProperty('opacity',   '0',                               'important');
      setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 400);
    });
  }

  // ── Event listeners (registered at init time, before page scripts run) ───

  // Follow every mousemove dispatched by Playwright from Node.js.
  document.addEventListener('mousemove', function (e) {
    setPos(e.clientX, e.clientY);
  }, { capture: true, passive: true });

  document.addEventListener('mousedown', function (e) {
    var el = mk();
    // Dim slightly on press
    el.style.setProperty('filter',
      'drop-shadow(0 0 1px rgba(0,0,0,0.9)) ' +
      'drop-shadow(1px 2px 4px rgba(0,0,0,0.4)) ' +
      'brightness(0.82)',  'important');
    ripple(e.clientX, e.clientY);
  }, { capture: true, passive: true });

  document.addEventListener('mouseup', function () {
    var el = mk();
    el.style.setProperty('filter',
      'drop-shadow(0 0 1px rgba(0,0,0,0.9)) ' +
      'drop-shadow(1px 2px 4px rgba(0,0,0,0.4))',  'important');
  }, { capture: true, passive: true });

  // NOTE: mk() is intentionally NOT called here. Cursor is created lazily on
  // the first mousemove so that document.body is always available.
})();
`;
