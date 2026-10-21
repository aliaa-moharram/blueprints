// Injected into every blueprint served from /b/<token>.
// 1. Records the visit once the page has been visible for 10 seconds, then adds visible time.
// 2. Turns every element with data-check="<key>" into a saved checklist item.
(() => {
  const cfg = window.__LEAN_BP;
  if (!cfg || !cfg.token) return;
  const token = cfg.token;
  const view = cfg.view || null; // set when Lean opens a client team's page from the admin page
  const session = crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

  // ---------- Visit tracking (never in a Lean view) ----------
  if (!view) {
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
  } else {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'note');
    bar.textContent = `Lean view of ${cfg.team || 'this team'}’s page: read only, not counted as a visit.`;
    bar.style.cssText = 'position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:300;background:#1c2024;color:#fff;' +
      'font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);' +
      'border:1px solid var(--bright,#3dd68c);max-width:calc(100vw - 24px)';
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));
    if (document.readyState !== 'loading') document.body.appendChild(bar);
  }

  // ---------- Checklists ----------
  // Client team links tick their own team's checklist. Lean team links see a client
  // team's ticks, read only, with a switcher when the blueprint has several client teams.
  const items = [...document.querySelectorAll('[data-check]')];
  if (!items.length) return;

  const style = document.createElement('style');
  style.textContent = `
    [data-check]{position:relative;padding-right:46px !important}
    .bp-check{position:absolute;right:12px;top:9px;width:22px;height:22px;border-radius:6px;cursor:pointer;
      border:1.5px solid #aeb7c2;background:#fff;display:grid;place-items:center;padding:0;transition:background .15s,border-color .15s}
    .bp-check:hover{border-color:var(--bright,#3dd68c)}
    .bp-check:focus-visible{outline:2px solid #1c2024;outline-offset:2px}
    .bp-check svg{width:13px;height:13px;opacity:0;transition:opacity .15s}
    .bp-check svg path{stroke:var(--on-bright,#0f2a1e)}
    .bp-check[aria-pressed="true"]{background:var(--bright,#3dd68c);border-color:var(--bright,#3dd68c)}
    .bp-check[aria-pressed="true"] svg{opacity:1}
    .bp-check[disabled]{cursor:default}
    .bp-check.ro:hover{border-color:#aeb7c2}
    .bp-check.ro[aria-pressed="true"]:hover{border-color:var(--bright,#3dd68c)}
    [data-check].is-done{color:#6b7280 !important}
    .bp-progress{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0;text-transform:none;
      color:#1c2024;background:color-mix(in srgb,var(--bright,#3dd68c) 18%,#fff);border-radius:999px;padding:2px 9px;white-space:nowrap}
    .bp-view{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-4px 0 12px;font:600 12.5px/1.4 system-ui,sans-serif;color:#4b5563}
    .bp-view select{font:inherit;border:1px solid #d3d7dd;border-radius:8px;padding:3px 6px;background:#fff;color:#1c2024}
    .bp-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
      background:#1c2024;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:10px;z-index:200;
      box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .phase[data-panels]{display:flex;flex-direction:column}
    .phase[data-panels] > .ph{align-self:flex-start}
    .bp-phase{margin-top:auto;padding-top:12px;border-top:1px solid #e5e7eb}
    .phase[data-panels] > ul{margin-bottom:16px}
    .bp-phase .bar{height:6px;border-radius:6px;background:#eef0f2;overflow:hidden}
    .bp-phase .bar i{display:block;height:100%;width:0;background:var(--bright,#3dd68c);border-radius:6px;transition:width .3s}
    .bp-phase .txt{display:block;margin-top:7px;font:600 12.5px/1.4 system-ui,sans-serif;color:#4b5563}
    .bp-phase .txt b{color:#1c2024}
    @media (prefers-reduced-motion:reduce){.bp-phase .bar i{transition:none}}
    @media print{.bp-check,.bp-progress,.bp-view{display:none}}
  `;
  document.head.appendChild(style);

  const TICK_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let state = {};
  let readOnly = true;
  let teams = [];
  let teamIndex = 0;
  const buttons = new Map();
  const lists = new Set(items.map((li) => li.parentElement));
  // Production steps (keys containing "-prod-") can be ticked but aren't counted in any progress.
  const counted = (k) => !k.includes('-prod-');

  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };

  function paint(key) {
    const btn = buttons.get(key);
    const s = state[key];
    const done = !!(s && s.done);
    btn.setAttribute('aria-pressed', String(done));
    btn.disabled = readOnly;
    btn.classList.toggle('ro', readOnly);
    btn.closest('[data-check]').classList.toggle('is-done', done);
    if (readOnly) btn.title = done ? `Done${s.at ? ', ' + fmtDate(s.at) : ''}. Read only: the client team ticks these.` : 'Not done yet. Read only: the client team ticks these.';
    else btn.title = done && s.at ? `Done, ${fmtDate(s.at)}. Click to untick.` : 'Mark as done';
  }

  function heading(list) {
    let h = list.previousElementSibling;
    while (h && !h.classList.contains('sp-h')) h = h.previousElementSibling;
    return h;
  }

  // Phase cards list their guide checklists in data-panels="otp rec"; show progress across them.
  const phaseCards = [...document.querySelectorAll('.phase[data-panels]')].map((card) => {
    const ids = card.dataset.panels.split(/\s+/).filter(Boolean);
    const keys = items.map((li) => li.dataset.check).filter((k) => counted(k) && ids.some((id) => k.startsWith(id + '-')));
    return { card, keys };
  }).filter((p) => p.keys.length);
  function paintPhases() {
    for (const { card, keys } of phaseCards) {
      const done = keys.filter((k) => state[k] && state[k].done).length;
      let box = card.querySelector('.bp-phase');
      if (!box) {
        box = document.createElement('div');
        box.className = 'bp-phase';
        box.innerHTML = '<div class="bar" role="progressbar" aria-valuemin="0"><i></i></div><span class="txt"></span>';
        card.appendChild(box);
      }
      const bar = box.querySelector('.bar');
      bar.setAttribute('aria-valuemax', String(keys.length));
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-label', 'Checklist progress for this phase');
      box.querySelector('i').style.width = Math.round((done / keys.length) * 100) + '%';
      box.querySelector('.txt').innerHTML = `<b>${done} of ${keys.length}</b> checklist items done`;
    }
  }

  function paintAll() {
    paintPhases();
    for (const key of buttons.keys()) paint(key);
    for (const list of lists) {
      const h = heading(list);
      if (!h) continue;
      const keys = [...list.querySelectorAll('[data-check]')].map((li) => li.dataset.check).filter(counted);
      const done = keys.filter((k) => state[k] && state[k].done).length;
      let pill = h.querySelector('.bp-progress');
      if (!keys.length) { if (pill) pill.remove(); continue; }
      if (!pill) { pill = document.createElement('span'); pill.className = 'bp-progress'; h.appendChild(pill); }
      pill.textContent = `${done} of ${keys.length} done`;
    }
  }

  // Lean view: a line above each checklist saying whose progress is shown.
  function paintViewLabels() {
    for (const list of lists) {
      let bar = list.previousElementSibling && list.previousElementSibling.classList.contains('bp-view') ? list.previousElementSibling : null;
      if (!bar) { bar = document.createElement('div'); bar.className = 'bp-view'; list.parentElement.insertBefore(bar, list); }
      if (!teams.length) { bar.textContent = 'Read only. No client team has a link to this blueprint yet.'; continue; }
      if (teams.length === 1) { bar.textContent = `Showing ${teams[0].name}’s progress. Read only.`; continue; }
      bar.innerHTML = '<span>Showing progress for</span>';
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Client team');
      teams.forEach((t, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = t.name; if (i === teamIndex) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', () => { teamIndex = Number(sel.value); state = teams[teamIndex].items || {}; paintViewLabels(); paintAll(); });
      bar.appendChild(sel);
      const ro = document.createElement('span'); ro.textContent = 'Read only.'; bar.appendChild(ro);
    }
  }

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.bp-toast');
    if (!el) { el = document.createElement('div'); el.className = 'bp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
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
    btn.disabled = true; // enabled once saved state has loaded, for client team links only
    btn.addEventListener('click', async () => {
      if (readOnly) return;
      const before = state[key];
      const next = !(before && before.done);
      state[key] = { done: next, at: before && before.at };
      paintAll();
      try {
        const r = await fetch('/api/checklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, item: key, done: next }),
        });
        if (!r.ok) throw new Error();
        const saved = await r.json();
        state[key] = { done: saved.done, at: saved.at };
      } catch {
        state[key] = before;
        toast('Couldn’t save that change. Check your connection and try again.');
      }
      paintAll();
    });
    li.appendChild(btn);
    buttons.set(key, btn);
  }

  fetch('/api/checklist?token=' + encodeURIComponent(token) + (view ? '&view=' + encodeURIComponent(view) : ''))
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      if (data.mode === 'edit') {
        readOnly = false;
        state = data.items || {};
      } else {
        readOnly = true;
        teams = data.teams || [];
        state = teams.length ? teams[0].items || {} : {};
        paintViewLabels();
      }
      paintAll();
    })
    .catch(() => {
      paintAll();
      toast('Checklist progress couldn’t load. Reload the page to try again.');
    });
})();
