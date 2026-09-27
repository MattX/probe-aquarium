// Lightweight tooltips for any element with a data-tip attribute (HTML allowed).
// Works for mouse hover and tap-to-show on touch screens, and survives the
// panel being re-rendered underneath the pointer.

let tipEl = null;
let current = null;
let lastPt = null;
let touchTimer = 0;

export function initTips() {
  tipEl = document.createElement('div');
  tipEl.id = 'uitip';
  tipEl.hidden = true;
  document.body.appendChild(tipEl);

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    lastPt = { x: e.clientX, y: e.clientY };
    setTarget(findTip(e.target));
  }, { passive: true });
  document.addEventListener('pointerleave', () => { lastPt = null; setTarget(null); });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { setTarget(null); return; }
    const el = findTip(e.target);
    // taps on plain text show the tip; taps on controls just use the control
    if (el && !e.target.closest('button, input, select, a')) {
      setTarget(el);
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => setTarget(null), 5000);
    } else setTarget(null);
  }, { passive: true });
  window.addEventListener('scroll', () => setTarget(null), true);
}

// Call after re-rendering DOM: re-attach to whatever is under the pointer now.
export function refreshTip() {
  if (!current) return;
  if (current.isConnected) { position(current); return; }
  if (!lastPt) { setTarget(null); return; }
  const under = document.elementFromPoint(lastPt.x, lastPt.y);
  setTarget(under ? findTip(under) : null, true);
}

function findTip(el) {
  return el && el.closest ? el.closest('[data-tip]') : null;
}

function setTarget(el, force) {
  if (el === current && !force) return;
  current = el;
  if (!el || !el.dataset.tip) { tipEl.hidden = true; current = null; return; }
  tipEl.innerHTML = el.dataset.tip;
  tipEl.hidden = false;
  position(el);
}

function position(el) {
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = r.left + r.width / 2 - tw / 2;
  let y = r.bottom + 8;
  if (y + th > vh - 6) y = r.top - th - 8;
  if (y < 6) y = 6;
  x = Math.max(6, Math.min(vw - tw - 6, x));
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
