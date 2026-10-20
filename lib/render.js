// Turns the content saved by the admin form into a finished blueprint page,
// using the Wise blueprint design (lib/template.js) and the product library (lib/products.js).
import { FONT_LINKS, LEAN_LOGO, PANEL_SCRIPT, STYLES } from './template.js';
import { getProduct, PANELS } from './products.js';
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

function panelHtml(pid, kicker, name) {
  const p = PANELS[pid];
  if (!p) return '';
  const steps = p.steps.map((s, i) => `<li data-check="${pid}-${i + 1}">${s}</li>`).join('');
  return `<aside class="spanel" id="panel-${pid}" role="dialog" aria-modal="true" aria-label="${esc(name)} implementation guide">
  <div class="sp-head">
    <div class="sp-kicker">${esc(kicker)} &middot; Implementation guide</div>
    <div class="sp-title">${p.title}</div>
    <div class="sp-sub">${p.sub}</div>
    <button class="sp-close" onclick="closePanels()" aria-label="Close">&#10005;</button>
  </div>
  <div class="sp-body">
    <div class="sp-h">Before you start</div>
    <ul class="sp-pre">${p.pre.map((x) => `<li>${x}</li>`).join('')}</ul>
    <div class="sp-h">How it works</div>
    <div class="sp-diagram">${p.svg}</div>
    <div class="sp-h">Integration checklist</div>
    <ol class="sp-check">${steps}</ol>
    <div class="sp-h">Endpoints</div>
    <div class="sp-codes">${p.endpoints.map((e) => `<code>${esc(e)}</code>`).join('')}</div>
    ${p.links.length ? `<div class="sp-h">Lean docs</div>
    <div class="sp-links">${p.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>` : ''}
    ${p.note ? `<p class="sp-note">${p.note}</p>` : ''}
  </div>
</aside>`;
}

export function renderBlueprint(c) {
  c = c || {};
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
    ${has(c.hero && c.hero.subtitle) ? `<p class="sub">${rich(c.hero.subtitle)}</p>` : ''}
    ${metaItems ? `<div class="meta">\n      ${metaItems}\n    </div>` : ''}
  </div>
</header>
`;
  if (has(c.summary)) {
    html += `
<section style="padding-bottom:0">
  <div class="wrap">
    <div class="execsum">
      <p class="lead">${rich(c.summary)}</p>
    </div>
  </div>
</section>
`;
  }

  // ---------- pain points ----------
  const pain = c.pain || {};
  const rows = list(pain.rows).filter((r) => has(r.pain) || has(r.solve) || has(r.advantage));
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
          <td class="pain-c">${rich(r.pain)}</td>
          <td class="solve-c">${rich(r.solve)}</td>
          <td class="adv-c">${rich(r.advantage)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>`;
    };
    html += `
<section>
  <div class="wrap">
    <div class="sec-head"><span class="sec-num">${pad(sec)}</span><h2 class="sec-title">Pain points &amp; opportunities</h2></div>
    ${has(pain.intro) ? `<p class="sec-intro">${rich(pain.intro)}</p>` : ''}
${group('business', 'Business impact')}
${group('technical', 'Technical &amp; operational')}
  </div>
</section>
`;
  }

  // ---------- journeys and design reference ----------
  const j = c.journeys || {};
  const journeys = list(j.items).filter((x) => has(x.title) || has(x.feature) || has(x.need));
  const designImages = list(design.images).filter(isImage).slice(0, 3);
  const designFlows = list(design.flows).filter((f) => has(f.name) && safeUrl(f.url));
  const designBlock = design.enabled ? `
      <div class="figwrap">
        <h3 class="sub-h">${esc(has(design.title) ? design.title : DEFAULTS.designTitle)}</h3>
        ${has(design.subtitle) ? `<p class="sec-sub">${rich(design.subtitle)}</p>` : ''}
        <div class="figcard figcard2">
          <div class="fighead">
            ${designImages.length ? `<div class="figshots">
              ${designImages.map((src, i) => `<img src="${src}" alt="Design preview ${i + 1}">`).join('\n              ')}
            </div>` : ''}
            <div class="figmeta">
              <div class="figkicker">Figma file</div>
              <div class="figname">${esc(has(design.name) ? design.name : `Lean x ${client}`)}</div>
              ${has(design.description) ? `<div class="figdesc">${rich(design.description)}</div>` : ''}
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
    <div class="sec-head"><span class="sec-num">${pad(sec)}</span><h2 class="sec-title">${esc(has(j.title) ? j.title : DEFAULTS.journeysTitle)}</h2></div>
    ${has(j.intro) ? `<p class="sec-intro">${rich(j.intro)}</p>` : ''}
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
    ? `\n            <div class="row"><div class="rk">Also covers</div><div class="rv">${isImage(x.alsoImage) ? `<img class="rowthumb" src="${x.alsoImage}" alt="${esc(x.title || 'Journey')}, also covers">` : ''}${rich(x.alsoCovers)}</div></div>` : '';
  return `      <div class="${cls}">
        ${shot}
        <div class="jbody">
          <div class="jtag"><span class="ix">Journey ${i + 1}</span> ${esc(x.tag)}</div>
          <h2 class="jtitle">${esc(x.title)}</h2>
          <div class="rowset">
            ${has(x.feature) ? `<div class="row"><div class="rk">${esc(client)} feature</div><div class="rv">${rich(x.feature)}</div></div>` : ''}
            ${has(x.need) ? `<div class="row"><div class="rk">The need</div><div class="rv">${rich(x.need)}</div></div>` : ''}
            ${pills.length || has(x.powers) ? `<div class="row"><div class="rk">Lean powers it</div><div class="rv">${pills.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}${rich(x.powers)}</div></div>` : ''}${also}
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
  const phases = list(l.phases).filter((p) => has(p.title) || list(p.rows).length);
  const panels = [];
  const seenPanels = new Set();
  if (cards.length || phases.length) {
    sec++;
    const tableRows = phases.filter((ph) => list(ph.rows).length).map((ph) => {
      const label = has(ph.label) ? ph.label : 'Phase';
      const chip = has(ph.chip) ? ` <span class="tbc" style="margin-left:8px">${esc(ph.chip)}</span>` : '';
      const body = list(ph.rows).map((row) => {
        const p = productFor(row, client);
        const apis = p.toBeScoped && !p.apis.length ? '<span class="tbc">To be scoped</span>' : p.apis.map((a) => `<code>${esc(a)}</code>`).join('');
        const note = has(p.apiNote) ? `<span class="api-desc">${rich(p.apiNote)}</span>` : '';
        let impl = '-';
        if (p.lib && p.lib.panel && PANELS[p.lib.panel]) {
          impl = `<button class="guide-btn" onclick="openPanel('${p.lib.panel}')">View guide</button>`;
          if (!seenPanels.has(p.lib.panel)) { seenPanels.add(p.lib.panel); panels.push(panelHtml(p.lib.panel, label, p.name)); }
        } else if (row.link && has(row.link.label) && safeUrl(row.link.url)) {
          impl = `<a href="${esc(safeUrl(row.link.url))}" target="_blank" rel="noopener">${esc(row.link.label)}</a>`;
        } else if (p.lib && p.lib.linkFromDesign && designUrl) {
          impl = `<a href="${esc(designUrl)}" target="_blank" rel="noopener">${esc(p.lib.linkFromDesign)}</a>`;
        }
        return `        <tr>
          <td>${esc(p.name)}${has(p.sub) ? `<br><span class="sub">${esc(p.sub)}</span>` : ''}</td>
          <td class="apis">${apis}${note}</td>
          <td class="eff">${esc(p.effort)}</td>
          <td class="ck">${impl}</td>
        </tr>`;
      }).join('\n');
      return `        <tr class="grp"><td colspan="4">${esc(label)} &middot; ${esc(ph.title)}${chip}</td></tr>\n${body}`;
    }).join('\n');
    const totals = list(l.totals).filter((t) => has(t.label) || has(t.value));
    html += `
<section>
  <div class="wrap">
    <div class="sec-head"><span class="sec-num">${pad(sec)}</span><h2 class="sec-title">Launch Plan</h2></div>
    <p class="sec-intro">${rich(has(l.intro) ? l.intro : DEFAULTS.launchIntro)}</p>
${cards.length ? `
    <h3 class="sub-h">Lean products</h3>
    <div class="prod-block">
      <div class="prods">
${cards.map(({ e, p }) => `        <div class="prod"><span class="${e.status === 'future' ? 'ext' : 'core'}">${e.status === 'future' ? 'Future' : 'In scope'}</span><h3>${esc(p.name)}</h3>${has(p.card) ? `<p>${rich(p.card)}</p>` : ''}</div>`).join('\n')}
      </div>
    </div>` : ''}
${phases.length ? `
    <h3 class="sub-h">Delivery phases</h3>

    <div class="phases">
${phases.map((ph) => `      <div class="phase${ph.unconfirmed ? ' dotted' : ''}"><span class="ph">${esc(has(ph.label) ? ph.label : 'Phase')}</span><h3>${esc(ph.title)}</h3>${lines(ph.bullets).length ? `<ul>${lines(ph.bullets).map((b) => `<li>${rich(b)}</li>`).join('')}</ul>` : ''}</div>`).join('\n')}
    </div>
${tableRows ? `
    <h3 class="sub-h">Scope, APIs and build</h3>
    <p class="sec-sub">Grouped by the phases above: each product, its APIs, the effort to build, and where to start.</p>
    <table class="maptable">
      <thead><tr><th>Product</th><th>APIs needed</th><th>Effort</th><th>Implementation details</th></tr></thead>
      <tbody>
${tableRows}
      </tbody>
    </table>` : ''}` : ''}
    ${has(l.note) ? `<p class="stages-note">${rich(l.note)}</p>` : ''}
${totals.length || has(l.summary) ? `    <div class="calc">
      <h4>Total implementation time</h4>
      ${totals.length ? `<ul class="tot-list">
${totals.map((t) => `        <li>${rich(t.label)}${has(t.value) ? `: <b>${esc(t.value)}</b>` : ''}</li>`).join('\n')}
      </ul>` : ''}
      ${has(l.summary) ? `<div class="out">${rich(l.summary)}</div>` : ''}
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
    <div class="row2"><span>Integration Blueprint &nbsp;&middot;&nbsp; Prepared by Lean for ${esc(client)}</span><span>Confidential, for discussion</span></div>
  </div>
</footer>
${panels.length ? `
<div class="panel-overlay" id="ov" onclick="closePanels()"></div>
${panels.join('\n')}
<script>
${PANEL_SCRIPT}
</script>` : ''}
</body>
</html>
`;
  return { html, title, theme };
}
