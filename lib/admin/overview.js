// GET /api/admin/overview  (admin) -> blueprints, links with view stats, recent views
import { handler, send } from '../http.js';
import { requireAdmin } from '../auth.js';
import { usage } from '../blobstore.js';
import { query } from '../db.js';

export default handler(['GET'], async (req, res) => {
  requireAdmin(req);
  const blueprints = await query(
    `SELECT b.slug, b.title, coalesce(b.name, b.title) AS name, b.size_bytes, b.uploaded_by, b.created_at, b.updated_at, b.source, b.notify_email,
            b.published_at, b.draft_updated_at, (b.html IS NOT NULL) AS published,
            (b.source = 'builder' AND b.draft_updated_at > coalesce(b.published_at, 'epoch')) AS unpublished_changes,
            (SELECT count(*)::int FROM unnest(b.items) i WHERE i NOT LIKE '%-prod-%') AS items
       FROM blueprints b ORDER BY lower(coalesce(b.name, b.title))`,
  );
  const links = await query(
    `SELECT l.token, l.slug, l.label, l.kind, l.created_by, l.created_at, l.revoked_at, l.environment, l.environment_changed_at, l.production_requested_at, l.production_request_note, l.production_requested_by, l.client_domains,
            count(v.id) FILTER (WHERE coalesce(v.viewer_kind, 'client') = 'client')::int AS views,
            min(v.opened_at) FILTER (WHERE coalesce(v.viewer_kind, 'client') = 'client') AS first_view,
            max(v.opened_at) FILTER (WHERE coalesce(v.viewer_kind, 'client') = 'client') AS last_view,
            coalesce(sum(v.seconds_visible) FILTER (WHERE coalesce(v.viewer_kind, 'client') = 'client'), 0)::int AS seconds,
            (SELECT coalesce(json_agg(p ORDER BY p.last DESC), '[]'::json) FROM (
               SELECT max(viewer_name) AS name, viewer_email AS email, max(viewer_kind) AS kind, count(*)::int AS visits, max(opened_at) AS last
                 FROM views WHERE token = l.token AND viewer_email IS NOT NULL GROUP BY viewer_email) p) AS people,
            (SELECT row_to_json(r) FROM (SELECT created_at, requested_by, note, video_url, video_name, video_bytes, video_na_reason, video_deleted_at,
                     account_holder_name, trade_license_number, iban, account_number, bank_address
                FROM production_requests WHERE token = l.token ORDER BY created_at DESC LIMIT 1) r) AS production_request,
            (SELECT count(*)::int FROM team_checklist t JOIN blueprints b ON b.slug = l.slug
              WHERE t.token = l.token AND t.done AND t.item = ANY(b.items) AND t.item NOT LIKE '%-prod-%') AS done
       FROM links l LEFT JOIN views v ON v.token = l.token
      GROUP BY l.token ORDER BY l.created_at DESC`,
  );
  const recent = await query(
    `SELECT v.opened_at, v.seconds_visible, v.country, v.user_agent, v.viewer_name, v.viewer_kind, l.label, l.kind, l.slug
       FROM views v JOIN links l ON l.token = v.token
      ORDER BY v.opened_at DESC LIMIT 200`,
  );
  send(res, 200, { blueprints: blueprints.rows, links: links.rows, recent: recent.rows, defaultNotify: process.env.NOTIFY_EMAIL || '', storage: await usage() });
});
