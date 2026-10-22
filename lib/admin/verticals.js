// GET    /api/admin/verticals                                        (admin) -> all verticals
// POST   /api/admin/verticals { id?, name, painIntro, painRows, useCases, by } -> add or update one
// DELETE /api/admin/verticals { id }                                 -> delete one (blueprints already made keep their content)
import { handler, readJson, send, httpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { listVerticals, getVertical } from '../verticalsdb.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slug = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default handler(['GET', 'POST', 'DELETE'], async (req, res) => {
  requireAdmin(req);
  if (req.method === 'GET') return send(res, 200, { verticals: await listVerticals() });
  const body = await readJson(req, 256 * 1024);

  if (req.method === 'DELETE') {
    if (typeof body.id !== 'string' || !ID_RE.test(body.id)) throw httpError(400, 'Bad vertical');
    await listVerticals();
    const { rowCount } = await query('DELETE FROM verticals WHERE id = $1', [body.id]);
    if (!rowCount) throw httpError(404, 'That vertical no longer exists.');
    return send(res, 200, { deleted: true });
  }

  const name = str(body.name, 60);
  if (!name) throw httpError(400, 'Give the vertical a name.');
  const rows = (Array.isArray(body.painRows) ? body.painRows : []).slice(0, 20).map((r) => ({
    group: r && r.group === 'technical' ? 'technical' : 'business',
    pain: str(r && r.pain, 600), solve: str(r && r.solve, 600), advantage: str(r && r.advantage, 600),
  })).filter((r) => r.pain || r.solve || r.advantage);
  const useCases = (Array.isArray(body.useCases) ? body.useCases : []).map((u) => str(u, 40)).filter(Boolean).slice(0, 12);
  const intro = str(body.painIntro, 1500);
  const by = str(body.by, 80) || null;
  const existing = body.id ? await getVertical(body.id) : null;
  const id = existing ? existing.id : slug(name);
  if (!ID_RE.test(id)) throw httpError(400, 'Use a name with letters or digits.');
  if (!existing && (await getVertical(id))) throw httpError(409, `There's already a vertical called ${name}.`);
  await query(
    `INSERT INTO verticals (id, name, pain_intro, pain_rows, use_cases, sort, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(sort), 0) + 1 FROM verticals), $6, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, pain_intro = EXCLUDED.pain_intro, pain_rows = EXCLUDED.pain_rows,
       use_cases = EXCLUDED.use_cases, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [id, name, intro, JSON.stringify(rows), JSON.stringify(useCases), by],
  );
  send(res, existing ? 200 : 201, await getVertical(id));
});
