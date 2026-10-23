// Injected into every blueprint served from /b/<token>.
// 1. Asks who's viewing when the server doesn't know (the page stays hidden until then), and adds visible time
//    to the visit the server recorded for this page load.
// 2. Turns every element with data-check="<key>" into a saved checklist item.
(() => {
  const cfg = window.__LEAN_BP;
  // Local mode (admin Preview, Edit on page, or a copy opened outside the site): checkboxes and
  // progress work, ticks stay in this browser (cfg.persist) or only on this page, and nothing is tracked.
  const local = !!(cfg && cfg.local);
  if (!cfg || (!cfg.token && !local)) return;
  const token = cfg.token;
  const view = cfg.view || null; // set when Lean opens a client team's page from the admin page
  // ---------- Who's viewing ----------
  // The server holds the identity, in a signed cookie, and tells the page who's viewing (cfg.viewer) or that it
  // needs to ask (cfg.needIdentity: the page content stays hidden until then). Answering sets the cookie and
  // reloads, and the server records that load as the visit. On a client link, a Lean email gets the read-only
  // Lean view, an email on the link's client domains is the client team, and any other email is read only.
  // Not verified: it tells people apart, it isn't access control.
  const askWho = !!cfg.needIdentity;
  const leanDomains = (cfg.leanDomains || ['leantech.me']).map((d) => String(d).toLowerCase().replace(/^@/, ''));
  const whoKey = 'leanbp-viewer:' + token;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const clientDomains = (cfg.clientDomains || []).map((d) => String(d).toLowerCase().replace(/^@/, ''));
  const within = (d, list) => list.some((x) => d === x || d.endsWith('.' + x));
  const kindOf = (email) => { const d = String(email || '').toLowerCase().split('@')[1] || ''; return within(d, leanDomains) ? 'lean' : within(d, clientDomains) ? 'client' : 'other'; };
  const nameOf = (email) => String(email).split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  let viewer = cfg.viewer && EMAIL_RE.test(cfg.viewer.email) ? { email: cfg.viewer.email, name: cfg.viewer.name || nameOf(cfg.viewer.email), kind: cfg.viewer.kind } : null;
  const whoWaiters = [];
  const viewerKind = () => (viewer ? viewer.kind || kindOf(viewer.email) : null);
  const leanViewer = () => viewerKind() === 'lean';
  // On a client link, only someone on the client team can tick or request production access.
  const clientViewer = () => (cfg.kind === 'client' && !view ? viewerKind() === 'client' : true);
  void whoKey;
  const viewerPayload = () => (viewer ? { email: viewer.email } : undefined);

  function whoDialog({ switching } = {}) {
    const ov = document.createElement('div');
    ov.className = 'bp-who-ov';
    ov.innerHTML = '<div class="bp-who" role="dialog" aria-modal="true" aria-labelledby="bpWhoT" aria-describedby="bpWhoD">' +
      '<h2 id="bpWhoT">' + (switching || (askWho && cfg.kind !== 'client') ? 'Who’s viewing?' : askWho ? 'Welcome to your integration blueprint' : 'Who’s commenting?') + '</h2>' +
      '<p id="bpWhoD">' + (askWho ? 'Enter your work email to continue.' : 'Enter your Lean work email to comment.') + ' You’ll only be asked once on this device.</p>' +
      '<form novalidate><label for="bpWhoE">Work email</label><input id="bpWhoE" type="email" autocomplete="email" inputmode="email" required>' +
      '<p class="bp-who-err" role="alert"></p><div class="bp-who-act"><button type="submit" class="bp-who-go">Continue</button></div>' +
      '</form></div>';
    document.body.appendChild(ov);
    const input = ov.querySelector('input'), err = ov.querySelector('.bp-who-err');
    const prevFocus = document.activeElement;
    setTimeout(() => input.focus(), 30);
    const close = () => { ov.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    void close;
    ov.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!EMAIL_RE.test(email)) { err.textContent = 'Enter a full email address, for example name@company.com.'; input.focus(); return; }
      const go = ov.querySelector('.bp-who-go'); go.disabled = true; go.textContent = 'Opening…';
      try {
        // The server sets a signed cookie, then the page reloads: that load is recorded as the visit.
        const r = await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'identify', token, email }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'That didn’t work. Try again.');
        location.reload();
      } catch (x) { go.disabled = false; go.textContent = 'Continue'; err.textContent = x.message; input.focus(); }
    });
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); } // the email is required: Escape doesn't dismiss it
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [...ov.querySelectorAll('input,button')]; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  // "Viewing as …", with a way to switch
  function whoNote() {
    if (view || local || !viewer) return;
    let n = document.querySelector('.bp-whonote');
    if (!n) { n = document.createElement('div'); n.className = 'bp-whonote'; n.setAttribute('role', 'note'); document.body.appendChild(n); }
    const k = viewerKind();
    n.innerHTML = (cfg.kind !== 'client' ? '' : k === 'lean' ? '<b>Lean view:</b> read only, not counted as the client team’s visit. '
      : k === 'other' ? '<b>Read only:</b> this email can’t update the blueprint. ' : '') + 'Viewing as <span></span> · <button type="button">Not you?</button>';
    n.querySelector('span').textContent = viewer.name || viewer.email;
    n.querySelector('button').onclick = async () => { // "Not you?": forget this browser's identity, then ask again
      try { await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'forget', token }) }); } catch {}
      location.reload();
    };
  }
  let applyWho = () => whoNote();
  if (askWho) {
    const start = () => whoDialog();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }

  // ---------- Visible time (never in a Lean view or local mode) ----------
  // The visit itself is recorded by the server when the page loads (cfg.visit). This adds the time the page
  // was actually in front of the viewer: every 30 seconds, and when they switch away or close it.
  if (!view && !local && cfg.visit) {
    const BEAT_EVERY = 30;
    let visibleMs = 0, reported = 0;
    let lastTick = document.visibilityState === 'visible' ? Date.now() : null;
    const tick = () => { if (lastTick === null) return; const now = Date.now(); visibleMs += now - lastTick; lastTick = now; };
    const post = (body, useBeacon) => {
      const data = JSON.stringify({ token, visit: cfg.visit, ...body });
      if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon('/api/track', new Blob([data], { type: 'text/plain' })); return; }
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(() => {});
    };
    const report = (event, useBeacon) => {
      tick();
      const delta = Math.floor(visibleMs / 1000) - reported;
      if (delta >= BEAT_EVERY || (event === 'leave' && delta > 0)) { reported += delta; post({ event, seconds: delta }, useBeacon); }
    };
    setInterval(() => { if (document.visibilityState === 'visible') report('beat'); }, 5000);
    const onHide = () => { report('leave', true); lastTick = null; };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); else lastTick = Date.now(); });
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
    .bp-who-ov{position:fixed;inset:0;z-index:600;background:rgba(15,18,22,.55);display:flex;align-items:center;justify-content:center;padding:20px}
    .bp-who{background:#fff;border-radius:16px;max-width:440px;width:100%;padding:26px 26px 20px;box-shadow:0 24px 70px rgba(0,0,0,.35);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2024}
    .bp-who h2{font:800 19px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0 0 8px}
    .bp-who p{margin:0 0 14px;color:#4b5563;font-size:14px}
    .bp-who label{display:block;font-weight:700;font-size:13px;margin-bottom:6px}
    .bp-who input{width:100%;box-sizing:border-box;font:15px system-ui,sans-serif;padding:10px 12px;border:1px solid #cfd4da;border-radius:10px}
    .bp-who input:focus-visible,.bp-who button:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px}
    .bp-who .bp-who-err{color:#b3261e;font-weight:600;font-size:13px;margin:8px 0 0}
    .bp-who .bp-who-err:empty{display:none}
    .bp-who-act{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
    .bp-who-go{font:700 14px system-ui,sans-serif;padding:10px 18px;border-radius:10px;border:1px solid #1c2024;background:#1c2024;color:#fff;cursor:pointer}
    .bp-whonote{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:300;background:#fff;color:#1c2024;border:1px solid #e5e7eb;box-shadow:0 6px 20px rgba(0,0,0,.12);font:500 12.5px/1.4 system-ui,sans-serif;padding:7px 12px;border-radius:999px;max-width:calc(100vw - 24px)}
    .bp-whonote button{background:none;border:0;padding:0;font:inherit;font-weight:700;color:#1c2024;text-decoration:underline;text-decoration-color:var(--bright,#3dd68c);text-underline-offset:2px;cursor:pointer}
    .bp-whonote button:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px;border-radius:3px}
    .bp-req{max-width:620px;max-height:calc(100vh - 40px);overflow:auto;position:relative}
    .bp-req .rq-x{position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:9px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-size:14px}
    .bp-req .rq-lead{margin:0 0 18px}
    .bp-req fieldset{border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px 6px;margin:0 0 14px}
    .bp-req legend{font:800 14px system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 6px;color:#1c2024}
    .bp-req .rq-opt{font-weight:500;color:#6b7280}
    .bp-req .rq-hint{font-size:13px;color:#6b7280;margin:0 0 10px}
    .bp-req .rq-f{margin:0 0 12px}
    .bp-req .rq-f label{display:block;font-weight:700;font-size:13px;margin-bottom:5px}
    .bp-req textarea{width:100%;box-sizing:border-box;font:15px system-ui,sans-serif;padding:10px 12px;border:1px solid #cfd4da;border-radius:10px;resize:vertical}
    .bp-req [aria-invalid="true"]{border-color:#b3261e;box-shadow:0 0 0 1px #b3261e}
    .bp-req .rq-err{color:#b3261e;font-weight:600;font-size:13px;margin:6px 0 0}
    .bp-req .rq-err:empty{display:none}
    .bp-req .rq-filein{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}
    .bp-req .rq-drop{display:flex;flex-direction:column;align-items:center;gap:2px;padding:18px;border:1.5px dashed #aeb7c2;border-radius:12px;cursor:pointer;text-align:center;font-size:14px;color:#4b5563}
    .bp-req .rq-drop b{color:#1c2024}
    .bp-req .rq-drop.over,.bp-req .rq-filein:focus-visible+.rq-drop{border-color:var(--bright,#3dd68c);background:color-mix(in srgb,var(--bright,#3dd68c) 8%,#fff)}
    .bp-req .rq-up{border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;font-size:14px}
    .bp-req .rq-bar{height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden;margin:8px 0 0}
    .bp-req .rq-bar i{display:block;height:100%;width:0;background:var(--bright,#3dd68c);transition:width .2s}
    .bp-req .rq-upact{display:flex;gap:14px;margin-top:8px}
    .bp-req .rq-link{background:none;border:0;padding:0;font:700 13px system-ui,sans-serif;color:#1c2024;text-decoration:underline;text-decoration-color:var(--bright,#3dd68c);text-underline-offset:2px;cursor:pointer}
    .bp-req .rq-na{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;margin:12px 0 8px;cursor:pointer}
    .bp-req .rq-na input{width:18px;height:18px}
    .bp-req .rq-cancel{font:600 14px system-ui,sans-serif;padding:10px 14px;border-radius:10px;border:1px solid #cfd4da;background:#fff;color:#1c2024;cursor:pointer}
    .bp-req .rq-x:focus-visible,.bp-req .rq-link:focus-visible,.bp-req .rq-cancel:focus-visible,.bp-req textarea:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px}
    .bp-journey .j-sent{margin:8px 0 0;padding-left:18px;font:13px/1.5 system-ui,sans-serif;color:#4b5563}
    .bp-cmt-tip{position:fixed;right:16px;bottom:calc(70px + env(safe-area-inset-bottom,0px));z-index:321;max-width:320px;background:#fff;color:#1c2024;border:1px solid #e0a400;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.2);padding:14px 16px;font:13.5px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
    .bp-cmt-tip p{margin:4px 0 10px;color:#4b5563}
    .bp-cmt-tip button{font:700 13px system-ui,sans-serif;padding:7px 14px;border-radius:9px;border:0;background:#1c2024;color:#fff;cursor:pointer}
    .bp-cmt-tip button:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px}
    .bp-cmt-fab{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:320;font:700 13.5px system-ui,sans-serif;padding:10px 16px;border-radius:999px;border:0;background:#1c2024;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer}
    .bp-cmt-bubble{position:fixed;z-index:360;font:700 13px system-ui,sans-serif;padding:7px 12px;border-radius:999px;border:0;background:#1c2024;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer}
    .bp-cmt-drawer{position:fixed;top:0;left:0;bottom:0;width:min(380px,100vw);z-index:340;background:#fff;box-shadow:8px 0 30px rgba(0,0,0,.18);overflow:auto;padding:16px 16px 80px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2024}
    .bp-cmt-drawer .cm-head{display:flex;justify-content:space-between;align-items:center}
    .bp-cmt-drawer h2{font:800 17px system-ui,sans-serif;margin:0}
    .bp-cmt-drawer .cm-x{width:32px;height:32px;border-radius:9px;border:1px solid #e5e7eb;background:#fff;cursor:pointer}
    .bp-cmt-drawer .cm-sub,.bp-cmt-drawer .cm-tip{color:#6b7280;font-size:12.5px;margin:4px 0 10px}
    .bp-cmt-drawer .cm-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
    .bp-cmt-drawer .cm-pick{font:700 13px system-ui,sans-serif;padding:8px 12px;border-radius:9px;border:1px solid #1c2024;background:#1c2024;color:#fff;cursor:pointer}
    .bp-cmt-drawer .cm-res{font-size:12.5px;color:#4b5563;display:flex;gap:6px;align-items:center}
    .bp-cmt-drawer .cm-t,.bp-cmt-drawer .cm-compose{border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:0 0 10px;background:#fff}
    .bp-cmt-drawer .cm-t.resolved{opacity:.7;background:#fafbfc}
    .bp-cmt-drawer .cm-t.flash{box-shadow:0 0 0 2px var(--bright,#3dd68c)}
    .bp-cmt-drawer .cm-where{display:block;width:100%;text-align:left;background:#fff8e6;border:0;border-left:3px solid #e0a400;border-radius:6px;padding:6px 8px;font:12.5px/1.45 system-ui,sans-serif;color:#5c4100;cursor:pointer;margin:0 0 8px}
    .bp-cmt-drawer .cm-where.static{cursor:default}
    .bp-cmt-drawer .cm-sec{display:block;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#8a5a00;margin-bottom:2px}
    .bp-cmt-drawer .cm-gone{font-size:12px;color:#b3261e;margin:-4px 0 8px}
    .bp-cmt-drawer .cm-c{margin:0 0 8px}
    .bp-cmt-drawer .cm-meta{font-size:12px;color:#6b7280}
    .bp-cmt-drawer .cm-body{white-space:pre-wrap;margin-top:2px}
    .bp-cmt-drawer textarea{width:100%;box-sizing:border-box;font:14px system-ui,sans-serif;padding:8px 10px;border:1px solid #cfd4da;border-radius:9px;resize:vertical}
    .bp-cmt-drawer .cm-act{display:flex;gap:8px;margin-top:6px}
    .bp-cmt-drawer .cm-b{font:700 12.5px system-ui,sans-serif;padding:6px 12px;border-radius:8px;border:1px solid #1c2024;background:#1c2024;color:#fff;cursor:pointer}
    .bp-cmt-drawer .cm-b.ghost{background:#fff;color:#1c2024;border-color:#cfd4da}
    .bp-cmt-drawer .cm-l{background:none;border:0;padding:0;font:inherit;color:#1c2024;text-decoration:underline;cursor:pointer}
    .bp-cmt-drawer .cm-err{color:#b3261e;font-weight:600;font-size:12.5px;margin:6px 0 0}
    .bp-cmt-drawer .cm-err:empty{display:none}
    .bp-cmt-drawer .cm-empty{color:#6b7280}
    .bp-cmt-drawer .cm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
    .bp-cmt-drawer button:focus-visible,.bp-cmt-drawer textarea:focus-visible,.bp-cmt-fab:focus-visible,.bp-cmt-badge:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px}
    .bp-cmt-hl{box-shadow:inset 3px 0 0 #e0a400;background-color:rgba(255,212,0,.10)}
    img.bp-cmt-hl{outline:3px solid #e0a400;outline-offset:2px}
    .bp-cmt-badge{margin-left:6px;font:700 11px system-ui,sans-serif;padding:1px 7px;border-radius:999px;border:1px solid #e0a400;background:#fff8e6;color:#8a5a00;cursor:pointer;vertical-align:middle}
    .bp-cmt-picking *{cursor:crosshair !important}
    .bp-cmt-pickhl{outline:2px dashed #e0a400 !important;outline-offset:2px}
    .bp-cmt-flash{animation:bpCmtFlash 1.6s ease}
    @keyframes bpCmtFlash{0%,100%{box-shadow:none}30%{box-shadow:0 0 0 4px rgba(224,164,0,.55)}}
    @media print{.bp-cmt-fab,.bp-cmt-drawer,.bp-cmt-bubble,.bp-cmt-badge,.bp-cmt-tip{display:none !important}}
    @media print{.bp-who-ov,.bp-whonote{display:none}}
    .bp-jmain{margin:0 0 30px}
    .bp-jmain .bp-journey{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-radius:16px}
    .bp-jmain .bp-journey .j-step{border-top:0;border-left:1px solid #eef0f2;padding:16px}
    .bp-jmain .bp-journey .j-step:first-child{border-left:0}
    .bp-journey .j-link{font:700 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;background:none;border:0;padding:0;color:#1c2024;text-decoration:underline;text-decoration-color:var(--bright,#3dd68c);text-underline-offset:3px;cursor:pointer}
    .bp-journey .j-link:focus-visible{outline:2px solid var(--bright,#3dd68c);outline-offset:2px;border-radius:3px}
    @media (max-width:900px){.bp-jmain .bp-journey{grid-template-columns:1fr}.bp-jmain .bp-journey .j-step{border-left:0;border-top:1px solid #eef0f2}.bp-jmain .bp-journey .j-step:first-child{border-top:0}}
    .bp-prodnow{margin:-4px 0 10px;padding:8px 10px;border-radius:8px;font:600 12.5px/1.45 system-ui,sans-serif;
      background:color-mix(in srgb,var(--bright,#3dd68c) 18%,#fff);color:#1c2024}
    @media print{.bp-check,.bp-progress,.bp-view{display:none}}
  `;
  document.head.appendChild(style);
  const items = [...document.querySelectorAll('[data-check]')]; // may be empty: a blueprint without checklist steps

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
      if (step.state === 'waiting') {
        const sm = production.summary;
        const sent = sm ? `<ul class="j-sent"><li><b>Recording:</b> ${sm.video ? escH(sm.video.name) : `not applicable (${escH(sm.videoNaReason || '')})`}</li><li><b>Settlement Account:</b> ${escH(sm.accountHolderName || '')}, IBAN ${escH(sm.iban || '')}</li></ul>` : '';
        return `<p class="j-help">Lean will review your request, upgrade your application and switch this blueprint to Production. You’ll see it here, and the production steps will unlock.</p>${sent}${production.note ? `<p class="j-help"><b>Your note:</b> ${escH(production.note)}</p>` : ''}`;
      }
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
    // On the main page, above Delivery phases, so it's visible without opening a guide; and at the top of the
    // Developer portal setup and End-to-end test guides.
    const targets = [];
    const phases = document.querySelector('.phases');
    if (phases) {
      const head = [...document.querySelectorAll('h3.sub-h')].find((h) => /Delivery phases/i.test(h.textContent));
      const before = head || phases;
      let main = document.querySelector('.bp-jmain');
      if (!main) { main = document.createElement('section'); main.className = 'bp-jwrap bp-jmain'; main.setAttribute('aria-label', 'Your path to production'); before.parentElement.insertBefore(main, before); }
      targets.push(main);
    }
    for (const pid of ['dev', 'e2e']) {
      const body = document.querySelector('#panel-' + pid + ' .sp-body');
      if (!body) continue;
      let wrap = body.querySelector('.bp-jwrap');
      if (!wrap) {
        wrap = document.createElement('section'); wrap.className = 'bp-jwrap'; wrap.setAttribute('aria-label', 'Your path to production');
        body.insertBefore(wrap, body.firstChild);
      }
      targets.push(wrap);
    }
    for (const wrap of targets) {
      const isMain = wrap.classList.contains('bp-jmain');
      const n = { done: '✓', waiting: '…' };
      wrap.innerHTML = (isMain ? '<h3 class="sub-h">Your path to production</h3>' : '<div class="sp-h">Your path to production</div>') + '<ol class="bp-journey">' + steps.map((x, i) =>
        `<li class="j-step ${x.state}${x.current ? ' current' : ''}"${x.current ? ' aria-current="step"' : ''}>` +
        `<span class="j-dot" aria-hidden="true">${n[x.state] || i + 1}</span>` +
        `<div><div class="j-title">${escH(x.title)}</div><div class="j-status">${escH(x.status)}${x.state === 'locked' ? ' <span class="j-lock">Locked</span>' : ''}</div>` +
        (x.key === 'access' ? `<div class="j-access">${accessAction(x)}</div>` : '') +
        (isMain && x.panel && x.state !== 'locked' && x.state !== 'done' ? `<div class="j-act"><button type="button" class="j-link" data-jguide="${escH(x.panel)}">Open the guide →</button></div>` : '') + '</div></li>').join('') + '</ol>' +
        '<div class="j-live" role="status" aria-live="polite"></div>';
    }
  }
  // ---------- The production access request ----------
  // A dialog with the demo recording (or why it doesn't apply), the production Settlement Account details and a note.
  // The recording uploads as soon as it's chosen. Values are kept in memory while the page is open, never stored.
  const VIDEO_MAX = 100 * 1024 * 1024; // sized for Vercel's free plan (1 GB of storage in total)
  const draft = { videoNa: false, videoNaReason: '', accountHolderName: '', tradeLicenseNumber: '', iban: '', accountNumber: '', bankAddress: '', note: '', video: null };
  const ibanCheck = (raw) => {
    const iban = String(raw || '').replace(/[\s-]+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return 'Enter a full IBAN, for example AE07 0331 2345 6789 0123 456.';
    if (iban.startsWith('AE') && iban.length !== 23) return 'A UAE IBAN has 23 characters, starting with AE.';
    let rem = 0; for (const ch of iban.slice(4) + iban.slice(0, 4)) { const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) rem = (rem * 10 + Number(d)) % 97; }
    return rem === 1 ? '' : 'This IBAN doesn’t check out. Check for a mistyped character.';
  };
  const RULES = {
    accountHolderName: (v) => (v.trim().length < 2 ? 'Enter the account holder’s name, as the bank has it.' : ''),
    tradeLicenseNumber: (v) => (v.trim().length < 3 ? 'Enter the trade licence number.' : ''),
    iban: ibanCheck,
    accountNumber: (v) => (/^[A-Z0-9]{4,34}$/i.test(v.replace(/[\s-]+/g, '')) ? '' : 'Enter the account number: letters and digits only.'),
    bankAddress: (v) => (v.trim().length < 5 ? 'Enter the bank’s address.' : ''),
  };
  const fmtMB = (b) => (b >= 10485760 ? Math.round(b / 1048576) : (b / 1048576).toFixed(1)) + ' MB';

  function uploadVideo(file, onProgress) {
    const email = viewer && viewer.email;
    if (cfg.uploadMode === 'local') { // development and tests: the server stores the file
      return new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', `/api/upload?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email || '')}&name=${encodeURIComponent(file.name)}`);
        x.setRequestHeader('Content-Type', file.type || 'video/mp4');
        x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
        x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status === 200 ? resolve({ url: j.url, name: j.name, bytes: j.bytes }) : reject(new Error(j.error || 'The upload didn’t finish.')); };
        x.onerror = () => reject(new Error('The upload didn’t finish. Check your connection and try again.'));
        x.send(file);
      });
    }
    // Ask the site first: Vercel's upload library replaces the site's reason with a generic message.
    return fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', token, email, bytes: file.size }) })
      .then((r) => r.json().catch(() => ({})).then((j) => { if (!r.ok) { const e = new Error(j.error || 'The upload couldn’t start.'); e.final = true; throw e; } return j; }))
      .then((j) => import('/blob-client.js').then((lib) => ({ lib, method: j.method }))).then(({ lib, method }) => {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(-80) || 'recording';
      // A store connected with BLOB_STORE_ID uses presigned uploads; one with a read-write token, client tokens.
      const send = method === 'presigned' ? lib.uploadPresigned : lib.upload;
      return send(`production-requests/${token}/${safe}`, file, {
        access: 'public', handleUploadUrl: '/api/upload', clientPayload: JSON.stringify({ token, email, bytes: file.size }),
        multipart: false, contentType: file.type || undefined, // one upload operation per recording
        onUploadProgress: (e) => onProgress(Math.round(e.percentage)),
      });
    }).then((r) => ({ url: r.url, name: file.name, bytes: file.size }))
      .catch((err) => {
        if (err.final) throw err; // the site's own reason, already clear
        const generic = /client token|presigned|failed to fetch|network|load failed|fetch/i.test(err.message || '') || err.name === 'TypeError';
        throw new Error(generic ? 'The upload couldn’t reach the storage service. This is usually a VPN, a security tool or an office network blocking it: try another network or browser, or tick Not applicable and send the recording to Lean another way.' : (err.message || 'The upload didn’t finish.') + ' Try again, or tick Not applicable.');
      });
  }

  // A replaced or removed recording is deleted straight away, so storage stays within the free plan.
  const discardVideo = (v) => { if (!v) return; fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', token, email: viewer && viewer.email, url: v.url }) }).catch(() => {}); };

  function openRequestForm(btn) {
    requestFormOpen = true;
    const ov = document.createElement('div');
    ov.className = 'bp-who-ov bp-req-ov';
    const field = (id, label, hint, attrs = '') => `<div class="rq-f" data-f="${id}"><label for="rq-${id}">${label}</label>${hint ? `<p class="rq-hint" id="rq-${id}-h">${hint}</p>` : ''}` +
      (id === 'bankAddress' || id === 'note' ? `<textarea id="rq-${id}" rows="${id === 'note' ? 2 : 3}" ${attrs}></textarea>` : `<input id="rq-${id}" ${attrs}>`) + `<p class="rq-err" id="rq-${id}-e"></p></div>`;
    ov.innerHTML = `<div class="bp-who bp-req" role="dialog" aria-modal="true" aria-labelledby="rqT"><button type="button" class="rq-x" aria-label="Close">&#10005;</button>
      <h2 id="rqT">Request production access</h2><p class="rq-lead">Lean reviews this, upgrades your application and switches this blueprint to Production.</p>
      <form novalidate>
        <fieldset><legend>1. Demo recording</legend>
          <p class="rq-hint">A screen recording of your integration working end to end in Sandbox. Video, up to 100 MB: a few minutes at 720p fits easily.</p>
          <div class="rq-video"><input type="file" id="rq-file" accept="video/*" class="rq-filein"><label for="rq-file" class="rq-drop"><b>Choose a video</b><span>or drop it here</span></label>
            <div class="rq-up" hidden><div class="rq-upname"></div><div class="rq-bar" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><div class="rq-upact"><button type="button" class="rq-link" data-rq="replace">Replace</button><button type="button" class="rq-link" data-rq="remove">Remove</button></div></div></div>
          <label class="rq-na"><input type="checkbox" id="rq-na"> Not applicable for this integration</label>
          <div class="rq-f" data-f="videoNaReason" hidden><label for="rq-videoNaReason">Why doesn’t a recording apply?</label><input id="rq-videoNaReason" maxlength="500"><p class="rq-err" id="rq-videoNaReason-e"></p></div>
          <p class="rq-err" id="rq-video-e" role="alert"></p>
        </fieldset>
        <fieldset><legend>2. Production Settlement Account</legend>
          <p class="rq-hint">The bank account that receives your funds in production. Lean uses these details to set it up.</p>
          ${field('accountHolderName', 'Account holder name', '', 'autocomplete="organization" maxlength="140"')}
          ${field('tradeLicenseNumber', 'Trade licence number', '', 'maxlength="60" autocomplete="off"')}
          ${field('iban', 'IBAN', '', 'maxlength="42" autocomplete="off" spellcheck="false" inputmode="text"')}
          ${field('accountNumber', 'Account number', '', 'maxlength="40" autocomplete="off" spellcheck="false"')}
          ${field('bankAddress', 'Bank address', '', 'maxlength="400"')}
        </fieldset>
        <fieldset><legend>3. Anything else? <span class="rq-opt">(optional)</span></legend>${field('note', 'Note for Lean', 'For example, your target go-live date.', 'maxlength="1000"')}</fieldset>
        <p class="rq-err rq-formerr" role="alert"></p>
        <div class="bp-who-act"><button type="submit" class="bp-who-go">Send request</button><button type="button" class="rq-cancel">Cancel</button></div>
      </form></div>`;
    document.body.appendChild(ov);
    const $ = (sel) => ov.querySelector(sel);
    const prevFocus = btn;
    const close = () => { ov.remove(); requestFormOpen = false; paintJourney(); if (prevFocus && document.contains(prevFocus)) prevFocus.focus(); };
    const setErr = (id, msg) => {
      const e = $(`#rq-${id}-e`); if (e) e.textContent = msg || '';
      const inp = $(`#rq-${id}`); if (inp) { inp.setAttribute('aria-invalid', msg ? 'true' : 'false'); inp.setAttribute('aria-describedby', [`rq-${id}-h`, `rq-${id}-e`].filter((x) => ov.querySelector('#' + x)).join(' ')); }
    };
    // restore the draft
    for (const k of Object.keys(RULES).concat(['note', 'videoNaReason'])) { const el = $(`#rq-${k}`); if (el) el.value = draft[k]; }
    $('#rq-na').checked = draft.videoNa;
    let uploading = false;
    const paintVideo = () => {
      const na = $('#rq-na').checked; draft.videoNa = na;
      $('.rq-video').hidden = na; $('[data-f="videoNaReason"]').hidden = !na;
      const up = $('.rq-up'), drop = $('.rq-drop');
      if (draft.video && !uploading) { up.hidden = false; drop.hidden = true; $('.rq-upname').textContent = `✓ ${draft.video.name} · ${fmtMB(draft.video.bytes)}`; $('.rq-bar').hidden = true; }
      else if (!uploading) { up.hidden = true; drop.hidden = false; }
    };
    paintVideo();
    const startUpload = (file) => {
      setErr('video', '');
      if (!file) return;
      if (!/^video\//.test(file.type || '') && !/\.(mp4|mov|webm|mkv|avi|mpeg|m4v)$/i.test(file.name)) { $('#rq-video-e').textContent = 'Choose a video file.'; return; }
      if (file.size > VIDEO_MAX) { $('#rq-video-e').textContent = `This video is ${fmtMB(file.size)}: the limit is 100 MB. Trim it, or export it at 720p.`; return; }
      uploading = true; discardVideo(draft.video); draft.video = null;
      const up = $('.rq-up'), bar = $('.rq-bar');
      up.hidden = false; $('.rq-drop').hidden = true; bar.hidden = false; $('.rq-upact').hidden = true;
      $('.rq-upname').textContent = `Uploading ${file.name} · ${fmtMB(file.size)}`;
      const prog = (pc) => { bar.querySelector('i').style.width = pc + '%'; bar.setAttribute('aria-valuenow', String(pc)); };
      prog(0);
      uploadVideo(file, prog).then((v) => { draft.video = v; uploading = false; $('.rq-upact').hidden = false; paintVideo(); })
        .catch((err) => { uploading = false; $('.rq-upact').hidden = false; paintVideo(); $('#rq-video-e').textContent = err.message; });
    };
    $('#rq-file').addEventListener('change', (e) => startUpload(e.target.files[0]));
    const drop = $('.rq-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); startUpload(e.dataTransfer.files[0]); });
    ov.addEventListener('click', (e) => {
      const a = e.target.closest('[data-rq]'); if (!a) return;
      if (a.dataset.rq === 'replace') $('#rq-file').click();
      if (a.dataset.rq === 'remove') { discardVideo(draft.video); draft.video = null; $('#rq-file').value = ''; paintVideo(); }
    });
    $('#rq-na').addEventListener('change', () => { setErr('video', ''); paintVideo(); if (draft.videoNa) $('#rq-videoNaReason').focus(); });
    for (const k of Object.keys(RULES)) {
      const el = $(`#rq-${k}`);
      el.addEventListener('input', () => { draft[k] = el.value; if (el.getAttribute('aria-invalid') === 'true') setErr(k, RULES[k](el.value)); });
      el.addEventListener('blur', () => { if (el.value) setErr(k, RULES[k](el.value)); });
    }
    $('#rq-note').addEventListener('input', (e) => { draft.note = e.target.value; });
    $('#rq-videoNaReason').addEventListener('input', (e) => { draft.videoNaReason = e.target.value; if (e.target.value.trim().length >= 3) setErr('video', ''); });
    $('.rq-x').addEventListener('click', close);
    $('.rq-cancel').addEventListener('click', close);
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        const f = [...ov.querySelectorAll('input:not([hidden]),textarea,button,label.rq-drop')].filter((x) => x.offsetParent !== null);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    setTimeout(() => $('#rq-file').focus(), 30);
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('.rq-formerr').textContent = '';
      let firstBad = null;
      for (const k of Object.keys(RULES)) { const msg = RULES[k]($(`#rq-${k}`).value); setErr(k, msg); if (msg && !firstBad) firstBad = $(`#rq-${k}`); }
      if (uploading) { $('#rq-video-e').textContent = 'Wait for the upload to finish.'; firstBad = firstBad || $('#rq-file'); }
      else if (draft.videoNa ? draft.videoNaReason.trim().length < 3 : !draft.video) {
        $('#rq-video-e').textContent = draft.videoNa ? 'Say briefly why a recording doesn’t apply.' : 'Upload the recording, or tick Not applicable.';
        firstBad = firstBad || (draft.videoNa ? $('#rq-videoNaReason') : $('#rq-file'));
      }
      if (firstBad) { firstBad.focus(); return; }
      const send = $('.bp-who-go'); send.disabled = true; send.textContent = 'Sending…';
      try {
        const body = { token, viewer: viewerPayload(), note: draft.note, videoNa: draft.videoNa, videoNaReason: draft.videoNaReason, video: draft.videoNa ? null : draft.video,
          accountHolderName: draft.accountHolderName, tradeLicenseNumber: draft.tradeLicenseNumber, iban: draft.iban, accountNumber: draft.accountNumber, bankAddress: draft.bankAddress };
        const r = await fetch('/api/production', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (j.fields) { let f = null; for (const [k, msg] of Object.entries(j.fields)) { setErr(k, msg); if (k === 'video') $('#rq-video-e').textContent = msg; f = f || $(`#rq-${k}`) || $('#rq-file'); } if (f) f.focus(); }
          throw new Error(j.error || 'The request couldn’t be sent.');
        }
        production = { ...production, requestedAt: j.requestedAt, note: j.note, summary: j.summary };
        for (const k of Object.keys(draft)) draft[k] = typeof draft[k] === 'boolean' ? false : k === 'video' ? null : '';
        ov.remove(); requestFormOpen = false; paintAll();
        document.querySelectorAll('.bp-jwrap .j-live').forEach((el) => { el.textContent = 'Request sent. Lean has been notified.'; });
        const focusTo = document.querySelector('.bp-jmain .j-step.waiting') || document.querySelector('.bp-jwrap'); if (focusTo) { focusTo.setAttribute('tabindex', '-1'); focusTo.focus(); }
      } catch (err) {
        send.disabled = false; send.textContent = 'Send request';
        $('.rq-formerr').textContent = (err.message || 'The request couldn’t be sent.') + (err.message && /highlighted/.test(err.message) ? '' : ' Try again.');
      }
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jopen]');
    if (b) openRequestForm(b);
    const g = e.target.closest('[data-jguide]');
    if (g && typeof window.openPanel === 'function') window.openPanel(g.dataset.jguide);
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
          body: JSON.stringify({ token, item: key, done: next, viewer: viewerPayload() }),
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

  // ---------- Review comments (Lean only: Lean team links and the signed Lean view, never a client's link) ----------
  const commentsOn = !local && (cfg.kind === 'internal' || !!view);
  if (commentsOn) (function reviewComments() {
    let threads = [], showResolved = false, picking = false, pending = null;
    const normT = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const BLOCKS = 'li, p, td, th, h1, h2, h3, h4, blockquote, .rv, .jtitle, .phase, .prod, .figcard, .sp-diagram, .ev, img';
    // A block's own text, without the comment badges added to it.
    const blockText = (el) => { let t = el.textContent || ''; el.querySelectorAll('.bp-cmt-badge').forEach((b) => { t = t.replace(b.textContent, ''); }); return normT(t); };
    const isUi = (el) => !!(el && el.closest && el.closest('.bp-cmt-drawer, .bp-cmt-fab, .bp-cmt-bubble, .bp-who-ov, .bp-whonote, .bp-toast'));
    const api = async (body) => {
      const r = await fetch('/api/comments', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, view: view || undefined, viewer: viewer ? { email: viewer.email } : undefined, ...body }) }
        : undefined || {});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That didn’t work. Try again.');
      return j;
    };
    const load = async () => {
      const r = await fetch('/api/comments?token=' + encodeURIComponent(token) + (view ? '&view=' + encodeURIComponent(view) : ''));
      if (!r.ok) return;
      threads = (await r.json()).threads || []; paint();
    };
    // Who's commenting: asked the first time someone comments, and must be a Lean email.
    const commenter = () => new Promise((resolve, reject) => {
      if (viewer && kindOf(viewer.email) === 'lean') return resolve(viewer);
      if (viewer) return reject(new Error('Only Lean team members can comment. Use “Not you?” to enter your Lean email.'));
      whoWaiters.push(() => (viewer && kindOf(viewer.email) === 'lean' ? resolve(viewer) : reject(new Error('Only Lean team members can comment, with an @' + (leanDomains[0] || 'leantech.me') + ' email.'))));
      whoDialog();
    });
    // Anchors: where a comment points, re-found by its block's text (and checklist key or guide).
    const anchorFor = (el, quote) => {
      const block = el.closest(BLOCKS) || el;
      const panel = block.closest('aside.spanel');
      const sec = block.closest('section');
      const title = panel ? normT((panel.querySelector('.sp-head h2, .sp-title, h2') || {}).textContent) : sec ? normT((sec.querySelector('.sec-title') || {}).textContent) : block.closest('header.hero') ? 'Hero' : '';
      const chk = block.closest('[data-check]');
      return { panel: panel ? panel.id.replace(/^panel-/, '') : null, check: chk ? chk.getAttribute('data-check') : null, section: title, tag: block.tagName.toLowerCase(),
        block: block.tagName === 'IMG' ? 'Image: ' + (block.getAttribute('alt') || '') : blockText(block).slice(0, 300), quote: normT(quote).slice(0, 500) };
    };
    const locate = (a) => {
      const scope = a.panel ? document.getElementById('panel-' + a.panel) : document.body;
      if (!scope) return null;
      if (a.check) { const el = scope.querySelector(`[data-check="${CSS.escape(a.check)}"]`); if (el) return el; }
      const want = normT(a.block).slice(0, 120);
      if (!want) return null;
      const cands = scope.querySelectorAll(a.tag && /^[a-z0-9]+$/.test(a.tag) ? a.tag : BLOCKS);
      for (const el of cands) { if (isUi(el) || (!a.panel && el.closest('aside.spanel'))) continue; const t = el.tagName === 'IMG' ? 'Image: ' + (el.getAttribute('alt') || '') : blockText(el); if (t.slice(0, 120) === want) return el; }
      return null;
    };
    const visible = () => threads.filter((t) => showResolved || t.status !== 'resolved');
    function paintMarks() {
      document.querySelectorAll('.bp-cmt-hl').forEach((el) => { el.classList.remove('bp-cmt-hl'); el.removeAttribute('data-cmt'); });
      document.querySelectorAll('.bp-cmt-badge').forEach((el) => el.remove());
      for (const t of threads.filter((x) => x.status !== 'resolved')) {
        const el = locate(t.anchor); t._found = !!el; if (!el) continue;
        el.classList.add('bp-cmt-hl');
        const ids = (el.getAttribute('data-cmt') || '').split(' ').filter(Boolean).concat(String(t.id)); el.setAttribute('data-cmt', ids.join(' '));
      }
      for (const t of threads.filter((x) => x.status === 'resolved')) t._found = !!locate(t.anchor);
      document.querySelectorAll('.bp-cmt-hl').forEach((el) => {
        if (el.tagName === 'IMG' || el.tagName === 'TD' || el.tagName === 'TH') return;
        const ids = el.getAttribute('data-cmt').split(' ');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'bp-cmt-badge'; b.textContent = '💬 ' + ids.length;
        b.setAttribute('aria-label', `${ids.length} review comment${ids.length === 1 ? '' : 's'}`); b.onclick = (e) => { e.stopPropagation(); openDrawer(); focusThread(Number(ids[0])); };
        el.appendChild(b);
      });
    }
    // The drawer
    const drawer = document.createElement('aside');
    drawer.className = 'bp-cmt-drawer'; drawer.setAttribute('aria-label', 'Review comments'); drawer.hidden = true;
    const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'bp-cmt-fab';
    const bubble = document.createElement('button'); bubble.type = 'button'; bubble.className = 'bp-cmt-bubble'; bubble.textContent = '💬 Comment'; bubble.hidden = true;
    document.body.append(drawer, fab, bubble);
    fab.onclick = () => (drawer.hidden ? openDrawer() : closeDrawer());
    function openDrawer() { drawer.hidden = false; fab.setAttribute('aria-expanded', 'true'); paint(); }
    function closeDrawer() { drawer.hidden = true; fab.setAttribute('aria-expanded', 'false'); stopPicking(); pending = null; }
    const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    function paint() {
      const open = threads.filter((t) => t.status !== 'resolved').length, done = threads.length - open;
      fab.textContent = open ? `💬 Comments · ${open} open` : '💬 Comments';
      paintMarks();
      if (drawer.hidden) return;
      const items = visible();
      drawer.innerHTML = `<div class="cm-head"><h2>Review comments</h2><button type="button" class="cm-x" aria-label="Close">✕</button></div>
        <p class="cm-sub">Only the Lean team sees these. Clients never do.</p>
        <div class="cm-tools"><button type="button" class="cm-pick">${picking ? 'Click a section to comment… (Esc to cancel)' : '＋ Comment on a section'}</button>
          <label class="cm-res"><input type="checkbox" ${showResolved ? 'checked' : ''}> Show resolved (${done})</label></div>
        <p class="cm-tip">Or select any text on the page and click <b>💬 Comment</b>.</p>
        <div class="cm-new"></div>
        <div class="cm-list">${items.length ? items.map(threadHtml).join('') : `<p class="cm-empty">${threads.length ? 'No open comments.' : 'No comments yet.'}</p>`}</div>`;
      drawer.querySelector('.cm-x').onclick = closeDrawer;
      drawer.querySelector('.cm-pick').onclick = () => (picking ? stopPicking() : startPicking());
      drawer.querySelector('.cm-res input').onchange = (e) => { showResolved = e.target.checked; paint(); };
      if (pending) composer();
      drawer.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => goTo(Number(b.dataset.go))));
      drawer.querySelectorAll('[data-reply]').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); act({ action: 'reply', threadId: Number(f.dataset.reply), body: f.querySelector('textarea').value }, f); }));
      drawer.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = () => act({ action: 'resolve', threadId: Number(b.dataset.resolve), resolved: b.dataset.to === '1' })));
      drawer.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { if (confirm('Delete your comment?')) act({ action: 'delete', commentId: Number(b.dataset.del) }); }));
    }
    function threadHtml(t) {
      const a = t.anchor || {}; const me = viewer && viewer.email;
      const where = a.quote || a.block;
      return `<article class="cm-t${t.status === 'resolved' ? ' resolved' : ''}" id="cmt-${t.id}" tabindex="-1">
        <button type="button" class="cm-where" data-go="${t.id}">${a.section ? `<span class="cm-sec">${escH(a.section)}</span>` : ''}${where ? `“${escH(where.slice(0, 140))}${where.length > 140 ? '…' : ''}”` : 'The page'}</button>
        ${t._found === false ? '<p class="cm-gone">The text this refers to has changed or moved.</p>' : ''}
        ${t.comments.map((c) => `<div class="cm-c"><div class="cm-meta"><b>${escH(c.author_name || c.author_email)}</b> · ${escH(when(c.created_at))}${me && c.author_email === me ? ` · <button type="button" class="cm-l" data-del="${c.id}">Delete</button>` : ''}</div><div class="cm-body">${escH(c.body)}</div></div>`).join('')}
        ${t.status === 'resolved' ? `<p class="cm-meta">Resolved${t.resolved_by ? ' by ' + escH(t.resolved_by.split('@')[0]) : ''} · <button type="button" class="cm-l" data-resolve="${t.id}" data-to="0">Reopen</button></p>`
          : `<form class="cm-reply" data-reply="${t.id}"><label class="cm-sr" for="rp-${t.id}">Reply</label><textarea id="rp-${t.id}" rows="1" placeholder="Reply…" maxlength="4000"></textarea><div class="cm-act"><button type="submit" class="cm-b">Reply</button><button type="button" class="cm-b ghost" data-resolve="${t.id}" data-to="1">✓ Resolve</button></div></form>`}
      </article>`;
    }
    function composer() {
      const box = drawer.querySelector('.cm-new'); if (!box || !pending) return;
      box.innerHTML = `<form class="cm-compose"><div class="cm-where static">${pending.section ? `<span class="cm-sec">${escH(pending.section)}</span>` : ''}“${escH((pending.quote || pending.block || '').slice(0, 160))}”</div>
        <label class="cm-sr" for="cm-body">Comment</label><textarea id="cm-body" rows="3" maxlength="4000" placeholder="Add a comment for the Lean team…"></textarea>
        <p class="cm-err" role="alert"></p><div class="cm-act"><button type="submit" class="cm-b">Comment</button><button type="button" class="cm-b ghost cm-cancel">Cancel</button></div></form>`;
      const f = box.querySelector('form'); const ta = f.querySelector('textarea'); setTimeout(() => ta.focus(), 20);
      f.querySelector('.cm-cancel').onclick = () => { pending = null; box.innerHTML = ''; };
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const err = f.querySelector('.cm-err'); err.textContent = '';
        if (!ta.value.trim()) { err.textContent = 'Write a comment first.'; ta.focus(); return; }
        const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Posting…';
        try { await commenter(); const j = await api({ action: 'create', anchor: pending, body: ta.value }); threads = j.threads; pending = null; paint(); focusThread(j.threadId); }
        catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Comment'; }
      });
    }
    async function act(body, form) {
      try {
        if (body.action === 'reply' && !body.body.trim()) return;
        await commenter();
        const j = await api(body); threads = j.threads; paint();
        if (body.threadId) focusThread(body.threadId);
      } catch (x) { toast(x.message); if (form) form.querySelector('textarea').focus(); }
    }
    function focusThread(id) { const el = drawer.querySelector('#cmt-' + id); if (el) { el.scrollIntoView({ block: 'nearest' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); } }
    function goTo(id) {
      const t = threads.find((x) => x.id === id); if (!t) return;
      if (t.anchor.panel && typeof window.openPanel === 'function') window.openPanel(t.anchor.panel);
      setTimeout(() => { const el = locate(t.anchor); if (!el) { toast('The text this comment refers to has changed or moved.'); return; } el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('bp-cmt-flash'); setTimeout(() => el.classList.remove('bp-cmt-flash'), 1600); }, t.anchor.panel ? 350 : 0);
    }
    const newComment = (anchor) => { pending = anchor; openDrawer(); };
    // Selecting text offers "Comment"
    document.addEventListener('mouseup', () => setTimeout(() => {
      const sel = window.getSelection(); const txt = sel && String(sel).trim();
      if (!txt || txt.length < 2 || !sel.rangeCount) { bubble.hidden = true; return; }
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (!node || isUi(node)) { bubble.hidden = true; return; }
      const range = sel.getRangeAt(0);
      let r = range.getBoundingClientRect();
      if (!r.width && !r.height) r = [...range.getClientRects()].find((x) => x.width || x.height) || node.getBoundingClientRect(); // some selections report an empty box
      bubble.style.top = Math.min(window.innerHeight - 52, Math.max(8, r.top - 40)) + 'px'; bubble.style.left = Math.min(window.innerWidth - 130, Math.max(8, r.left + r.width / 2 - 55)) + 'px';  // both kept on screen
      bubble.hidden = false; bubble._anchor = anchorFor(node, txt);
    }, 0));
    document.addEventListener('scroll', () => { bubble.hidden = true; }, true);
    bubble.onmousedown = (e) => e.preventDefault();
    bubble.onclick = () => { const a = bubble._anchor; bubble.hidden = true; window.getSelection().removeAllRanges(); if (a) newComment(a); };
    // "Comment on a section": click any block
    const hover = (e) => { document.querySelectorAll('.bp-cmt-pickhl').forEach((x) => x.classList.remove('bp-cmt-pickhl')); const el = e.target.closest && e.target.closest(BLOCKS); if (el && !isUi(el)) el.classList.add('bp-cmt-pickhl'); };
    const pick = (e) => { if (isUi(e.target)) return; const el = e.target.closest && e.target.closest(BLOCKS); if (!el) return; e.preventDefault(); e.stopPropagation(); stopPicking(); newComment(anchorFor(el, '')); };
    const esc = (e) => { if (e.key === 'Escape') { stopPicking(); paint(); } };
    function startPicking() { picking = true; document.body.classList.add('bp-cmt-picking'); document.addEventListener('mouseover', hover, true); document.addEventListener('click', pick, true); document.addEventListener('keydown', esc, true); paint(); }
    function stopPicking() { if (!picking) return; picking = false; document.body.classList.remove('bp-cmt-picking'); document.removeEventListener('mouseover', hover, true); document.removeEventListener('click', pick, true); document.removeEventListener('keydown', esc, true); document.querySelectorAll('.bp-cmt-pickhl').forEach((x) => x.classList.remove('bp-cmt-pickhl')); }
    // A one-time tip, so reviewers know how to comment
    try {
      if (!localStorage.getItem('leanbp-review-tip')) {
        const tip = document.createElement('div'); tip.className = 'bp-cmt-tip'; tip.setAttribute('role', 'note');
        tip.innerHTML = '<b>Review mode</b><p>Select any text and click <b>💬 Comment</b>, or open <b>💬 Comments</b> (bottom right) to comment on a section, image or guide step. Only the Lean team sees comments: clients never do.</p><button type="button">Got it</button>';
        tip.querySelector('button').onclick = () => { tip.remove(); try { localStorage.setItem('leanbp-review-tip', '1'); } catch {} };
        document.body.appendChild(tip);
      }
    } catch {}
    load().then(() => { const m = location.hash.match(/^#comment-(\d+)$/); if (m) { openDrawer(); focusThread(Number(m[1])); goTo(Number(m[1])); } });
  })();

  fetch('/api/checklist?token=' + encodeURIComponent(token) + (view ? '&view=' + encodeURIComponent(view) : ''))
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      if (data.mode === 'edit') {
        readOnly = !clientViewer(); // Lean colleagues and other emails see it read only
        state = data.items || {};
        environment = data.environment || 'sandbox';
        production = data.production || {};
        canRequest = !view && clientViewer();
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
      // When someone answers "who's viewing" after the page loaded, apply it straight away.
      applyWho = () => { readOnly = data.mode !== 'edit' || !clientViewer(); canRequest = data.mode === 'edit' && !view && clientViewer(); paintAll(); whoNote(); };
      whoNote();
    })
    .catch(() => {
      paintAll();
      toast('Checklist progress couldn’t load. Reload the page to try again.');
    });
})();
