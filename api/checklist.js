// Checklist state belongs to a client team (one link = one team).
// GET  /api/checklist?token=...
//   client team link -> { mode: "edit", team, items: { <item>: { done, at } } }
//   Lean team link   -> { mode: "view", teams: [ { name, items } ] }   (every client team on the blueprint)
// POST /api/checklist  { token, item, done }   client team links only
import { handler, getQuery, readJson, send, httpError } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta, ITEM_RE } from '../lib/blueprints.js';
import { checkViewParam } from '../lib/viewsig.js';

// A team's path to production: when they asked, and when Lean switched them to production.
const production = (l) => ({ requestedAt: l.production_requested_at || null, note: l.production_request_note || null,
  grantedAt: l.environment === 'production' ? (l.environment_changed_at || null) : null });

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
    return send(res, 200, { mode: 'view', teams: [{ name: link.label, environment: link.environment, production: production(link), items: await itemsFor(link.token, bp.items) }] });
  }

  if (req.method === 'GET') {
    if (link.kind === 'client') return send(res, 200, { mode: 'edit', team: link.label, environment: link.environment, production: production(link), items: await itemsFor(link.token, bp.items) });
    const { rows } = await query(
      `SELECT token, label, environment, environment_changed_at, production_requested_at, production_request_note FROM links WHERE slug = $1 AND kind = 'client' AND revoked_at IS NULL ORDER BY created_at`,
      [link.slug],
    );
    const teams = [];
    for (const t of rows) teams.push({ name: t.label, environment: t.environment, production: production(t), items: await itemsFor(t.token, bp.items) });
    return send(res, 200, { mode: 'view', teams });
  }

  if (link.kind !== 'client') throw httpError(403, 'Lean team links can view checklist progress but not change it.');
  if (typeof input.item !== 'string' || !ITEM_RE.test(input.item) || !bp.items.includes(input.item)) {
    throw httpError(400, 'Unknown checklist item');
  }
  if (typeof input.done !== 'boolean') throw httpError(400, '"done" must be true or false');
  const { rows } = await query(
    `INSERT INTO team_checklist (token, item, done, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (token, item) DO UPDATE SET done = EXCLUDED.done, updated_at = now()
     RETURNING item, done, updated_at`,
    [link.token, input.item, input.done],
  );
  send(res, 200, { item: rows[0].item, done: rows[0].done, at: rows[0].updated_at });
});
