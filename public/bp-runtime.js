// Injected into every blueprint served from /b/<token>.
// 1. Records the visit once the page has been visible for 10 seconds, then adds visible time.
// 2. Turns every element with data-check="<key>" into a saved checklist item.
(() => {
  const cfg = window.__LEAN_BP;
  // Local mode (admin Preview, Edit on page, or a copy opened outside the site): checkboxes and
  // progress work, ticks stay in this browser (cfg.persist) or only on this page, and nothing is tracked.
  const local = !!(cfg && cfg.local);
  if (!cfg || (!cfg.token && !local)) return;
  const token = cfg.token;
  const view = cfg.view || null; // set when Lean opens a client team's page from the admin page
  const session = crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

  // ---------- Visit tracking (never in a Lean view or local mode) ----------
  if (!view && !local) {
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
  } else if (view) {
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
    .bp-env{display:inline-block;font:700 12px/1.6 system-ui,sans-serif;border-radius:999px;padding:1px 10px;letter-spacing:0;text-transform:none}
    .bp-env.sandbox{background:transparent;color:inherit;border:1.5px solid var(--bright,#3dd68c)}
    .bp-env.production{background:var(--bright,#3dd68c);color:var(--on-bright,#0f2a1e);border:1.5px solid var(--bright,#3dd68c)}
    .bp-miles{display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:10px;vertical-align:middle}
    .bp-mile{font:700 11px/1.6 system-ui,sans-serif;letter-spacing:0;text-transform:none;border-radius:999px;padding:1px 9px;
      background:#fff;color:#1c2024;border:1px solid #d3d7dd;white-space:nowrap}
    .bp-mile.done{background:color-mix(in srgb,var(--bright,#3dd68c) 22%,#fff);border-color:transparent}
    .bp-rowcount{display:block;margin-top:8px;font:600 11.5px/1.4 system-ui,sans-serif;color:#4b5563;white-space:nowrap;min-width:110px}
    .bp-rowcount.done{color:#1c2024}
    .bp-rowbar{display:block;height:6px;border-radius:999px;background:#e5e7eb;overflow:hidden;margin:0 0 5px;max-width:140px}
    .bp-rowbar i{display:block;height:100%;width:0;background:var(--bright,#3dd68c);border-radius:999px;transition:width .3s}
    .bp-guidebar{display:flex;align-items:center;gap:10px;margin-top:12px;max-width:480px}
    .bp-guidebar .bar{flex:1;height:7px;border-radius:999px;background:rgba(255,255,255,.18);overflow:hidden}
    .bp-guidebar .bar i{display:block;height:100%;width:0;background:var(--bright,#3dd68c);border-radius:999px;transition:width .3s}
    .bp-guidebar .t{font:600 12px/1.4 system-ui,sans-serif;color:#d9dde2;white-space:nowrap}
    .bp-guidebar.done .t{color:var(--bright,#3dd68c)}
    @media (prefers-reduced-motion:reduce){.bp-rowbar i,.bp-guidebar .bar i{transition:none}}
    .bp-jwrap{margin:0 0 6px}
    .bp-journey{list-style:none;margin:0;padding:0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
    .bp-journey .j-step{display:grid;grid-template-columns:30px 1fr;gap:10px;padding:12px 14px;border-top:1px solid #eef0f2;background:#fff}
    .bp-journey .j-step:first-child{border-top:0}
    .bp-journey .j-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 12px/1 system-ui,sans-serif;border:2px solid #cfd4da;color:#6b7280;background:#fff;margin-top:1px}
    .bp-journey .done .j-dot{background:var(--bright,#3dd68c);border-color:var(--bright,#3dd68c);color:#0f2a1e}
    .bp-journey .current .j-dot{border-color:var(--bright,#3dd68c);color:#1c2024;box-shadow:0 0 0 3px color-mix(in srgb,var(--bright,#3dd68c) 25%,#fff)}
    .bp-journey .waiting .j-dot{border-color:#e0a400;color:#8a5a00;background:#fff8e6}
    .bp-journey .locked{background:#fafbfc}
    .bp-journey .locked .j-dot{border-style:dashed}
    .bp-journey .locked .j-title{color:#6b7280}
    .bp-journey .current{background:color-mix(in srgb,var(--bright,#3dd68c) 6%,#fff)}
    .bp-journey .j-title{font:700 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2024}
    .bp-journey .j-status{font:500 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#4b5563;margin-top:2px}
    .bp-journey .done .j-status{color:#127a4a}
    .bp-journey .waiting .j-status{color:#8a5a00}
    .bp-journey .j-lock{display:inline-block;margin-left:6px;font:700 10.5px/1.6 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.04em;border:1px solid #cfd4da;border-radius:999px;padding:0 7px;color:#6b7280}
    .bp-journey .j-help{font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#4b5563;margin:6px 0 0}
    .bp-journey .j-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .bp-journey .j-btn{font:600 13.5px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;padding:9px 14px;border-radius:9px;border:1px solid #cfd4da;background:#fff;color:#1c2024;cursor:pointer}
    .bp-journey .j-btn.primary{background:#1c2024;border-color:#1c2024;color:#fff}
    .bp-journey .j-btn:disabled{opacity:.6;cursor:wait}
    .bp-journey .j-btn:focus-visible,.bp-journey textarea:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px}
    .bp-journey .j-form label{display:flex;flex-direction:column;gap:6px;font:600 13px/1.4 system-ui,sans-serif;color:#1c2024;margin-top:8px}
    .bp-journey textarea{font:14px/1.45 system-ui,sans-serif;padding:8px 10px;border:1px solid #cfd4da;border-radius:8px;resize:vertical;width:100%;box-sizing:border-box}
    .bp-journey .j-err{color:#b3261e;font:600 13px/1.4 system-ui,sans-serif;margin:6px 0 0}
    .bp-journey .j-err:empty{display:none}
    .bp-jwrap .j-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
    .bp-mile.wait{background:#fff8e6;border-color:#e0a400;color:#8a5a00}
    .bp-prodnow{margin:-4px 0 10px;padding:8px 10px;border-radius:8px;font:600 12.5px/1.45 system-ui,sans-serif;
      background:color-mix(in srgb,var(--bright,#3dd68c) 18%,#fff);color:#1c2024}
    @media print{.bp-check,.bp-progress,.bp-view{display:none}}
  `;
  document.head.appendChild(style);

  const TICK_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let state = {};
  let environment = (cfg && cfg.environment) || 'sandbox'; // set by Lean in the admin page
  let production = {}; // { requestedAt, note, grantedAt } for the team shown
  let canRequest = false; // only a client team's own link can ask for production access
  let requestFormOpen = false;
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

  // Phase 0 milestones ("Sandbox setup complete"), counts on setup rows, and the environment.
  const counts = (ids, prod) => {
    const keys = items.map((li) => li.dataset.check).filter((k) => ids.some((id) => k.startsWith(id + '-')) && (prod ? k.includes('-prod-') : counted(k)));
    return { keys, done: keys.filter((k) => state[k] && state[k].done).length };
  };
  function paintMilestones() {
    const head = document.querySelector('tr.grp[data-setup]');
    if (head) {
      const ids = head.dataset.setup.split(/\s+/).filter(Boolean);
      const sb = counts(ids, false), pr = counts(ids, true);
      const pills = [sb.keys.length ? (sb.done === sb.keys.length ? ['done', '✓ Sandbox setup complete'] : ['', `Sandbox setup: ${sb.done} of ${sb.keys.length}`]) : null];
      if (environment !== 'production' && production.requestedAt) pills.push(['wait', 'Production access requested']);
      if (environment === 'production' && pr.keys.length) pills.push(pr.done === pr.keys.length ? ['done', '✓ Production setup complete'] : ['', `Production setup: ${pr.done} of ${pr.keys.length}`]);
      const td = head.querySelector('td');
      let box = td.querySelector('.bp-miles');
      if (!box) { box = document.createElement('span'); box.className = 'bp-miles'; td.appendChild(box); }
      box.innerHTML = pills.filter(Boolean).map(([cls, t]) => `<span class="bp-mile ${cls}">${t}</span>`).join('');
    }
    for (const row of document.querySelectorAll('tr[data-row-panel]')) {
      const { keys, done } = counts([row.dataset.rowPanel], false);
      const cell = row.querySelector('td:last-child');
      if (!cell || !keys.length) continue;
      let el = cell.querySelector('.bp-rowcount');
      if (!el) {
        el = document.createElement('span'); el.className = 'bp-rowcount';
        el.innerHTML = '<span class="bp-rowbar" role="progressbar" aria-valuemin="0"><i></i></span><span class="t"></span>';
        cell.appendChild(el);
      }
      const complete = done === keys.length;
      el.className = 'bp-rowcount' + (complete ? ' done' : '');
      const bar = el.querySelector('.bp-rowbar');
      bar.setAttribute('aria-valuemax', String(keys.length)); bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-label', 'Progress for this guide');
      bar.querySelector('i').style.width = Math.round((done / keys.length) * 100) + '%';
      el.querySelector('.t').textContent = complete ? `✓ ${done} of ${keys.length} done` : `${done} of ${keys.length} done`;
    }
  }
  // A progress bar in each guide's header, for the steps that count.
  function paintGuides() {
    for (const panel of document.querySelectorAll('.spanel')) {
      const keys = [...panel.querySelectorAll('[data-check]')].map((li) => li.dataset.check).filter(counted);
      const head = panel.querySelector('.sp-head');
      if (!head || !keys.length) continue;
      const done = keys.filter((k) => state[k] && state[k].done).length;
      let box = head.querySelector('.bp-guidebar');
      if (!box) {
        box = document.createElement('div'); box.className = 'bp-guidebar';
        box.innerHTML = '<div class="bar" role="progressbar" aria-valuemin="0" aria-label="Progress for this guide"><i></i></div><span class="t"></span>';
        head.appendChild(box);
      }
      const bar = box.querySelector('.bar');
      bar.setAttribute('aria-valuemax', String(keys.length)); bar.setAttribute('aria-valuenow', String(done));
      bar.querySelector('i').style.width = Math.round((done / keys.length) * 100) + '%';
      box.classList.toggle('done', done === keys.length);
      box.querySelector('.t').textContent = done === keys.length ? `✓ All ${keys.length} steps done` : `${done} of ${keys.length} steps done`;
    }
  }

  function paintEnvironment() {
    const label = environment === 'production' ? 'Production' : 'Sandbox';
    const meta = document.querySelector('.hero .meta');
    if (meta) {
      let item = meta.querySelector('.bp-envitem');
      if (!item) { item = document.createElement('div'); item.className = 'bp-envitem'; meta.appendChild(item); }
      item.innerHTML = `<div class="k">Environment</div><div class="v"><span class="bp-env ${environment === 'production' ? 'production' : 'sandbox'}">${label}</span></div>`;
    }
    // Production steps: point out that they apply once Lean has set the client to production.
    for (const list of lists) {
      const keys = [...list.querySelectorAll('[data-check]')].map((li) => li.dataset.check);
      if (!keys.length || !keys.every((k) => k.includes('-prod-'))) continue;
      let note = list.previousElementSibling && list.previousElementSibling.classList.contains('bp-prodnow') ? list.previousElementSibling : null;
      if (environment === 'production') {
        if (!note) { note = document.createElement('div'); note.className = 'bp-prodnow'; list.parentElement.insertBefore(note, list); }
        note.textContent = 'You’re in production: these steps apply to you now.';
      } else if (note) note.remove();
    }
  }

  // ---------- Your path to production ----------
  const escH = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setupIds = () => {
    const head = document.querySelector('tr.grp[data-setup]');
    return (head ? head.dataset.setup.split(/\s+/) : ['dev', 'start', 'wh']).filter((id) => document.getElementById('panel-' + id));
  };
  function journey() {
    const ids = setupIds();
    if (!ids.length) return null;
    const sb = counts(ids, false), pr = counts(ids, true);
    const hasE2e = !!document.getElementById('panel-e2e');
    const e2 = hasE2e ? counts(['e2e'], false) : null;
    const prog = (c) => (!c.keys.length ? null : c.done === c.keys.length ? 'done' : c.done ? 'progress' : 'todo');
    const label = (c, st) => (st === 'done' ? `Complete · ${c.done} of ${c.keys.length}` : st === 'progress' ? `In progress · ${c.done} of ${c.keys.length}` : `Not started · 0 of ${c.keys.length}`);
    const steps = [];
    const s1 = prog(sb);
    steps.push({ key: 'sandbox', title: 'Sandbox setup', state: s1 === 'done' ? 'done' : 'open', status: label(sb, s1), panel: ids[0] });
    if (e2) { const s2 = prog(e2); steps.push({ key: 'e2e', title: 'End-to-end test in Sandbox', state: s2 === 'done' ? 'done' : 'open', status: label(e2, s2), panel: 'e2e' }); }
    const ready = steps.every((x) => x.state === 'done');
    const granted = environment === 'production';
    const requested = !!production.requestedAt;
    steps.push({ key: 'access', title: 'Production access', state: granted ? 'done' : requested ? 'waiting' : 'open',
      status: granted ? `Granted${production.grantedAt ? ' on ' + fmtDate(production.grantedAt) : ''}` : requested ? `Requested on ${fmtDate(production.requestedAt)} · waiting for Lean` : 'Not requested', ready });
    const s4 = prog(pr);
    steps.push({ key: 'prod', title: 'Production setup', state: !granted ? 'locked' : s4 === 'done' ? 'done' : 'open',
      status: !granted ? 'Starts once Lean grants production access' : label(pr, s4), panel: ids[0] });
    const current = steps.find((x) => x.state === 'open' || x.state === 'waiting');
    if (current) current.current = true;
    return steps;
  }
  function accessAction(step) {
    if (step.state !== 'open') {
      if (step.state === 'waiting') return `<p class="j-help">Lean will upgrade your application and switch this blueprint to Production. You’ll see it here, and the production steps will unlock.${production.note ? `</p><p class="j-help"><b>Your note:</b> ${escH(production.note)}` : ''}</p>`;
      return '';
    }
    if (!canRequest) return `<p class="j-help">${local ? 'Requests are sent from the client team’s blueprint link.' : 'The client team requests this from their blueprint link.'}</p>`;
    if (step.ready) return '<p class="j-help">Sandbox setup and the end-to-end test are done. Ask Lean to upgrade your application.</p><div class="j-act"><button type="button" class="j-btn primary" data-jopen>Request production access</button></div>';
    const names = { sandbox: 'Sandbox setup', e2e: 'the End-to-end test' };
    const left = journey().filter((x) => names[x.key] && x.state !== 'done').map((x) => names[x.key]).join(' and ');
    return `<p class="j-help">Recommended first: finish ${escH(left)}. Lean checks these before upgrading you.</p><div class="j-act"><button type="button" class="j-btn" data-jopen>Request anyway</button></div>`;
  }
  function paintJourney() {
    if (requestFormOpen) return; // don't redraw over a note being typed
    const steps = journey();
    if (!steps) return;
    for (const pid of ['dev', 'e2e']) {
      const body = document.querySelector('#panel-' + pid + ' .sp-body');
      if (!body) continue;
      let wrap = body.querySelector('.bp-jwrap');
      if (!wrap) {
        wrap = document.createElement('section'); wrap.className = 'bp-jwrap'; wrap.setAttribute('aria-label', 'Your path to production');
        body.insertBefore(wrap, body.firstChild);
      }
      const n = { done: '✓', waiting: '…' };
      wrap.innerHTML = '<div class="sp-h">Your path to production</div><ol class="bp-journey">' + steps.map((x, i) =>
        `<li class="j-step ${x.state}${x.current ? ' current' : ''}"${x.current ? ' aria-current="step"' : ''}>` +
        `<span class="j-dot" aria-hidden="true">${n[x.state] || i + 1}</span>` +
        `<div><div class="j-title">${escH(x.title)}</div><div class="j-status">${escH(x.status)}${x.state === 'locked' ? ' <span class="j-lock">Locked</span>' : ''}</div>` +
        (x.key === 'access' ? `<div class="j-access">${accessAction(x)}</div>` : '') + '</div></li>').join('') + '</ol>' +
        '<div class="j-live" role="status" aria-live="polite"></div>';
    }
  }
  function openRequestForm(btn) {
    const box = btn.closest('.j-access');
    requestFormOpen = true;
    box.innerHTML = '<form class="j-form"><label>Anything Lean should know? (optional)<textarea maxlength="1000" rows="3" placeholder="For example, your target go-live date"></textarea></label>' +
      '<div class="j-act"><button type="submit" class="j-btn primary">Send request</button><button type="button" class="j-btn" data-jcancel>Cancel</button></div><p class="j-err" role="alert"></p></form>';
    const form = box.querySelector('form'); form.querySelector('textarea').focus();
    form.querySelector('[data-jcancel]').addEventListener('click', () => { requestFormOpen = false; paintJourney(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const send = form.querySelector('[type=submit]'); send.disabled = true; send.textContent = 'Sending…';
      try {
        const r = await fetch('/api/production', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, note: form.querySelector('textarea').value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'The request couldn’t be sent.');
        production = { ...production, requestedAt: j.requestedAt, note: j.note };
        requestFormOpen = false; paintAll();
        document.querySelectorAll('.bp-jwrap .j-live').forEach((el) => { el.textContent = 'Request sent. Lean has been notified.'; });
      } catch (err) {
        send.disabled = false; send.textContent = 'Send request';
        form.querySelector('.j-err').textContent = (err.message || 'The request couldn’t be sent.') + ' Try again.';
      }
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jopen]');
    if (b) openRequestForm(b);
  });

  function paintAll() {
    paintJourney();
    paintMilestones();
    paintGuides();
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
      sel.addEventListener('change', () => { teamIndex = Number(sel.value); state = teams[teamIndex].items || {}; environment = teams[teamIndex].environment || 'sandbox'; production = teams[teamIndex].production || {}; paintViewLabels(); paintEnvironment(); paintAll(); });
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
    const plain = li.cloneNode(true);
    plain.querySelectorAll('.tip, .evgroups').forEach((n) => n.remove());
    btn.setAttribute('aria-label', 'Mark as done: ' + plain.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
    btn.disabled = true; // enabled once saved state has loaded, for client team links only
    btn.addEventListener('click', async () => {
      if (readOnly) return;
      const before = state[key];
      const next = !(before && before.done);
      state[key] = { done: next, at: before && before.at };
      paintAll();
      if (local) { state[key].at = new Date().toISOString(); saveLocal(); paintAll(); return; }
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

  // Local mode: ticks live in this browser (or only on this page) instead of the site.
  const storeKey = 'leanbp-ticks:' + (cfg.slug || location.pathname);
  function saveLocal() {
    if (!cfg.persist) return;
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
  }
  if (local) {
    readOnly = false;
    if (cfg.persist) { try { state = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch { state = {}; } }
    paintEnvironment();
    paintAll();
    const note = document.createElement('div');
    note.setAttribute('role', 'note');
    note.textContent = cfg.persist ? 'Ticks on this copy are saved in this browser only.' : 'Preview: checkboxes work, but ticks aren’t saved.';
    note.style.cssText = 'position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:300;background:#1c2024;color:#fff;' +
      'font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);border:1px solid var(--bright,#3dd68c);max-width:calc(100vw - 24px)';
    const add = () => document.body.appendChild(note);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
    return;
  }

  fetch('/api/checklist?token=' + encodeURIComponent(token) + (view ? '&view=' + encodeURIComponent(view) : ''))
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      if (data.mode === 'edit') {
        readOnly = false;
        state = data.items || {};
        environment = data.environment || 'sandbox';
        production = data.production || {};
        canRequest = !view;
      } else {
        readOnly = true;
        teams = data.teams || [];
        state = teams.length ? teams[0].items || {} : {};
        environment = (teams[0] && teams[0].environment) || 'sandbox';
        production = (teams[0] && teams[0].production) || {};
        paintViewLabels();
      }
      paintEnvironment();
      paintAll();
    })
    .catch(() => {
      paintAll();
      toast('Checklist progress couldn’t load. Reload the page to try again.');
    });
})();
