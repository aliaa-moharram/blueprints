// GET  /api/checklist?token=...                 -> { items: { <item>: { done, by, at } } }
// POST /api/checklist  { token, item, done }    -> { item, done, by, at }
// Anyone holding an active link can tick items; each change records the link's label.
import { handler, getQuery, readJson, send, httpError } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta, ITEM_RE } from '../lib/blueprints.js';

export default handler(['GET', 'POST'], async (req, res) => {
  const input = req.method === 'GET' ? getQuery(req) : await readJson(req);
  const link = await findActiveLink(input.token);
  if (!link) throw httpError(404, 'Link not active');
  const bp = await loadMeta(link.slug);
  if (!bp) throw httpError(404, 'Blueprint not found');

  if (req.method === 'GET') {
    const { rows } = await query('SELECT item, done, updated_by, updated_at FROM checklist WHERE slug = $1', [link.slug]);
    const items = {};
    for (const r of rows) {
      if (bp.items.includes(r.item)) items[r.item] = { done: r.done, by: r.updated_by, at: r.updated_at };
    }
    return send(res, 200, { items });
  }

  if (typeof input.item !== 'string' || !ITEM_RE.test(input.item) || !bp.items.includes(input.item)) {
    throw httpError(400, 'Unknown checklist item');
  }
  if (typeof input.done !== 'boolean') throw httpError(400, '"done" must be true or false');
  const { rows } = await query(
    `INSERT INTO checklist (slug, item, done, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (slug, item) DO UPDATE SET done = EXCLUDED.done, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING item, done, updated_by, updated_at`,
    [link.slug, input.item, input.done, link.label],
  );
  const r = rows[0];
  send(res, 200, { item: r.item, done: r.done, by: r.updated_by, at: r.updated_at });
});
