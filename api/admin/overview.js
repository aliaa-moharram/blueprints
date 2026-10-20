// GET /api/admin/overview  (admin) -> blueprints, links with view stats, recent views
import { handler, send } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { query } from '../../lib/db.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  const blueprints = await query(
    `SELECT b.slug, b.title, b.size_bytes, b.uploaded_by, b.created_at, b.updated_at, b.source,
            b.published_at, b.draft_updated_at, (b.html IS NOT NULL) AS published,
            (b.source = 'builder' AND b.draft_updated_at > coalesce(b.published_at, 'epoch')) AS unpublished_changes,
            cardinality(b.items)::int AS items,
            (SELECT count(*)::int FROM checklist c WHERE c.slug = b.slug AND c.done AND c.item = ANY(b.items)) AS done
       FROM blueprints b ORDER BY b.updated_at DESC`,
  );
  const links = await query(
    `SELECT l.token, l.slug, l.label, l.kind, l.created_by, l.created_at, l.revoked_at,
            count(v.id)::int AS views, min(v.opened_at) AS first_view, max(v.opened_at) AS last_view,
            coalesce(sum(v.seconds_visible), 0)::int AS seconds
       FROM links l LEFT JOIN views v ON v.token = l.token
      GROUP BY l.token ORDER BY l.created_at DESC`,
  );
  const recent = await query(
    `SELECT v.opened_at, v.seconds_visible, v.country, v.user_agent, l.label, l.kind, l.slug
       FROM views v JOIN links l ON l.token = v.token
      ORDER BY v.opened_at DESC LIMIT 200`,
  );
  send(res, 200, { blueprints: blueprints.rows, links: links.rows, recent: recent.rows });
});
