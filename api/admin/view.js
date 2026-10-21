// POST /api/admin/view  { token }  (admin) -> a 2-hour, read-only address for a client team's link
import { handler, readJson, send, httpError, baseUrl } from '../../lib/http.js';
import { requireAdmin } from '../../lib/auth.js';
import { findActiveLink } from '../../lib/blueprints.js';
import { makeViewParam } from '../../lib/viewsig.js';

export default handler(['POST'], async (req, res) => {
  requireAdmin(req);
  const { token } = await readJson(req);
  const link = await findActiveLink(token);
  if (!link) throw httpError(404, 'That link isn’t active.');
  if (link.kind !== 'client') throw httpError(400, 'View progress is for client team links.');
  send(res, 200, { url: `${baseUrl(req)}/b/${link.token}?view=${makeViewParam(link.token)}` });
});
