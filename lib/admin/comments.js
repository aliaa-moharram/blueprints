// GET /api/admin/comments?slug  (admin) -> the blueprint's review comments, for the admin page
import { handler, send, httpError, getQuery } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { SLUG_RE } from '../blueprints.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  const { slug } = getQuery(req);
  if (!SLUG_RE.test(String(slug || ''))) throw httpError(400, 'Bad short name');
  const { rows } = await query(
    `SELECT t.id, t.anchor, t.status, t.created_at, t.resolved_by, t.resolved_at,
            json_agg(json_build_object('author', coalesce(c.author_name, c.author_email), 'body', c.body, 'at', c.created_at) ORDER BY c.created_at) AS comments
       FROM comment_threads t JOIN comments c ON c.thread_id = t.id AND c.deleted_at IS NULL
      WHERE t.slug = $1 GROUP BY t.id ORDER BY (t.status = 'open') DESC, t.created_at DESC`, [slug]);
  send(res, 200, { threads: rows });
});
