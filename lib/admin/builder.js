// POST /api/admin/builder   (admin)
//   { action: "create",  slug, content | template (+ vertical) | copyFrom, clientName, by } -> start a blueprint in the form
//   { action: "save",    slug, content, by }  -> save the draft (clients don't see it)
//   { action: "publish", slug, content, by }  -> save, then render the page clients see
//   { action: "preview", content }            -> rendered page, nothing saved
// GET  /api/admin/builder?slug=...           -> the saved draft
import { handler, getQuery, readJson, send, httpError, baseUrl } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { SLUG_RE, MAX_BYTES, inspectHtml } from '../blueprints.js';
import { renderBlueprint } from '../render.js';
import { parseStructure } from '../structure.js';
import { fromTemplate } from '../templates.js';
import { getVertical } from '../verticalsdb.js';
import { saveVersion } from '../versions.js';
import { cleanOwner } from '../owner.js';
import { importBlueprint, roundTrip } from '../importer.js';

const clientName = (c) => (c && c.client && typeof c.client.name === 'string' ? c.client.name.trim() : '');
const by = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) || null : null);

async function loadRow(slug) {
  const { rows } = await query(
    `SELECT slug, title, coalesce(name, title) AS name, source, draft, draft_updated_at, published_at, html IS NOT NULL AS published
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
  let content = body.content && typeof body.content === 'object' ? body.content : null;

  // Starting points for a new blueprint: a template, or a copy of another form-built blueprint.
  // Edit an uploaded blueprint in the form: read it back into form content and check the result against the
  // published page ("import"), then switch it to the form ("convert"). The published page doesn't change until
  // someone publishes from the form, and the uploaded HTML is kept as a version.
  if (body.action === 'import' || body.action === 'convert') {
    const sl = typeof body.slug === 'string' ? body.slug.trim() : '';
    const { rows } = await query('SELECT slug, html, source FROM blueprints WHERE slug = $1', [sl]);
    if (!rows.length || !rows[0].html) throw httpError(404, 'That blueprint isn’t published, so there’s nothing to read.');
    if (rows[0].source === 'builder') throw httpError(409, 'This blueprint is already edited in the form.');
    const page = rows[0].html;
    if (!/class="authorband"/.test(page) || !/<header class="hero"/.test(page)) {
      throw httpError(422, 'This page wasn’t made from the Lean blueprint template, so it can’t be read into the form. Download it, edit the file, then use Replace file.');
    }
    const { content: imported, notes } = importBlueprint(page);
    const check = roundTrip(page, imported);
    const report = { ok: check.ok, notes, sections: check.sections.map(({ name, ok, issues }) => ({ name, ok, issues })) };
    if (body.action === 'import') return send(res, 200, { report });
    if (!check.ok && body.acceptDifferences !== true) throw httpError(409, 'The imported version differs from the published page. Review the differences first.', { report });
    await saveVersion(sl, 'Before editing in the form', by(body.by));
    await query(`UPDATE blueprints SET source = 'builder', draft = $2, draft_updated_at = published_at, name = coalesce(name, $3) WHERE slug = $1`, [sl, imported, clientName(imported)]);
    return send(res, 200, { ...(await loadRow(sl)), report });
  }

  if (body.action === 'create' && !content && body.template) {
    if (body.template !== 'standard') throw httpError(400, 'Unknown template.');
    const vertical = body.vertical ? await getVertical(body.vertical) : null;
    if (body.vertical && !vertical) throw httpError(400, 'That vertical no longer exists.');
    content = fromTemplate(body.clientName, vertical);
    content.reviewNote = `Started from the standard template${vertical ? ` for ${vertical.name}` : ''}. Its journeys and plan follow the Wise blueprint, so check every section and adjust it for this client before publishing.${vertical && !vertical.painRows.length ? ` The ${vertical.name} vertical has no pain points yet: add them here, or on the Verticals page so future blueprints get them.` : ''}`;
  }
  if (body.action === 'create' && !content && body.copyFrom) {
    const src = typeof body.copyFrom === 'string' && SLUG_RE.test(body.copyFrom) ? await loadRow(body.copyFrom) : null;
    if (!src || src.source !== 'builder' || !src.draft) throw httpError(404, 'No form-built blueprint to copy with that name.');
    content = JSON.parse(JSON.stringify(src.draft));
    // The copy is for another client: keep the content, drop the other client's logo and screenshots.
    content.client = { name: String(body.clientName || '').trim(), logo: '' };
    if (content.header) content.header.mode = 'name';
    for (const j of (content.journeys && content.journeys.items) || []) { j.images = []; j.alsoImage = ''; }
    if (content.design) content.design.images = [];
    content.reviewNote = `Copied from another blueprint (${body.copyFrom}). Its logo and screenshots were removed. Replace any text that describes the other client before publishing.`;
  }
  if (body.action === 'create' && content && body.clientName && !(content.client && content.client.name)) {
    content.client = { ...(content.client || {}), name: String(body.clientName).trim() };
  }

  if (body.action === 'preview') {
    if (!content) throw httpError(400, 'Nothing to preview.');
    // Checkboxes and progress work in previews too (local mode: ticks aren't saved).
    const runtime = `<script>window.__LEAN_BP={"local":true};</script>\n<script src="${baseUrl(req)}/bp-runtime.js"></script>\n`;
    const out = renderBlueprint(content, { edit: body.edit === true }).html;
    const at = out.toLowerCase().lastIndexOf('</body>');
    return send(res, 200, { html: at === -1 ? out + runtime : out.slice(0, at) + runtime + out.slice(at) });
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
    const owner = cleanOwner(body.ownerEmail, body.by);
    if (owner.error) throw httpError(400, owner.error);
    await query(
      `INSERT INTO blueprints (slug, title, html, items, size_bytes, uploaded_by, source, draft, draft_updated_at, name, owner_email, owner_name)
       VALUES ($1, $2, NULL, '{}', NULL, $3, 'builder', $4, now(), $5, $6, $7)`,
      [slug, title, by(body.by), content, clientName(content), owner.email, owner.name],
    );
    return send(res, 201, await loadRow(slug));
  }

  const row = await loadRow(slug);
  if (!row) throw httpError(404, 'That blueprint no longer exists.');
  if (row.source !== 'builder') throw httpError(409, 'This blueprint was uploaded as a file. Use Replace file to change it.');

  if (body.action === 'save') {
    await query('UPDATE blueprints SET draft = $2, draft_updated_at = now(), title = $3, name = $4 WHERE slug = $1', [slug, content, title, clientName(content)]);
    return send(res, 200, await loadRow(slug));
  }

  if (body.action === 'publish') {
    await saveVersion(slug, 'Before publish', by(body.by));
    const { html } = renderBlueprint(content);
    const info = inspectHtml(html);
    if (info.problems.length) throw httpError(400, info.problems.join(' '));
    await query(
      `UPDATE blueprints SET draft = $2, draft_updated_at = now(), title = $3, html = $4, items = $5,
              size_bytes = $6, uploaded_by = $7, published_at = now(), updated_at = now(), name = $8, structure = $9
        WHERE slug = $1`,
      [slug, content, title, html, info.items, info.size, by(body.by), clientName(content), parseStructure(html)],
    );
    return send(res, 200, await loadRow(slug));
  }

  throw httpError(400, 'Unknown action.');
});
