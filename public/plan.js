// Builds the launch plan (product cards and table rows) from simple choices:
//   launch.assign = { <productId>: { phase, effort, note, card, showCard, linkLabel, linkUrl } }
//   launch.custom = [ { name, sub, apis, card, phase, effort, note, showCard, linkLabel, linkUrl } ]
// phase is an index into launch.phases, or -1 for "not included" (no card, no table row). Shared by the form and the renderer.

const s = (v) => (typeof v === 'string' ? v : '');

export function syncPlan(c, lib) {
  const L = c.launch || (c.launch = {});
  const phases = L.phases || (L.phases = []);
  const assign = L.assign || (L.assign = {});
  const custom = L.custom || (L.custom = []);
  phases.forEach((ph) => { ph.rows = []; });
  const cards = [];
  const statusFor = (i) => (i >= 0 && i < phases.length && !phases[i].unconfirmed ? 'scope' : 'future');
  for (const p of lib) {
    const a = assign[p.id];
    if (!a) continue;
    const i = Number.isInteger(a.phase) ? a.phase : -1;
    if (i >= 0 && i < phases.length) {
      phases[i].rows.push({ product: p.id, effort: s(a.effort), note: s(a.note), link: { label: s(a.linkLabel), url: s(a.linkUrl) } });
    }
    const show = typeof a.showCard === 'boolean' ? a.showCard : p.showCard !== false;
    if (show && i >= 0 && i < phases.length) cards.push({ product: p.id, status: statusFor(i), card: s(a.card) });
  }
  for (const x of custom) {
    if (!s(x.name).trim()) continue;
    const i = Number.isInteger(x.phase) ? x.phase : -1;
    if (i >= 0 && i < phases.length) {
      phases[i].rows.push({ product: 'custom', custom: { name: x.name, sub: s(x.sub), apis: s(x.apis) }, effort: s(x.effort), note: s(x.note), link: { label: s(x.linkLabel), url: s(x.linkUrl) } });
    }
    if (x.showCard !== false && i >= 0 && i < phases.length) cards.push({ product: 'custom', status: statusFor(i), card: s(x.card), custom: { name: x.name } });
  }
  L.products = cards;
  return c;
}

// Converts a plan written as cards and rows (older drafts) into assign/custom.
export function planFromRows(c, lib) {
  const L = c.launch || (c.launch = {});
  if (L.assign && Object.keys(L.assign).length) return c;
  const ids = new Set(lib.map((p) => p.id));
  const assign = {};
  const custom = [];
  (L.phases || []).forEach((ph, i) => {
    for (const r of ph.rows || []) {
      const link = r.link || {};
      if (ids.has(r.product)) {
        if (!assign[r.product]) assign[r.product] = { phase: i, effort: s(r.effort), note: s(r.note), linkLabel: s(link.label), linkUrl: s(link.url), showCard: false };
      } else {
        const cu = r.custom || {};
        custom.push({ name: s(cu.name), sub: s(cu.sub), apis: s(cu.apis), phase: i, effort: s(r.effort), note: s(r.note), linkLabel: s(link.label), linkUrl: s(link.url), card: '', showCard: false });
      }
    }
  });
  for (const card of L.products || []) {
    if (ids.has(card.product)) {
      if (!assign[card.product]) assign[card.product] = { phase: -1, effort: '', note: '', linkLabel: '', linkUrl: '', showCard: true };
      assign[card.product].showCard = true;
      assign[card.product].card = s(card.card);
    } else {
      const name = s(card.custom && card.custom.name);
      const match = custom.find((x) => x.name === name);
      if (match) { match.showCard = true; match.card = s(card.card); }
      else custom.push({ name, sub: '', apis: '', phase: -1, effort: '', note: '', card: s(card.card), showCard: true });
    }
  }
  L.assign = assign;
  L.custom = custom;
  return c;
}
