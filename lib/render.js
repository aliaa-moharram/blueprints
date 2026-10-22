// Turns the content saved by the admin form into a finished blueprint page,
// using the Wise blueprint design (lib/template.js) and the product library (lib/products.js).
import { FONT_LINKS, LEAN_LOGO, PANEL_SCRIPT, STYLES } from './template.js';
import { getProduct, PANELS, PRODUCTS, ENDPOINT_LINKS, PREREQUISITES, PREREQUISITE_PRODUCTS, SETUP_GROUP, TERMS, E2E_ROW } from './products.js';
import { syncPlan } from '../public/plan.js';
import { themeFor } from '../public/theme.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Plain text with **bold** support. Nothing else is interpreted.
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const has = (s) => typeof s === 'string' && s.trim() !== '';
const isImage = (s) => typeof s === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u.trim()) ? u.trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const pad = (n) => String(n).padStart(2, '0');

// Injected only in edit mode: makes marked text editable and reports changes to the admin page.
const EDIT_SCRIPT = `<style>
[data-edit]{outline:1px dashed transparent;outline-offset:3px;border-radius:3px;cursor:text;transition:outline-color .15s}
[data-edit]:hover{outline-color:color-mix(in srgb,var(--bright) 70%,transparent)}
[data-edit]:focus{outline:2px solid var(--bright);outline-offset:3px}
[data-edit]:empty::before{content:attr(data-ph);color:#9aa3ae;font-style:italic}
.lb-editbar{position:fixed;left:12px;bottom:12px;z-index:300;background:#1c2024;color:#fff;font:600 13px/1.4 system-ui,sans-serif;
  padding:8px 14px;border-radius:999px;border:1px solid var(--bright);box-shadow:0 6px 20px rgba(0,0,0,.25)}
</style>
<div class="lb-editbar">Click any text to edit it. Images, products and layout are edited in the form.</div>
<script>
(function () {
  function value(el) {
    if (!el.dataset.rich) return el.innerText.replace(/\\s+/g, ' ').trim();
    var c = el.cloneNode(true);
    c.querySelectorAll('img,.pill').forEach(function (n) { n.remove(); });
    var h = c.innerHTML.replace(/<(b|strong)>/gi, '**').replace(/<\\/(b|strong)>/gi, '**').replace(/<br\\s*\\/?>/gi, ' ').replace(/<[^>]+>/g, '');
    var t = document.createElement('textarea'); t.innerHTML = h;
    return t.value.replace(/\\s+/g, ' ').replace(/\\*\\*\\s*\\*\\*/g, '').trim();
  }
  document.querySelectorAll('[data-edit]').forEach(function (el) {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.addEventListener('input', function () { parent.postMessage({ type: 'lb-edit', path: el.dataset.edit, value: value(el) }, '*'); });
    el.addEventListener('paste', function (e) { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });
  document.addEventListener('click', function (e) { var a = e.target.closest('a'); if (a) e.preventDefault(); }, true);
})();
</script>`;

const DEFAULTS = {
  journeysTitle: 'The customer journey, end to end',
  launchIntro: 'How the integration is delivered: the Lean products involved, what ships in each phase, the APIs behind it, and the effort to build.',
  designTitle: 'Design reference: UX best practices',
};

// Resolves a product card or table row to its display fields.
function productFor(entry, client) {
  const lib = entry.product && entry.product !== 'custom' ? getProduct(entry.product) : null;
  const c = entry.custom || {};
  return {
    lib,
    name: lib ? lib.name : c.name || 'Untitled product',
    sub: lib ? lib.sub : c.sub || '',
    card: has(entry.card) ? entry.card : lib ? lib.card : c.card || '',
    apis: lib ? lib.apis : lines(c.apis),
    apiNote: (has(entry.note) ? entry.note : lib ? lib.apiNote : '').replaceAll('{client}', client),
    toBeScoped: lib ? !!lib.toBeScoped : false,
    effort: has(entry.effort) ? entry.effort : lib ? lib.effort : 'TBC',
  };
}

