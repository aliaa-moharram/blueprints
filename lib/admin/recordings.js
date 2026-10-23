// GET  /api/admin/recordings          -> recording storage used, against the budget (free plan: 1 GB in total)
// POST /api/admin/recordings { url }  -> delete a recording once Lean has reviewed it, to free storage
import { handler, readJson, send, httpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { usage, deleteUpload } from '../blobstore.js';

export default handler(['GET', 'POST'], async (req, res) => {
  requireAdmin(req);
  if (req.method === 'GET') return send(res, 200, await usage());
  const body = await readJson(req);
  const { rows } = await query('SELECT video_url FROM production_requests WHERE video_url = $1 AND video_deleted_at IS NULL', [String(body.url || '')]);
  if (!rows.length) throw httpError(404, 'That recording isn’t stored any more.');
  await deleteUpload(rows[0].video_url, req);
  send(res, 200, { deleted: true, ...(await usage()) });
});
