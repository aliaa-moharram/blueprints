// GET /api/admin/overview  (admin) -> blueprints, links with view stats, recent views
import { handler, send } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { query } from '../../lib/db.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  const blueprints = await query(
    `SELECT b.slug, b.title, coalesce(b.name, b.title) AS name, b.size_bytes, b.uploaded_by, b.created_at, b.updated_at, b.source,
            b.published_at, b.draft_updated_at, (b.html IS NOT NULL) AS published,
            (b.source = 'builder' AND b.draft_updated_at > coalesce(b.published_at, 'epoch')) AS unpublished_changes,
            (SELECT count(*)::int FROM unnest(b.items) i WHERE i NOT LIKE '%-prod-%') AS items
       FROM blueprints b ORDER BY lower(coalesce(b.name, b.title))`,
  );
  const links = await query(
    `SELECT l.token, l.slug, l.label, l.kind, l.created_by, l.created_at, l.revoked_at, l.environment, l.environment_changed_at, l.production_requested_at, l.production_request_note,
            count(v.id)::int AS views, min(v.opened_at) AS first_view, max(v.opened_at) AS last_view,
            coalesce(sum(v.seconds_visible), 0)::int AS seconds,
            (SELECT count(*)::int FROM team_checklist t JOIN blueprints b ON b.slug = l.slug
              WHERE t.token = l.token AND t.done AND t.item = ANY(b.items) AND t.item NOT LIKE '%-prod-%') AS done
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
