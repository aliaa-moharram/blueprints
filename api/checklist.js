// Checklist state belongs to a client team (one link = one team).
// GET  /api/checklist?token=...
//   client team link -> { mode: "edit", team, items: { <item>: { done, at } } }
//   Lean team link   -> { mode: "view", teams: [ { name, items } ] }   (every client team on the blueprint)
// POST /api/checklist  { token, item, done }   client team links only
import { handler, getQuery, readJson, send, httpError } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta, ITEM_RE } from '../lib/blueprints.js';
import { checkViewParam } from '../lib/viewsig.js';
import { classify, viewerEmail } from '../lib/viewer.js';

// A team's path to production: when they asked, and when Lean switched them to production.
const production = (l) => ({ requestedAt: l.production_requested_at || null, note: l.production_request_note || null,
  grantedAt: l.environment === 'production' ? (l.environment_changed_at || null) : null });
const tail = (t) => (t && t.length > 4 ? '•••• ' + t.slice(-4) : t || '');
// What was sent with the request, masked, so the page can show it back.
async function withSummary(p, token) {
  if (!p.requestedAt) return p;
  const { rows } = await query('SELECT video_name, video_bytes, video_na_reason, account_holder_name, iban, account_number FROM production_requests WHERE token = $1 ORDER BY created_at DESC LIMIT 1', [token]);
  if (!rows.length) return p;
  const r = rows[0];
  return { ...p, summary: { video: r.video_name ? { name: r.video_name, bytes: Number(r.video_bytes) || 0 } : null, videoNaReason: r.video_na_reason,
    accountHolderName: r.account_holder_name, iban: tail(r.iban), accountNumber: tail(r.account_number) } };
}

async function itemsFor(token, allowed) {
  const { rows } = await query('SELECT item, done, updated_at FROM team_checklist WHERE token = $1', [token]);
  const items = {};
  for (const r of rows) if (allowed.includes(r.item)) items[r.item] = { done: r.done, at: r.updated_at };
  return items;
}

export default handler(['GET', 'POST'], async (req, res) => {
  const input = req.method === 'GET' ? getQuery(req) : await readJson(req);
  const link = await findActiveLink(input.token);
  if (!link) throw httpError(404, 'Link not active');
  const bp = await loadMeta(link.slug);
  if (!bp) throw httpError(404, 'Blueprint not found');

  if (input.view !== undefined) {
    if (req.method !== 'GET') throw httpError(403, 'Lean views are read only.');
    if (link.kind !== 'client' || checkViewParam(link.token, input.view) !== 'ok') throw httpError(403, 'This view has expired. Open it again from the admin page.');
    return send(res, 200, { mode: 'view', teams: [{ name: link.label, environment: link.environment, production: await withSummary(production(link), link.token), items: await itemsFor(link.token, bp.items) }] });
  }

  if (req.method === 'GET') {
    if (link.kind === 'client') return send(res, 200, { mode: 'edit', team: link.label, environment: link.environment, production: await withSummary(production(link), link.token), items: await itemsFor(link.token, bp.items) });
    const { rows } = await query(
      `SELECT token, label, environment, environment_changed_at, production_requested_at, production_request_note FROM links WHERE slug = $1 AND kind = 'client' AND revoked_at IS NULL ORDER BY created_at`,
      [link.slug],
    );
    const teams = [];
    for (const t of rows) teams.push({ name: t.label, environment: t.environment, production: await withSummary(production(t), t.token), items: await itemsFor(t.token, bp.items) });
    return send(res, 200, { mode: 'view', teams });
  }

  if (link.kind !== 'client') throw httpError(403, 'Lean team links can view checklist progress but not change it.');
  if (typeof input.item !== 'string' || !ITEM_RE.test(input.item) || !bp.items.includes(input.item)) {
    throw httpError(400, 'Unknown checklist item');
  }
  if (typeof input.done !== 'boolean') throw httpError(400, '"done" must be true or false');
  // Only someone on the client team (an email on this link's client domains) can tick.
  const who = classify(viewerEmail(req, input), link.client_domains);
  if (who.kind !== 'client') throw httpError(403, who.kind === 'lean' ? 'Lean team members can view progress but not change it.' : 'Only the client team can tick steps. Check the email you entered (Not you?).');
  const { rows } = await query(
    `INSERT INTO team_checklist (token, item, done, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (token, item) DO UPDATE SET done = EXCLUDED.done, updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING item, done, updated_at`,
    [link.token, input.item, input.done, who.email],
  );
  send(res, 200, { item: rows[0].item, done: rows[0].done, at: rows[0].updated_at });
});
