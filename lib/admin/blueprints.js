// POST /api/admin/blueprints  { slug, html, uploadedBy, replace }  (admin)
// Adds a new blueprint, or replaces the file of an existing one when replace is true.
// Checklist ticks are kept for every key that still exists in the new file.
// PATCH  /api/admin/blueprints  { slug, name }     (admin) rename an uploaded blueprint in the admin page
// DELETE /api/admin/blueprints  { slug, confirm }  (admin)
// Deletes a blueprint with all its links, visits and checklist ticks. "confirm" must equal the slug.
import { handler, readJson, send, httpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query, withTransaction } from '../db.js';
import { SLUG_RE, MAX_BYTES, inspectHtml, loadMeta, deriveName, cleanName, stripStandalone, stripEmbeddedRuntime } from '../blueprints.js';
import { parseStructure } from '../structure.js';
import { saveVersion } from '../versions.js';
import { cleanOwner } from '../owner.js';

export default handler(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req, MAX_BYTES + 512 * 1024);
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';

  if (req.method === 'PATCH' && body.ownerEmail !== undefined) { // Change owner
    const owner = cleanOwner(body.ownerEmail, body.ownerName);
    if (owner.error) throw httpError(400, owner.error);
    if (!owner.email) throw httpError(400, 'Enter the new owner’s Lean email.');
    const { rowCount } = await query('UPDATE blueprints SET owner_email = $2, owner_name = $3 WHERE slug = $1', [slug, owner.email, owner.name]);
    if (!rowCount) throw httpError(404, 'That blueprint no longer exists.');
    return send(res, 200, { slug, ownerEmail: owner.email, ownerName: owner.name });
  }
  if (req.method === 'PATCH' && body.notifyEmail !== undefined) {
    // Who's emailed when a client team requests production access: comma-separated, or empty for the default.
    const list = String(body.notifyEmail || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = list.filter((x) => !/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,40}$/.test(x));
    if (bad.length) throw httpError(400, `Not an email address: ${bad.join(', ')}`);
    if (list.length > 5) throw httpError(400, 'Up to 5 addresses.');
    const { rowCount } = await query('UPDATE blueprints SET notify_email = $2 WHERE slug = $1', [slug, list.join(', ') || null]);
    if (!rowCount) throw httpError(404, 'That blueprint no longer exists.');
    return send(res, 200, { slug, notifyEmail: list.join(', ') });
  }
  if (req.method === 'PATCH') {
    const name = cleanName(body.name);
    if (!name) throw httpError(400, 'Add a name.');
    const meta = await loadMeta(slug);
    if (!meta) throw httpError(404, 'That blueprint no longer exists.');
    if (meta.source === 'builder') throw httpError(409, 'This blueprint takes its name from the client name in the form. Change it in Basics.');
    await query('UPDATE blueprints SET name = $2 WHERE slug = $1', [slug, name]);
    return send(res, 200, { slug, name });
  }

  if (req.method === 'DELETE') {
    if (!SLUG_RE.test(slug)) throw httpError(400, 'Bad short name');
    if (body.confirm !== slug) throw httpError(400, `Type the short name "${slug}" to confirm.`);
    const removed = await withTransaction(async (db) => {
      const b = await db.query('SELECT slug FROM blueprints WHERE slug = $1 FOR UPDATE', [slug]);
      if (!b.rows.length) throw httpError(404, 'That blueprint no longer exists.');
      const t = await db.query('DELETE FROM team_checklist WHERE token IN (SELECT token FROM links WHERE slug = $1)', [slug]);
      const v = await db.query('DELETE FROM views WHERE slug = $1', [slug]);
      const l = await db.query('DELETE FROM links WHERE slug = $1', [slug]);
      await db.query('DELETE FROM checklist WHERE slug = $1', [slug]);
      await db.query('DELETE FROM blueprints WHERE slug = $1', [slug]);
      return { links: l.rowCount, visits: v.rowCount, ticks: t.rowCount };
    });
    return send(res, 200, { deleted: true, ...removed });
  }

  if (!SLUG_RE.test(slug)) {
    throw httpError(400, 'Use a short name with lowercase letters, digits and hyphens, e.g. "acme-remit".');
  }
  const html = stripEmbeddedRuntime(stripStandalone(typeof body.html === 'string' ? body.html : '')); // a built-in page script (GitHub Pages copy, or a saved page) is removed
  const info = inspectHtml(html);
  if (!info.title) info.problems.push('Add a <title> to the page. It names the blueprint here and in Slack alerts.');
  if (info.problems.length) throw httpError(400, info.problems.join(' '));

  const existing = await loadMeta(slug);
  if (existing && body.replace !== true) {
    throw httpError(409, `A blueprint called "${slug}" already exists. Open it and use Replace file instead.`);
  }
  if (!existing && body.replace === true) throw httpError(404, 'That blueprint no longer exists.');
  if (existing && existing.source === 'builder') throw httpError(409, 'This blueprint is built in the form. Edit it there instead of uploading a file.');

  const by = typeof body.uploadedBy === 'string' ? body.uploadedBy.trim().slice(0, 80) || null : null;
  // Name: what was typed, else the existing name when replacing, else taken from the page title.
  const name = cleanName(body.name) || (existing && existing.name !== existing.title ? existing.name : '') || deriveName(info.title);
  const owner = cleanOwner(body.ownerEmail, by);
  if (owner.error) throw httpError(400, owner.error);
  if (existing) await saveVersion(slug, 'Before Replace file', by);
  await query(
    `INSERT INTO blueprints (slug, title, html, items, size_bytes, uploaded_by, published_at, name, structure, owner_email, owner_name)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10)
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, html = EXCLUDED.html, items = EXCLUDED.items,
       size_bytes = EXCLUDED.size_bytes, uploaded_by = EXCLUDED.uploaded_by, updated_at = now(), published_at = now(), name = EXCLUDED.name, structure = EXCLUDED.structure`,
    [slug, info.title, html, info.items, info.size, by, name, parseStructure(html), owner.email, owner.name],
  );

  // Keys that had saved ticks but are missing from the new file.
  let droppedTicks = [];
  if (existing) {
    const { rows } = await query(
      `SELECT DISTINCT t.item FROM team_checklist t JOIN links l ON l.token = t.token
        WHERE l.slug = $1 AND t.done = true AND NOT (t.item = ANY($2::text[])) ORDER BY t.item`,
      [slug, info.items],
    );
    droppedTicks = rows.map((r) => r.item);
  }
  send(res, existing ? 200 : 201, { slug, title: info.title, name, items: info.items.length, replaced: !!existing, droppedTicks });
});
