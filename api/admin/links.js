// POST  /api/admin/links  { slug, label, kind, createdBy } -> new link with its URL
// PATCH /api/admin/links  { token, revoked: true|false }   -> revoke or restore a link
import { randomBytes } from 'node:crypto';
import { handler, readJson, send, httpError, baseUrl } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { query } from '../../lib/db.js';
import { loadMeta, TOKEN_RE } from '../../lib/blueprints.js';

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default handler(['POST', 'PATCH'], async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);

  if (req.method === 'POST') {
    const slug = clean(body.slug, 63);
    const label = clean(body.label, 80);
    const kind = body.kind === 'internal' ? 'internal' : 'client';
    if (!(await loadMeta(slug))) throw httpError(400, 'No blueprint with that name');
    if (!label) throw httpError(400, 'Add who the link is for');
    const token = randomBytes(18).toString('base64url');
    const { rows } = await query(
      `INSERT INTO links (token, slug, label, kind, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING token, slug, label, kind, created_by, created_at`,
      [token, slug, label, kind, clean(body.createdBy, 80) || null],
    );
    return send(res, 201, { ...rows[0], url: `${baseUrl(req)}/b/${token}` });
  }

  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) throw httpError(400, 'Bad token');
  const { rows } = await query(
    `UPDATE links SET revoked_at = CASE WHEN $2 THEN coalesce(revoked_at, now()) ELSE NULL END
     WHERE token = $1 RETURNING token, revoked_at`,
    [body.token, body.revoked === true],
  );
  if (!rows.length) throw httpError(404, 'Link not found');
  send(res, 200, rows[0]);
});
