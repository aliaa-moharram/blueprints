// POST  /api/admin/links  { slug, label, kind, createdBy } -> new link with its URL
// PATCH /api/admin/links  { token, revoked: true|false }   -> revoke or restore a link
// PATCH /api/admin/links  { token, environment }            -> set a client team's environment ('sandbox' or 'production')
// DELETE /api/admin/links { token }                        -> delete a link with its visits and ticks
import { randomBytes } from 'node:crypto';
import { handler, readJson, send, httpError, baseUrl } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query, withTransaction } from '../db.js';
import { loadMeta, TOKEN_RE } from '../blueprints.js';

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export default handler(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  requireAdmin(req);
  const body = await readJson(req);

  if (req.method === 'POST') {
    const slug = clean(body.slug, 63);
    const label = clean(body.label, 80);
    const kind = body.kind === 'internal' ? 'internal' : 'client';
    const meta = await loadMeta(slug);
    if (!meta) throw httpError(400, 'No blueprint with that name');
    if (!meta.published) throw httpError(400, 'Publish the blueprint before sharing a link.');
    if (!label) throw httpError(400, 'Add the team name');
    const existing = await query(
      `SELECT token, slug, label, kind, created_by, created_at FROM links
        WHERE slug = $1 AND lower(label) = lower($2) AND revoked_at IS NULL LIMIT 1`,
      [slug, label],
    );
    if (existing.rows.length) {
      // One link per team: hand back the team's existing link instead of a second one.
      return send(res, 200, { ...existing.rows[0], url: `${baseUrl(req)}/b/${existing.rows[0].token}`, existing: true });
    }
    if (kind === 'client') {
      // One client team per blueprint.
      const other = await query(`SELECT label FROM links WHERE slug = $1 AND kind = 'client' AND revoked_at IS NULL LIMIT 1`, [slug]);
      if (other.rows.length) throw httpError(409, `This blueprint already has a client team link, for ${other.rows[0].label}. Each blueprint has one client team: revoke that link first to make a new one.`);
    }
    const token = randomBytes(18).toString('base64url');
    const { rows } = await query(
      `INSERT INTO links (token, slug, label, kind, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING token, slug, label, kind, created_by, created_at`,
      [token, slug, label, kind, clean(body.createdBy, 80) || null],
    );
    return send(res, 201, { ...rows[0], url: `${baseUrl(req)}/b/${token}` });
  }

  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) throw httpError(400, 'Bad token');

  if (req.method === 'DELETE') {
    const removed = await withTransaction(async (db) => {
      const { rows } = await db.query('SELECT revoked_at FROM links WHERE token = $1 FOR UPDATE', [body.token]);
      if (!rows.length) throw httpError(404, 'Link not found');
      const v = await db.query('DELETE FROM views WHERE token = $1', [body.token]);
      const t = await db.query('DELETE FROM team_checklist WHERE token = $1', [body.token]);
      await db.query('DELETE FROM links WHERE token = $1', [body.token]);
      return { visits: v.rowCount, ticks: t.rowCount };
    });
    return send(res, 200, { deleted: true, ...removed });
  }

  if (body.environment !== undefined) {
    if (!['sandbox', 'production'].includes(body.environment)) throw httpError(400, 'Environment must be sandbox or production.');
    const { rows } = await query(
      `UPDATE links SET environment = $2, environment_changed_at = now() WHERE token = $1 AND kind = 'client'
       RETURNING token, environment, environment_changed_at`, [body.token, body.environment]);
    if (!rows.length) throw httpError(404, 'No client team link with that token.');
    return send(res, 200, rows[0]);
  }
  if (body.revoked === false) {
    const l = await query('SELECT slug, kind FROM links WHERE token = $1', [body.token]);
    if (l.rows.length && l.rows[0].kind === 'client') {
      const other = await query(`SELECT label FROM links WHERE slug = $1 AND kind = 'client' AND revoked_at IS NULL AND token <> $2 LIMIT 1`, [l.rows[0].slug, body.token]);
      if (other.rows.length) throw httpError(409, `This blueprint already has an active client team link, for ${other.rows[0].label}. Revoke it before restoring this one.`);
    }
  }
  const { rows } = await query(
    `UPDATE links SET revoked_at = CASE WHEN $2 THEN coalesce(revoked_at, now()) ELSE NULL END
     WHERE token = $1 RETURNING token, revoked_at`,
    [body.token, body.revoked === true],
  );
  if (!rows.length) throw httpError(404, 'Link not found');
  send(res, 200, rows[0]);
});