function clientMark(c, client, where) {
  const logo = c.client && c.client.logo;
  if (c.header && c.header.mode === 'logo' && isImage(logo)) {
    const size = { small: 's', medium: 'm', large: 'l' }[c.header.logoSize] || 'm';
    return `<span class="client-logo${where === 'header' ? ' ' + size : ''}"><img src="${logo}" alt="${esc(client)}"></span>`;
  }
  return `<span class="client-name">${esc(client)}</span>`;
}

// [[key|word]] in guide text becomes the word with its definition shown on hover or focus.
const withTerms = (h) => String(h ?? '').replace(/\[\[([a-z]+)\|([^\]]+)\]\]/g, (m, key, word) =>
  TERMS[key] ? `<span class="term" tabindex="0">${word}<span class="tip" role="tooltip">${esc(TERMS[key])}</span></span>` : word);

export function panelHtml(pid, kicker, name, client = 'Your') {
  const p0 = PANELS[pid];
  if (!p0) return '';
  const tx = (v) => (Array.isArray(v) ? v.map(withTerms) : typeof v === 'string' ? withTerms(v) : v);
  const p = { ...p0, sub: tx(p0.sub), pre: tx(p0.pre), steps: tx(p0.steps), prodSteps: tx(p0.prodSteps), extra: tx(p0.extra),
    stepGroups: list(p0.stepGroups).map((g) => ({ ...g, steps: tx(g.steps) })),
    sections: list(p0.sections).map((x) => ({ ...x, html: withTerms(x.html) })) };
  const steps = list(p.steps).map((s, i) => `<li data-check="${pid}-${i + 1}">${s}</li>`).join('');
  // A run-book: several titled lists, numbered continuously so "step 4" always means the same step.
  let offset = 0;
  const grouped = list(p.stepGroups).map((g) => {
    const start = offset; offset += list(g.steps).length;
    return `<div class="sp-h">${esc(g.title)}</div>
    <ol class="sp-check" style="counter-reset:spc ${start}">${g.steps.map((s, i) => `<li data-check="${pid}-${start + i + 1}">${s}</li>`).join('')}</ol>`;
  }).join('\n    ');
  // Production steps: keys contain "-prod-", so they can be ticked but aren't counted in progress.
  const prod = list(p.prodSteps).length ? `
    <div class="sp-h">${esc(p.prodTitle || 'Production')}</div>
    ${p.prodNote ? `<p class="sp-note" style="margin:-4px 0 10px">${p.prodNote}</p>` : ''}
    <ol class="sp-check">${p.prodSteps.map((s, i) => `<li data-check="${pid}-prod-${i + 1}">${s}</li>`).join('')}</ol>` : '';
  return `<aside class="spanel" id="panel-${pid}" role="dialog" aria-modal="true" aria-label="${esc(name)} implementation guide">
  <div class="sp-head">
    <div class="sp-kicker">${esc(kicker)} &middot; Implementation guide</div>
    <div class="sp-title">${p.title}</div>
    <div class="sp-sub">${p.sub}</div>
    <button class="sp-close" onclick="closePanels()" aria-label="Close">&#10005;</button>
  </div>
  <div class="sp-body">
    ${list(p.pre).length ? `<div class="sp-h">Before you start</div>
    <ul class="sp-pre">${p.pre.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${list(p.diagrams).length ? `<div class="sp-h">How it works</div>
    ${p.diagrams.map((d) => `${d.title ? `<div class="sp-sub-h">${esc(d.title)}</div>` : ''}<div class="sp-diagram">${String(d.svg).replaceAll('{client}', esc(client))}</div>`).join('\n    ')}` : ''}
    ${grouped || `<div class="sp-h">Integration checklist</div>
    <ol class="sp-check">${steps}</ol>`}${prod}
    ${list(p.extra).length ? `<div class="sp-h">${esc(p.extraTitle || 'Also')}</div>
    <ul class="sp-pre">${p.extra.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${list(p.sections).map((x) => (x.collapsible
      ? `<details class="sp-more"><summary>${esc(x.title)}</summary><div class="sp-section">${x.html}</div></details>`
      : `<div class="sp-h">${esc(x.title)}</div>
    <div class="sp-section">${x.html}</div>`)).join('\n    ')}
    ${list(p.endpoints).length ? `<div class="sp-h">Endpoints</div>
    <div class="sp-codes">${p.endpoints.map(endpointChip).join('')}</div>` : ''}
    ${p.links.length ? `<div class="sp-h">Lean docs</div>
    <div class="sp-links">${p.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>` : ''}
    ${p.note ? `<p class="sp-note">${p.note}</p>` : ''}
  </div>
</aside>`;
}

// An endpoint chip; it links to Lean's v4 API reference when the endpoint has a page there.
const endpointChip = (a) => (ENDPOINT_LINKS[a]
  ? `<a class="apilink" href="${esc(ENDPOINT_LINKS[a])}" target="_blank" rel="noopener" title="Open in Lean’s API reference"><code>${esc(a)}</code></a>`
  : `<code>${esc(a)}</code>`);

// The Phase 0 · Setup rows at the top of the plan table.
const setupRow = (p) => `        <tr>
          <td>${esc(p.name)}<br><span class="sub">${esc(p.sub)}</span></td>
          <td class="apis">${list(p.apis).map(endpointChip).join('')}${list(p.refs).length ? `<span class="api-refs">${p.refsLabel ? esc(p.refsLabel) + ': ' : ''}${p.refs.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`).join(', ')}</span>` : ''}${p.eventsHtml || ''}<span class="api-desc">${esc(p.note)}</span></td>
          <td class="eff">-</td>
          <td class="ck">${p.panel && PANELS[p.panel] ? `<button class="guide-btn" onclick="openPanel('${p.panel}')">View guide</button>` : '-'}</td>
        </tr>
`;
function prerequisitesRows() {
  return `        <tr class="grp"><td colspan="4">${esc(SETUP_GROUP)}</td></tr>\n${PREREQUISITES.map(setupRow).join('')}`;
}
// For hand-edited files: the end-to-end row and its guide.
export function e2eHtml(phaseLabel, client) {
  return { row: setupRow(E2E_ROW), panel: panelHtml(E2E_ROW.panel, phaseLabel, PANELS[E2E_ROW.panel].title, client) };
}
const setupPanels = (client) => PREREQUISITES.filter((p) => p.panel && PANELS[p.panel]).map((p) => panelHtml(p.panel, SETUP_GROUP.split(' · ')[0], PANELS[p.panel].title, client));

// Prerequisites row export for hand-edited files: the row and its guide panel.
export function prerequisitesHtml(client) {
  return { rows: prerequisitesRows(), panels: setupPanels(client) };
}

export function renderBlueprint(c, opts = {}) {
  c = c || {};
  const L0 = c.launch || {};
  if ((L0.assign && Object.keys(L0.assign).length) || (L0.custom && L0.custom.length)) { c = structuredClone(c); syncPlan(c, PRODUCTS); }
  // Edit mode (the "Edit on the page" tab): every text is marked with the form field it comes from.
  const edit = !!opts.edit;
  const E = (path, isRich, ph) => (edit ? ` data-edit="${path}"${isRich ? ' data-rich="1"' : ''}${ph ? ` data-ph="${esc(ph)}"` : ''}` : '');
  const wrap = (path, isRich, html) => (edit ? `<span${E(path, isRich)}>${html}</span>` : html);
  const show = (v) => edit || has(v);
  const client = has(c.client && c.client.name) ? c.client.name.trim() : 'Client';
  const meta = c.meta || {};
  const theme = themeFor(c.theme);
  const design = c.design || {};
  const designUrl = safeUrl(design.fileUrl);
  const title = `${client}${has(meta.market) ? ' ' + meta.market.trim() : ''} Integration Blueprint - Prepared by Lean`;
  let sec = 0;

  // ---------- header, hero, summary ----------
  const metaItems = [['Prepared by', meta.preparedBy], ['Market', meta.market], ['Vertical', meta.vertical]]
    .filter(([, v]) => has(v))
    .map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('\n      ');
  let html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${FONT_LINKS}
<style>${STYLES}
.journey.noshot{grid-template-columns:1fr !important}
</style>
${c.theme && c.theme.mode === 'client' ? `<style>:root{--bright:${theme.accent};--bright-ink:${theme.ink};--on-bright:${theme.ink}}</style>` : ''}
</head>
<body>

<div class="authorband">
  <div class="wrap ab-inner">
    <div class="ab-lock">
      <span class="lean-logo">${LEAN_LOGO}</span>
      <span class="lock-x">x</span>
      ${clientMark(c, client, 'header')}
    </div>
  </div>
</div>

<header class="hero">
  <div class="wrap">
    <h1>Integration<br><span class="g">Blueprint</span></h1>
    ${show(c.hero && c.hero.subtitle) ? `<p class="sub"${E('hero.subtitle', 1, 'Add a subtitle')}>${rich(c.hero && c.hero.subtitle)}</p>` : ''}
    ${metaItems ? `<div class="meta">\n      ${metaItems}\n    </div>` : ''}
  </div>
</header>
`;
  if (show(c.summary)) {
    html += `
<section style="padding-bottom:0">
  <div class="wrap">
    <div class="execsum">
      <p class="lead"${E('summary', 1, 'Add a summary')}>${rich(c.summary)}</p>
    </div>
  </div>
</section>
`;
  }

  // ---------- pain points ----------
  const pain = c.pain || {};
  const rows = list(pain.rows).map((r, i) => ({ ...r, _i: i })).filter((r) => has(r.pain) || has(r.solve) || has(r.advantage));
  if (rows.length) {
    sec++;
    const group = (key, label) => {
      const g = rows.filter((r) => (r.group || 'business') === key);
      if (!g.length) return '';
      return `
    <h3 class="sub-h">${label}</h3>
    <table class="pstable">
      <thead><tr><th>Pain point / opportunity</th><th>How Lean solves it</th><th>Advantage</th></tr></thead>
      <tbody>
${g.map((r) => `        <tr>
          <td class="pain-c"${E(`pain.rows.${r._i}.pain`, 1)}>${rich(r.pain)}</td>
          <td class="solve-c"${E(`pain.rows.${r._i}.solve`, 1)}>${rich(r.solve)}</td>
          <td class="adv-c"${E(`pain.rows.${r._i}.advantage`, 1)}>${rich(r.advantage)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
    };
    html += `
<section>
  <div class="wrap">
    <div class="sec-head"><span class="sec-num">${pad(sec)}</span><h2 class="sec-title">Pain points &amp; opportunities</h2></div>
    ${show(pain.intro) ? `<p class="sec-intro"${E('pain.intro', 1, 'Add an introduction')}>${rich(pain.intro)}</p>` : ''}
${group('business', 'Business impact')}
${group('technical', 'Technical &amp; operational')}
  </div>
</section>
`;
  }

  // ---------- journeys and design reference ----------
  const j = c.journeys || {};
  const journeys = list(j.items).map((x, i) => ({ ...x, _i: i })).filter((x) => has(x.title) || has(x.feature) || has(x.need));
  const designImages = list(design.images).filter(isImage).slice(0, 3);
  const designFlows = list(design.flows).filter((f) => has(f.name) && safeUrl(f.url));
  const designBlock = design.enabled ? `
      <div class="figwrap">
        <h3 class="sub-h"${E('design.title')}>${esc(has(design.title) ? design.title : DEFAULTS.designTitle)}</h3>
        ${show(design.subtitle) ? `<p class="sec-sub"${E('design.subtitle', 1, 'Add a subtitle')}>${rich(design.subtitle)}</p>` : ''}
        <div class="figcard figcard2">
          <div class="fighead">
            ${designImages.length ? `<div class="figshots">
              ${designImages.map((src, i) => `<img src="${src}" alt="Design preview ${i + 1}">`).join('\n              ')}
            </div>` : ''}
            <div class="figmeta">
              <div class="figkicker">Figma file</div>
              <div class="figname"${E('design.name')}>${esc(has(design.name) ? design.name : `Lean x ${client}`)}</div>
              ${show(design.description) ? `<div class="figdesc"${E('design.description', 1, 'Add a description')}>${rich(design.description)}</div>` : ''}
              ${designUrl ? `<a class="figbtn" href="${esc(designUrl)}" target="_blank" rel="noopener">Open in Figma &rarr;</a>` : ''}
            </div>
          </div>
          ${designFlows.length ? `<div class="figflows">
            ${designFlows.map((f) => `<a class="figflow" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener"><span class="ff-name">${esc(f.name)}</span><span class="ff-sub">${rich(f.description)}</span><span class="ff-arrow">&rarr;</span></a>`).join('\n            ')}
          </div>` : ''}
        </div>
      </div>
` : '';
  if (journeys.length || designBlock) {
    sec++;
    const chips = list(j.useCases).filter(has);
    html += `
<section${rows.length ? ' style="padding-top:0"' : ''}>
  <div class="wrap">
    <div class="sec-head"><span class="sec-num">${pad(sec)}</span><h2 class="sec-title"${E('journeys.title')}>${esc(has(j.title) ? j.title : DEFAULTS.journeysTitle)}</h2></div>
    ${show(j.intro) ? `<p class="sec-intro"${E('journeys.intro', 1, 'Add an introduction')}>${rich(j.intro)}</p>` : ''}
    ${chips.length ? `<div class="usecases">
      ${chips.map((u) => `<span class="uc">${esc(u)}</span>`).join('')}
    </div>` : ''}
    <div class="journeys">
${journeys.map((x, i) => {
  const imgs = list(x.images).filter(isImage).slice(0, 2);
  const cls = ['journey', imgs.length === 2 ? 'multi' : '', i % 2 === 1 ? 'rev' : '', x.unconfirmed ? 'dotted' : '', imgs.length ? '' : 'noshot'].filter(Boolean).join(' ');
  const shot = imgs.length === 2
    ? `<div class="jshot"><div class="phonestack">\n          ${imgs.map((src, k) => `<div class="phone"><img src="${src}" alt="${esc(x.title || 'Journey')} screen ${k + 1}"></div>`).join('\n          ')}\n        </div></div>`
    : imgs.length === 1 ? `<div class="jshot"><div class="phone"><img src="${imgs[0]}" alt="${esc(x.title || 'Journey')} screen"></div></div>` : '';
  const pills = list(x.products).map((id) => getProduct(id)).filter(Boolean).map((p) => p.name).concat(lines(x.otherProducts));
  const also = has(x.alsoCovers)
    ? `\n            <div class="row"><div class="rk">Also covers</div><div class="rv">${isImage(x.alsoImage) ? `<img class="rowthumb" src="${x.alsoImage}" alt="${esc(x.title || 'Journey')}, also covers">` : ''}${wrap(`journeys.items.${x._i}.alsoCovers`, 1, rich(x.alsoCovers))}</div></div>` : '';
  return `      <div class="${cls}">
        ${shot}
        <div class="jbody">
          <div class="jtag"><span class="ix">Journey ${i + 1}</span> ${wrap(`journeys.items.${x._i}.tag`, 0, esc(x.tag))}</div>
          <h2 class="jtitle"${E(`journeys.items.${x._i}.title`)}>${esc(x.title)}</h2>
          <div class="rowset">
            ${has(x.feature) ? `<div class="row"><div class="rk">${esc(client)} feature</div><div class="rv"${E(`journeys.items.${x._i}.feature`, 1)}>${rich(x.feature)}</div></div>` : ''}
            ${has(x.need) ? `<div class="row"><div class="rk">The need</div><div class="rv"${E(`journeys.items.${x._i}.need`, 1)}>${rich(x.need)}</div></div>` : ''}
            ${pills.length || has(x.powers) ? `<div class="row"><div class="rk">Lean powers it</div><div class="rv">${pills.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}${wrap(`journeys.items.${x._i}.powers`, 1, rich(x.powers))}</div></div>` : ''}${also}
          </div>
        </div>
      </div>`;
}).join('\n\n')}
${designBlock}
    </div>
  </div>
</section>
`;
  }

  // ---------- launch plan ----------
  const l = c.launch || {};
  const cards = list(l.products).map((e) => ({ e, p: productFor(e, client) }));
  const phases = list(l.phases).map((p, i) => ({ ...p, _i: i })).filter((p) => has(p.title) || list(p.rows).length);
  const e2ePhase = phases.find((ph) => list(ph.rows).some((r) => PREREQUISITE_PRODUCTS.includes(r.product)));
  const panels = [];
  const seenPanels = new Set();
  if (cards.length || phases.length) {
    sec++;
    let e2ePanel = '';
    const tableRows = phases.filter((ph) => list(ph.rows).length).map((ph) => {
      const label = has(ph.label) ? ph.label : 'Phase';
      const chip = has(ph.chip) ? ` <span class="tbc" style="margin-left:8px">${esc(ph.chip)}</span>` : '';
      const body = list(ph.rows).map((row) => {
        const p = productFor(row, client);
        const apis = p.toBeScoped && !p.apis.length ? '<span class="tbc">To be scoped</span>' : p.apis.map(endpointChip).join('');
        const note = has(p.apiNote) ? `<span class="api-desc">${rich(p.apiNote)}</span>` : '';
        let impl = '-';
        if (p.lib && p.lib.panel && PANELS[p.lib.panel]) {
          impl = `<button class="guide-btn" onclick="openPanel('${p.lib.panel}')">View guide</button>`;
          if (!seenPanels.has(p.lib.panel)) { seenPanels.add(p.lib.panel); panels.push(panelHtml(p.lib.panel, label, p.name, client)); }
        } else if (row.link && has(row.link.label) && safeUrl(row.link.url)) {
          impl = `<a href="${esc(safeUrl(row.link.url))}" target="_blank" rel="noopener">${esc(row.link.label)}</a>`;
        } else if (p.lib && p.lib.linkFromDesign && designUrl) {
          impl = `<a href="${esc(designUrl)}" target="_blank" rel="noopener">${esc(p.lib.linkFromDesign)}</a>`;
        }
        return `        <tr>
          <td>${esc(p.name)}${has(p.sub) ? `<br><span class="sub">${esc(p.sub)}</span>` : ''}</td>
          <td class="apis">${apis}${note}</td>
          <td class="eff"${p.lib ? E(`launch.assign.${p.lib.id}.effort`) : ''}>${esc(p.effort)}</td>
          <td class="ck">${impl}</td>
        </tr>`;
      }).join('\n');
      let tail = '';
      if (ph === e2ePhase && PANELS[E2E_ROW.panel]) { tail = setupRow(E2E_ROW); e2ePanel = panelHtml(E2E_ROW.panel, label, PANELS[E2E_ROW.panel].title, client); }
      return `        <tr class="grp"><td colspan="4">${esc(label)} &middot; ${esc(ph.title)}${chip}</td></tr>\n${body}${tail ? '\n' + tail.replace(/\n$/, '') : ''}`;
    }).join('\n');
    const hasPrereq = phases.some((ph) => list(ph.rows).some((r) => PREREQUISITE_PRODUCTS.includes(r.product)));
    if (hasPrereq) panels.unshift(...setupPanels(client));
    if (e2ePanel) panels.push(e2ePanel);
    const totals = list(l.totals).filter((t) => has(t.label) || has(t.value));
    html += `
<section>
  <div class="wrap">
    <div class="sec-head"><span class="sec-num">${pad(sec)}</span><h2 class="sec-title">Launch Plan</h2></div>
    <p class="sec-intro"${E('launch.intro', 1)}>${rich(has(l.intro) ? l.intro : DEFAULTS.launchIntro)}</p>
${cards.length ? `
    <h3 class="sub-h">Lean products</h3>
    <div class="prod-block">
      <div class="prods">
${cards.map(({ e, p }) => `        <div class="prod"><span class="${e.status === 'future' ? 'ext' : 'core'}">${e.status === 'future' ? 'Future' : 'In scope'}</span><h3>${esc(p.name)}</h3>${has(p.card) ? `<p${p.lib ? E(`launch.assign.${p.lib.id}.card`, 1) : ''}>${rich(p.card)}</p>` : ''}</div>`).join('\n')}
      </div>
    </div>` : ''}
${phases.length ? `
    <h3 class="sub-h">Delivery phases</h3>

    <div class="phases">
${phases.map((ph) => {
  const ids = [...new Set(list(ph.rows).map((r) => getProduct(r.product)).filter((p) => p && p.panel && PANELS[p.panel]).map((p) => p.panel))].concat(ph === e2ePhase && PANELS[E2E_ROW.panel] ? [E2E_ROW.panel] : []);
  return `      <div class="phase${ph.unconfirmed ? ' dotted' : ''}"${ids.length ? ` data-panels="${ids.join(' ')}"` : ''}><span class="ph"${E(`launch.phases.${ph._i}.label`)}>${esc(has(ph.label) ? ph.label : 'Phase')}</span><h3${E(`launch.phases.${ph._i}.title`)}>${esc(ph.title)}</h3>${lines(ph.bullets).length ? `<ul>${lines(ph.bullets).map((b, k) => `<li${E(`launch.phases.${ph._i}.bullets#${k}`, 1)}>${rich(b)}</li>`).join('')}</ul>` : ''}</div>`;
}).join('\n')}
    </div>
${tableRows ? `
    <h3 class="sub-h">Scope, APIs and build</h3>
    <p class="sec-sub">Grouped by the phases above: each product, its APIs, the effort to build, and where to start.</p>
    <table class="maptable">
      <thead><tr><th>Product</th><th>APIs needed</th><th>Effort</th><th>Implementation details</th></tr></thead>
      <tbody>
${hasPrereq ? prerequisitesRows() : ''}${tableRows}
      </tbody>
    </table>` : ''}` : ''}
    ${show(l.note) ? `<p class="stages-note"${E('launch.note', 1, 'Add a note under the table (optional)')}>${rich(l.note)}</p>` : ''}
${totals.length || has(l.summary) ? `    <div class="calc">
      <h4>Total implementation time</h4>
      ${totals.length ? `<ul class="tot-list">
${totals.map((t, k) => `        <li>${wrap(`launch.totals.${list(l.totals).indexOf(t)}.label`, 1, rich(t.label))}${has(t.value) ? `: <b${E(`launch.totals.${list(l.totals).indexOf(t)}.value`)}>${esc(t.value)}</b>` : ''}</li>`).join('\n')}
      </ul>` : ''}
      ${show(l.summary) ? `<div class="out"${E('launch.summary', 1, 'Add a summary line (optional)')}>${rich(l.summary)}</div>` : ''}
    </div>` : ''}
  </div>
</section>
`;
  }

  // ---------- footer and guide panels ----------
  html += `
<footer>
  <div class="wrap">
    <div class="foot-top">
      <div class="foot-by"><span class="foot-label">Prepared by</span><span class="lean-logo foot-logo">${LEAN_LOGO}</span></div>
      <div class="foot-for"><span class="foot-label">for</span>${clientMark(c, client, 'footer')}</div>
    </div>
    <div class="row2"><span></span><span>Confidential, for discussion</span></div>
  </div>
</footer>
${panels.length ? `
<div class="panel-overlay" id="ov" onclick="closePanels()"></div>
${panels.join('\n')}
<script>
${PANEL_SCRIPT}
</script>` : ''}${edit ? '\n' + EDIT_SCRIPT : ''}
</body>
</html>
`;
  return { html, title, theme };
}
