// GET /api/admin/progress?slug=...  (admin)
// The blueprint's phases and guide checklists, and each active client team's ticks.
import { handler, getQuery, send, httpError } from '../http.js';
import { nameFromEmail } from '../viewer.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { SLUG_RE } from '../blueprints.js';
import { parseStructure } from '../structure.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  const { slug } = getQuery(req);
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw httpError(400, 'Bad short name');
  const { rows } = await query('SELECT structure, html IS NOT NULL AS published FROM blueprints WHERE slug = $1', [slug]);
  if (!rows.length) throw httpError(404, 'That blueprint no longer exists.');
  let structure = rows[0].structure;
  if (!structure && rows[0].published) {
    // Blueprints published before this update: read the page once and keep the result.
    const h = await query('SELECT html FROM blueprints WHERE slug = $1', [slug]);
    structure = parseStructure(h.rows[0].html);
    await query('UPDATE blueprints SET structure = $2 WHERE slug = $1', [slug, structure]);
  }
  const links = await query(
    `SELECT token, label, environment, environment_changed_at, production_requested_at FROM links WHERE slug = $1 AND kind = 'client' AND revoked_at IS NULL ORDER BY created_at`, [slug]);
  const teams = [];
  for (const l of links.rows) {
    const t = await query('SELECT item, done, updated_at, updated_by FROM team_checklist WHERE token = $1', [l.token]);
    const items = {};
    for (const r of t.rows) items[r.item] = { done: r.done, at: r.updated_at, by: r.updated_by ? nameFromEmail(r.updated_by) : null };
    teams.push({ token: l.token, label: l.label, environment: l.environment, environmentChangedAt: l.environment_changed_at, productionRequestedAt: l.production_requested_at, items });
  }
  send(res, 200, { structure: structure || { phases: [], panels: {}, loose: [] }, teams });
});
