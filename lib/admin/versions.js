// GET  /api/admin/versions?slug                -> earlier versions, newest first
// POST /api/admin/versions { slug, id }        -> restore a version (the current one is kept as a version first)
import { handler, readJson, send, httpError, getQuery } from '../http.js';
import { requireAdmin } from '../auth.js';
import { withTransaction } from '../db.js';
import { SLUG_RE, inspectHtml } from '../blueprints.js';
import { parseStructure } from '../structure.js';
import { listVersions, getVersion, saveVersion } from '../versions.js';

export default handler(['GET', 'POST'], async (req, res) => {
  requireAdmin(req);
  if (req.method === 'GET') {
    const { slug } = getQuery(req);
    if (!SLUG_RE.test(String(slug || ''))) throw httpError(400, 'Bad short name');
    return send(res, 200, { versions: await listVersions(slug) });
  }
  const b = await readJson(req);
  const slug = String(b.slug || '');
  const v = await getVersion(slug, b.id);
  if (!v) throw httpError(404, 'That version no longer exists.');
  const info = inspectHtml(v.html);
  const restored = await withTransaction(async (db) => {
    await saveVersion(slug, `Before restoring version ${v.id}`, b.by, db);
    await db.query(
      `UPDATE blueprints SET html = $2, items = $3, size_bytes = $4, title = $5, structure = $6, source = coalesce($7, source),
              draft = CASE WHEN $7 = 'builder' THEN $8::jsonb ELSE draft END, published_at = now(), updated_at = now() WHERE slug = $1`,
      [slug, v.html, info.items, info.size, info.title, parseStructure(v.html), v.source, v.draft ? JSON.stringify(v.draft) : null]);
    const t = await db.query('SELECT DISTINCT t.item FROM team_checklist t JOIN links l ON l.token = t.token WHERE l.slug = $1 AND t.done', [slug]);
    return t.rows.map((r) => r.item).filter((k) => !info.items.includes(k));
  });
  send(res, 200, { restored: v.id, missingTicks: restored });
});
