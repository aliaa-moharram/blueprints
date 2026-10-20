// POST /api/admin/builder   (admin)
//   { action: "create",  slug, content, by }  -> start a blueprint in the form
//   { action: "save",    slug, content, by }  -> save the draft (clients don't see it)
//   { action: "publish", slug, content, by }  -> save, then render the page clients see
//   { action: "preview", content }            -> rendered page, nothing saved
// GET  /api/admin/builder?slug=...           -> the saved draft
import { handler, getQuery, readJson, send, httpError } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { query } from '../../lib/db.js';
import { SLUG_RE, MAX_BYTES, inspectHtml } from '../../lib/blueprints.js';
import { renderBlueprint } from '../../lib/render.js';

const clientName = (c) => (c && c.client && typeof c.client.name === 'string' ? c.client.name.trim() : '');
const by = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) || null : null);

async function loadRow(slug) {
  const { rows } = await query(
    `SELECT slug, title, source, draft, draft_updated_at, published_at, html IS NOT NULL AS published
       FROM blueprints WHERE slug = $1`, [slug]);
  return rows[0] || null;
}

export default handler(['GET', 'POST'], async (req, res) => {
  requireAdmin(req);

  if (req.method === 'GET') {
    const { slug } = getQuery(req);
    const row = typeof slug === 'string' && SLUG_RE.test(slug) ? await loadRow(slug) : null;
    if (!row || row.source !== 'builder') throw httpError(404, 'No form-built blueprint with that name.');
    return send(res, 200, row);
  }

  const body = await readJson(req, MAX_BYTES + 512 * 1024);
  const content = body.content && typeof body.content === 'object' ? body.content : null;

  if (body.action === 'preview') {
    if (!content) throw httpError(400, 'Nothing to preview.');
    return send(res, 200, { html: renderBlueprint(content).html });
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!SLUG_RE.test(slug)) throw httpError(400, 'Use a short name with lowercase letters, digits and hyphens, e.g. "acme-remit".');
  if (!content) throw httpError(400, 'Missing form content.');
  if (!clientName(content)) throw httpError(400, 'Add the client name in Basics.');
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_BYTES) {
    throw httpError(413, 'The blueprint is over 4 MB, usually because of large images. Remove or replace some screenshots.');
  }
  const { title } = renderBlueprint(content);

  if (body.action === 'create') {
    if (await loadRow(slug)) throw httpError(409, `A blueprint called "${slug}" already exists. Pick another short name.`);
    await query(
      `INSERT INTO blueprints (slug, title, html, items, size_bytes, uploaded_by, source, draft, draft_updated_at)
       VALUES ($1, $2, NULL, '{}', NULL, $3, 'builder', $4, now())`,
      [slug, title, by(body.by), content],
    );
    return send(res, 201, await loadRow(slug));
  }

  const row = await loadRow(slug);
  if (!row) throw httpError(404, 'That blueprint no longer exists.');
  if (row.source !== 'builder') throw httpError(409, 'This blueprint was uploaded as a file. Use Replace file to change it.');

  if (body.action === 'save') {
    await query('UPDATE blueprints SET draft = $2, draft_updated_at = now(), title = $3 WHERE slug = $1', [slug, content, title]);
    return send(res, 200, await loadRow(slug));
  }

  if (body.action === 'publish') {
    const { html } = renderBlueprint(content);
    const info = inspectHtml(html);
    if (info.problems.length) throw httpError(400, info.problems.join(' '));
    await query(
      `UPDATE blueprints SET draft = $2, draft_updated_at = now(), title = $3, html = $4, items = $5,
              size_bytes = $6, uploaded_by = $7, published_at = now(), updated_at = now()
        WHERE slug = $1`,
      [slug, content, title, html, info.items, info.size, by(body.by)],
    );
    return send(res, 200, await loadRow(slug));
  }

  throw httpError(400, 'Unknown action.');
});
