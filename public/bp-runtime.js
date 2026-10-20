// Injected into every blueprint served from /b/<token>.
// 1. Records the visit once the page has been visible for 10 seconds, then adds visible time.
// 2. Turns every element with data-check="<key>" into a saved checklist item.
(() => {
  const cfg = window.__LEAN_BP;
  if (!cfg || !cfg.token) return;
  const token = cfg.token;
  const session = crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

  // ---------- Visit tracking ----------
  const OPEN_AFTER = 10; // seconds visible before a visit counts
  const BEAT_EVERY = 30; // seconds of visible time per update
  let visibleMs = 0;
  let lastTick = document.visibilityState === 'visible' ? Date.now() : null;
  let opened = false;
  let reported = 0;

  function tick() {
    if (lastTick === null) return;
    const now = Date.now();
    visibleMs += now - lastTick;
    lastTick = now;
  }

  function post(body, useBeacon) {
    const data = JSON.stringify({ token, session, ...body });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([data], { type: 'text/plain' }));
      return;
    }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
      keepalive: true,
    }).catch(() => {});
  }

  function report(event, useBeacon) {
    tick();
    const total = Math.floor(visibleMs / 1000);
    if (!opened) {
      if (total >= OPEN_AFTER) {
        opened = true;
        reported = OPEN_AFTER;
        post({ event: 'open' });
      }
      return;
    }
    const delta = total - reported;
    if (delta >= BEAT_EVERY || (event === 'leave' && delta > 0)) {
      reported = total;
      post({ event, seconds: delta }, useBeacon);
    }
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') report('beat');
  }, 5000);

  function onHide() {
    report('leave', true);
    lastTick = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
    else lastTick = Date.now();
  });
  window.addEventListener('pagehide', onHide);

  // ---------- Checklists ----------
  const items = [...document.querySelectorAll('[data-check]')];
  if (!items.length) return;

  const style = document.createElement('style');
  style.textContent = `
    [data-check]{position:relative;padding-right:46px !important}
    .bp-check{position:absolute;right:12px;top:9px;width:22px;height:22px;border-radius:6px;cursor:pointer;
      border:1.5px solid #aeb7c2;background:#fff;display:grid;place-items:center;padding:0;transition:background .15s,border-color .15s}
    .bp-check:hover{border-color:#3dd68c}
    .bp-check:focus-visible{outline:2px solid #1c2024;outline-offset:2px}
    .bp-check svg{width:13px;height:13px;opacity:0;transition:opacity .15s}
    .bp-check[aria-pressed="true"]{background:#3dd68c;border-color:#3dd68c}
    .bp-check[aria-pressed="true"] svg{opacity:1}
    .bp-check[disabled]{cursor:default;opacity:.6}
    [data-check].is-done{color:#6b7280 !important}
    .bp-progress{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0;text-transform:none;
      color:#0f2a1e;background:#e3f8ee;border-radius:999px;padding:2px 9px;white-space:nowrap}
    .bp-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
      background:#1c2024;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:10px;z-index:200;
      box-shadow:0 8px 24px rgba(0,0,0,.25)}
    @media print{.bp-check,.bp-progress{display:none}}
  `;
  document.head.appendChild(style);

  const TICK_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="#0f2a1e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const state = {};
  const buttons = new Map();

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  }

  function paint(key) {
    const btn = buttons.get(key);
    const s = state[key];
    const done = !!(s && s.done);
    btn.setAttribute('aria-pressed', String(done));
    btn.closest('[data-check]').classList.toggle('is-done', done);
    btn.title = s && s.by ? `${done ? 'Ticked' : 'Unticked'} by ${s.by}, ${fmtDate(s.at)}` : 'Mark as done';
  }

  // Progress pill in the heading just before each checklist.
  const lists = new Set(items.map((li) => li.parentElement));
  function paintProgress() {
    for (const list of lists) {
      let heading = list.previousElementSibling;
      while (heading && !heading.classList.contains('sp-h')) heading = heading.previousElementSibling;
      if (!heading) continue;
      const keys = [...list.querySelectorAll('[data-check]')].map((li) => li.dataset.check);
      const done = keys.filter((k) => state[k] && state[k].done).length;
      let pill = heading.querySelector('.bp-progress');
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'bp-progress';
        heading.appendChild(pill);
      }
      pill.textContent = `${done} of ${keys.length} done`;
    }
  }

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.bp-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'bp-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3500);
  }

  for (const li of items) {
    const key = li.dataset.check;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bp-check';
    btn.innerHTML = TICK_SVG;
    btn.setAttribute('aria-label', 'Mark as done: ' + li.textContent.trim().slice(0, 80));
    btn.disabled = true; // enabled once saved state has loaded
    btn.addEventListener('click', async () => {
      const before = state[key];
      const next = !(before && before.done);
      state[key] = { done: next, by: before && before.by, at: before && before.at };
      paint(key);
      paintProgress();
      try {
        const r = await fetch('/api/checklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, item: key, done: next }),
        });
        if (!r.ok) throw new Error();
        state[key] = await r.json();
      } catch {
        state[key] = before;
        toast('Couldn’t save that change. Check your connection and try again.');
      }
      paint(key);
      paintProgress();
    });
    li.appendChild(btn);
    buttons.set(key, btn);
  }

  fetch('/api/checklist?token=' + encodeURIComponent(token))
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      Object.assign(state, data.items || {});
      for (const key of buttons.keys()) {
        buttons.get(key).disabled = false;
        paint(key);
      }
      paintProgress();
    })
    .catch(() => {
      for (const key of buttons.keys()) paint(key);
      paintProgress();
      toast('Checklist progress couldn’t load. Reload the page to try again.');
    });
})();
