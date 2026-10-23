// GET /api/admin/activity  (admin) -> recent production requests and review comments, newest first, for the
// admin page's "What's new". Each event has its blueprint's owner, so the page can show someone their own.
import { handler, send } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'production' AS type, pr.created_at AS at, l.slug, coalesce(b.name, b.title) AS name, b.owner_email,
              l.label AS team, pr.requested_by AS who, NULL::text AS body, NULL::int AS thread_id, false AS reply,
              NULL::text AS section, NULL::text AS quote
         FROM production_requests pr JOIN links l ON l.token = pr.token JOIN blueprints b ON b.slug = l.slug
       UNION ALL
       SELECT 'comment', c.created_at, t.slug, coalesce(b.name, b.title), b.owner_email,
              NULL, coalesce(c.author_name, c.author_email), left(c.body, 240), t.id,
              c.id <> (SELECT min(c2.id) FROM comments c2 WHERE c2.thread_id = t.id), t.anchor->>'section', left(coalesce(t.anchor->>'quote', t.anchor->>'block'), 140)
         FROM comments c JOIN comment_threads t ON t.id = c.thread_id JOIN blueprints b ON b.slug = t.slug
        WHERE c.deleted_at IS NULL
     ) e WHERE at > now() - interval '90 days' ORDER BY at DESC LIMIT 150`);
  send(res, 200, { events: rows });
});
