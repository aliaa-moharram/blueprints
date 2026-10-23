// Reads a published blueprint made from the Lean template back into the form's content, so people who don't
// write code can edit it in the form. Then checks the result: it renders the imported content and compares it
// with the original, section by section (visible text and images). Nothing is converted unless the person
// reviewing the check chooses to.
import { parse } from 'node-html-parser';
import { createHash } from 'node:crypto';
import { PRODUCTS, SETUP_GROUP } from './products.js';
import { renderBlueprint } from './render.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const decode = (s) => parse(`<x>${s}</x>`).text;
// Page HTML back to the form's text: <b> becomes **bold**, <br> a line break, anything else plain text.
const toMd = (el) => {
  if (!el) return '';
  const h = typeof el === 'string' ? el : el.innerHTML;
  return decode(h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(b|strong)>/gi, '**').replace(/<[^>]+>/g, '')).replace(/\*\*\s*\*\*/g, '').trim();
};
const text = (el) => (el ? norm(el.text) : '');
const byName = (name) => PRODUCTS.find((p) => norm(p.name).toLowerCase() === norm(name).toLowerCase()) || null;
const SIZES = { s: 'small', m: 'medium', l: 'large' };

function sectionByTitle(root, re) {
  return root.querySelectorAll('section').find((s) => re.test(text(s.querySelector('.sec-title')))) || null;
}

export function importBlueprint(html) {
  const root = parse(html, { comment: false });
  const notes = []; // things that couldn't be carried over exactly
  const c = { client: {}, header: { mode: 'name', logoSize: 'medium' }, theme: { mode: 'lean', color: '' }, meta: {}, hero: {}, summary: '',
    pain: { intro: '', rows: [] }, journeys: { title: '', intro: '', useCases: [], items: [] }, design: { enabled: false },
    launch: { intro: '', products: [], phases: [], note: '', totals: [], summary: '' } };

  // ---------- header, hero, summary ----------
  const band = root.querySelector('.authorband .ab-lock');
  const logo = band && band.querySelector('.client-logo img');
  if (logo) {
    c.client.name = norm(logo.getAttribute('alt'));
    c.client.logo = logo.getAttribute('src') || '';
    c.header = { mode: 'logo', logoSize: SIZES[(band.querySelector('.client-logo').classList.value.find((x) => SIZES[x]) || 'm')] || 'medium' };
  } else if (band && band.querySelector('.lock-x') && band.querySelector('.lock-x').nextElementSibling && band.querySelector('.lock-x').nextElementSibling.querySelector('svg')) {
    // A hand-built page with the client's logo drawn inline (SVG): the name comes from its label, and the logo is
    // turned into an image for the form. "currentColor" becomes the colour the page gives that logo, since an
    // image can't inherit it.
    const holder = band.querySelector('.lock-x').nextElementSibling;
    const svg = holder.querySelector('svg');
    c.client.name = norm(svg.getAttribute('aria-label') || holder.text);
    const cls = holder.classList.value.find(Boolean);
    const css = root.querySelectorAll('style').map((x) => x.text).join('\n');
    const color = cls ? ((css.match(new RegExp(`\\.${cls}\\s*\\{[^}]*color:\\s*([^;}]+)`)) || [])[1] || '#ffffff').trim() : '#ffffff';
    const markup = svg.toString().replace(/currentColor/g, color);
    c.client.logo = 'data:image/svg+xml;base64,' + Buffer.from(markup, 'utf8').toString('base64');
    c.header = { mode: 'logo', logoSize: 'small' };
    notes.push({ section: 'Header', note: `The ${c.client.name || 'client'} logo was converted from an inline graphic into an image. Check it looks right in the preview.` });
  } else c.client.name = text(band && band.querySelector('.client-name'));
  if (!c.client.name) {
    const t = text(root.querySelector('title')).match(/^(.*?)\s+(?:\S+\s+)?Integration Blueprint/);
    c.client.name = t ? t[1] : '';
    notes.push({ section: 'Header', note: 'The client name was read from the page title.' });
  }
  const accent = root.querySelectorAll('style').map((s) => s.text).map((t) => (t.match(/^\s*:root\{--bright:([^;]+);--bright-ink/) || [])[1]).find(Boolean);
  if (accent) c.theme = { mode: 'client', color: accent.trim() };
  for (const d of root.querySelectorAll('.hero .meta > div')) {
    const k = text(d.querySelector('.k')).toLowerCase(), v = text(d.querySelector('.v'));
    if (k === 'prepared by') c.meta.preparedBy = v; else if (k === 'market') c.meta.market = v; else if (k === 'vertical') c.meta.vertical = v;
  }
  c.hero.subtitle = toMd(root.querySelector('.hero p.sub'));
  c.summary = toMd(root.querySelector('.execsum .lead'));

  // ---------- pain points ----------
  const painSec = sectionByTitle(root, /^Pain points/i);
  if (painSec) {
    c.pain.intro = toMd(painSec.querySelector('.sec-intro'));
    let group = 'business';
    for (const el of painSec.querySelectorAll('h3.sub-h, table.pstable tbody tr')) {
      if (el.tagName === 'H3') { group = /technical/i.test(el.text) ? 'technical' : 'business'; continue; }
      c.pain.rows.push({ group, pain: toMd(el.querySelector('.pain-c')), solve: toMd(el.querySelector('.solve-c')), advantage: toMd(el.querySelector('.adv-c')) });
    }
  }

  // ---------- journeys and design reference ----------
  const jSec = root.querySelectorAll('section').find((s) => s.querySelector('.journeys'));
  if (jSec) {
    c.journeys.title = text(jSec.querySelector('.sec-title'));
    c.journeys.intro = toMd(jSec.querySelector('.sec-intro'));
    c.journeys.useCases = jSec.querySelectorAll('.usecases .uc').map(text).filter(Boolean);
    for (const j of jSec.querySelectorAll('.journeys > .journey')) {
      const item = { tag: '', title: text(j.querySelector('.jtitle')), feature: '', need: '', products: [], powers: '', alsoCovers: '', alsoImage: '',
        images: j.querySelectorAll('.jshot img').map((i) => i.getAttribute('src')).filter(Boolean).slice(0, 2), unconfirmed: j.classList.contains('dotted') };
      const tag = j.querySelector('.jtag');
      if (tag) { const ix = tag.querySelector('.ix'); item.tag = norm(tag.text.replace(ix ? ix.text : '', '')); }
      for (const row of j.querySelectorAll('.rowset > .row')) {
        const k = text(row.querySelector('.rk')), rv = row.querySelector('.rv');
        if (/ feature$/i.test(k)) item.feature = toMd(rv);
        else if (/^the need$/i.test(k)) item.need = toMd(rv);
        else if (/^lean powers it$/i.test(k)) {
          const other = [];
          for (const pill of rv.querySelectorAll('.pill')) { const p = byName(pill.text); if (p) item.products.push(p.id); else other.push(text(pill)); pill.remove(); }
          if (other.length) item.otherProducts = other.join('\n');
          item.powers = toMd(rv);
        } else if (/^also covers$/i.test(k)) {
          const th = rv.querySelector('img.rowthumb');
          if (th) { item.alsoImage = th.getAttribute('src') || ''; th.remove(); }
          item.alsoCovers = toMd(rv);
        } else notes.push({ section: 'Journeys', note: `“${k}” in ${item.title || 'a journey'} isn’t a field in the form.` });
      }
      c.journeys.items.push(item);
    }
    const fig = jSec.querySelector('.figwrap');
    if (fig) {
      c.design = {
        enabled: true, title: text(fig.querySelector('h3.sub-h')), subtitle: toMd(fig.querySelector('.sec-sub')),
        name: text(fig.querySelector('.figname')), description: toMd(fig.querySelector('.figdesc')),
        fileUrl: (fig.querySelector('.figbtn') || { getAttribute: () => '' }).getAttribute('href') || '',
        images: fig.querySelectorAll('.figshots img').map((i) => i.getAttribute('src')).filter(Boolean).slice(0, 3),
        flows: fig.querySelectorAll('a.figflow').map((a) => ({ url: a.getAttribute('href') || '', name: text(a.querySelector('.ff-name')), description: toMd(a.querySelector('.ff-sub')) })),
      };
    }
  }

  // ---------- launch plan ----------
  const lSec = sectionByTitle(root, /^Launch Plan$/i);
  if (lSec) {
    const client = c.client.name;
    c.launch.intro = toMd(lSec.querySelector('.sec-intro'));
    const designUrl = c.design.enabled ? c.design.fileUrl : '';
    for (const card of lSec.querySelectorAll('.prods > .prod')) {
      const name = text(card.querySelector('h3')), cardText = toMd(card.querySelector('p'));
      const status = card.querySelector('span.ext') ? 'future' : 'scope';
      const lib = byName(name);
      if (lib) c.launch.products.push({ product: lib.id, status, ...(norm(cardText) !== norm(toMd(lib.card || '')) ? { card: cardText } : {}) });
      else c.launch.products.push({ product: 'custom', status, custom: { name, card: cardText } });
    }
    // The table, grouped by phase; Phase 0 and the end-to-end row are generated, so they're skipped.
    const groups = []; let cur = null, skipping = false;
    for (const tr of lSec.querySelectorAll('table.maptable tbody > tr')) {
      if (tr.classList.contains('grp')) {
        skipping = tr.hasAttribute('data-setup');
        if (skipping) { cur = null; continue; }
        const chipEl = tr.querySelector('.tbc'); const chip = chipEl ? text(chipEl) : ''; if (chipEl) chipEl.remove();
        const [label, ...rest] = text(tr).split(' · ');
        cur = { label: norm(label), title: norm(rest.join(' · ')), chip, rows: [] }; groups.push(cur);
        continue;
      }
      if (skipping || !cur) continue;
      const tds = tr.querySelectorAll('td');
      const nameTd = tds[0]; const subEl = nameTd.querySelector('.sub'); const sub = subEl ? text(subEl) : ''; if (subEl) subEl.remove();
      const name = text(nameTd);
      if (/^End-to-end test$/i.test(name) && tr.getAttribute('data-row-panel') === 'e2e') continue;
      const apisTd = tds[1]; const noteEl = apisTd.querySelector('.api-desc'); const note = noteEl ? toMd(noteEl) : '';
      const apis = apisTd.querySelectorAll('code').map(text);
      const effort = text(tds[2]);
      const a = tds[3] && tds[3].querySelector('a');
      const lib = byName(name);
      if (lib) {
        const e = { product: lib.id };
        if (effort !== norm(lib.effort)) e.effort = effort;
        if (norm(note) !== norm(toMd((lib.apiNote || '').replaceAll('{client}', client)))) e.note = note;
        if (a && !lib.panel && !(lib.linkFromDesign && text(a) === lib.linkFromDesign && a.getAttribute('href') === designUrl)) e.link = { label: text(a), url: a.getAttribute('href') || '' };
        if (sub && norm(sub) !== norm(lib.sub)) notes.push({ section: 'Launch plan', note: `${name}: the subtitle “${sub}” differs from the library’s, and will show as “${lib.sub}”.` });
        cur.rows.push(e);
      } else {
        const e = { product: 'custom', custom: { name, sub, apis: apis.join('\n') } };
        if (effort && effort !== 'TBC') e.effort = effort;
        if (note) e.note = note;
        if (a) e.link = { label: text(a), url: a.getAttribute('href') || '' };
        cur.rows.push(e);
      }
    }
    for (const ph of lSec.querySelectorAll('.phases > .phase')) {
      const label = text(ph.querySelector('.ph')), title = text(ph.querySelector('h3'));
      if (label === SETUP_GROUP.split(' · ')[0] && (ph.getAttribute('data-panels') || '').includes('dev')) continue; // Phase 0, generated
      const g = groups.find((x) => x.label === label && x.title === title);
      c.launch.phases.push({ label, title, bullets: ph.querySelectorAll('li').map(toMd).join('\n'), unconfirmed: ph.classList.contains('dotted'), chip: g ? g.chip : '', rows: g ? g.rows : [] });
    }
    for (const g of groups) if (!c.launch.phases.some((p) => p.label === g.label && p.title === g.title)) {
      c.launch.phases.push({ label: g.label, title: g.title, bullets: '', unconfirmed: false, chip: g.chip, rows: g.rows });
      notes.push({ section: 'Launch plan', note: `“${g.label} · ${g.title}” is in the table but has no phase card.` });
    }
    c.launch.note = toMd(lSec.querySelector('.stages-note'));
    for (const li of lSec.querySelectorAll('.calc .tot-list > li')) {
      const h = li.innerHTML; const m = h.match(/^([\s\S]*?):\s*<b>([\s\S]*?)<\/b>\s*$/);
      c.launch.totals.push(m ? { label: toMd(m[1]), value: decode(m[2].replace(/<[^>]+>/g, '')).trim() } : { label: toMd(li), value: '' });
    }
    c.launch.summary = toMd(lSec.querySelector('.calc .out'));
  }
  return { content: c, notes };
}

// ---------- the round-trip check ----------
// The visible content of a page, by section: text and images (scripts, styles, guides and the generated
// Phase 0 parts excluded, since the builder makes those itself).
function contentOf(html) {
  const root = parse(html, { comment: false });
  for (const sel of ['script', 'style', 'noscript', 'aside.spanel', '#ov', '.ov', 'footer']) root.querySelectorAll(sel).forEach((n) => n.remove());
  const parts = [];
  const add = (name, el) => {
    if (!el) return;
    const imgs = el.querySelectorAll('img').map((i) => createHash('sha1').update(i.getAttribute('src') || '').digest('hex').slice(0, 12));
    const lines = [];
    const walk = (n) => { for (const ch of n.childNodes) { if (ch.nodeType === 3) { const t = norm(decode(ch.rawText)); if (t) lines.push(t); } else walk(ch); } };
    walk(el);
    parts.push({ name, text: norm(lines.join(' ')), lines, imgs });
  };
  const band = root.querySelector('.authorband');
  if (band) band.querySelectorAll('img, svg').forEach((n) => n.remove()); // logos: checked by eye in the preview (see the import notes)
  add('Header', band);
  add('Hero', root.querySelector('header.hero'));
  for (const s of root.querySelectorAll('section')) {
    const t = text(s.querySelector('.sec-title')) || (s.querySelector('.execsum') ? 'Summary' : 'Section');
    // generated parts of the launch plan: Phase 0 card and rows, and the end-to-end row
    s.querySelectorAll('.phase').filter((p) => (p.getAttribute('data-panels') || '').includes('dev')).forEach((n) => n.remove());
    let skip = false;
    for (const tr of s.querySelectorAll('table.maptable tbody > tr')) {
      if (tr.classList.contains('grp')) skip = tr.hasAttribute('data-setup');
      if (skip || tr.getAttribute('data-row-panel') === 'e2e') tr.remove();
    }
    add(t, s);
  }
  return parts;
}

export function roundTrip(originalHtml, content) {
  const rendered = renderBlueprint(content).html;
  const a = contentOf(originalHtml), b = contentOf(rendered);
  const sections = [];
  const names = [...new Set([...a.map((x) => x.name), ...b.map((x) => x.name)])];
  for (const name of names) {
    const x = a.find((s) => s.name === name), y = b.find((s) => s.name === name);
    if (!x || !y) { sections.push({ name, ok: false, issues: [x ? 'Missing after import.' : 'Only in the imported version.'] }); continue; }
    const issues = [];
    if (x.text !== y.text) {
      const ys = new Set(y.lines), xs = new Set(x.lines);
      const lost = x.lines.filter((l) => !ys.has(l)).slice(0, 4), added = y.lines.filter((l) => !xs.has(l)).slice(0, 4);
      if (lost.length) issues.push(...lost.map((l) => `Not carried over: “${l.slice(0, 140)}”`));
      if (added.length) issues.push(...added.map((l) => `Would appear instead: “${l.slice(0, 140)}”`));
      if (!lost.length && !added.length) issues.push('The same text, in a different order.');
    }
    if (x.imgs.join() !== y.imgs.join()) {
      const missing = x.imgs.filter((h) => !y.imgs.includes(h)).length, extra = y.imgs.filter((h) => !x.imgs.includes(h)).length;
      issues.push(missing || extra ? `${missing} image${missing === 1 ? '' : 's'} not carried over${extra ? `, ${extra} added` : ''}.` : 'The same images, in a different order.');
    }
    sections.push({ name, ok: !issues.length, issues });
  }
  return { ok: sections.every((s) => s.ok), sections, rendered };
}
