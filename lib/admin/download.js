// POST /api/admin/download { slug, version?, format: 'html' | 'pdf' }  (admin) -> { url }: a signed link, valid
//      for 10 minutes, since a download opened in a new tab can't carry the admin password.
// GET  /api/admin/download?slug&version&format&exp&sig                -> the file (HTML) or the print-ready page (PDF)
import { createHmac, timingSafeEqual } from 'node:crypto';
import { handler, readJson, send, httpError, getQuery } from '../http.js';
import { requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { SLUG_RE } from '../blueprints.js';
import { getVersion } from '../versions.js';
import { printView } from '../printview.js';

const MINUTES = 10;
const key = () => process.env.ADMIN_PASSWORD || '';
const mac = (slug, version, format, exp) => createHmac('sha256', key()).update(`download:${slug}:${version || ''}:${format}:${exp}`).digest('base64url');

export default handler(['GET', 'POST'], async (req, res) => {
  if (req.method === 'POST') {
    requireAdmin(req);
    const b = await readJson(req);
    const slug = String(b.slug || ''); const format = b.format === 'pdf' ? 'pdf' : 'html'; const version = b.version ? String(Number(b.version) || '') : '';
    if (!SLUG_RE.test(slug)) throw httpError(400, 'Bad short name');
    const exp = Math.floor(Date.now() / 1000) + MINUTES * 60;
    const qs = new URLSearchParams({ slug, format, exp: String(exp), sig: mac(slug, version, format, exp), ...(version ? { version } : {}) });
    return send(res, 200, { url: `/api/admin/download?${qs}` });
  }
  const q = getQuery(req);
  const slug = String(q.slug || ''), format = q.format === 'pdf' ? 'pdf' : 'html', version = q.version ? String(Number(q.version) || '') : '', exp = Number(q.exp) || 0;
  const want = Buffer.from(mac(slug, version, format, exp)), got = Buffer.from(String(q.sig || ''));
  if (!key() || want.length !== got.length || !timingSafeEqual(want, got)) throw httpError(403, 'This download link isn’t valid. Download again from the admin page.');
  if (exp < Date.now() / 1000) throw httpError(403, 'This download link has expired. Download again from the admin page.');
  const { rows } = await query('SELECT slug, html, coalesce(name, title) AS name FROM blueprints WHERE slug = $1', [slug]);
  if (!rows.length) throw httpError(404, 'That blueprint no longer exists.');
  let html = rows[0].html, stamp = '';
  if (version) { const v = await getVersion(slug, version); if (!v) throw httpError(404, 'That version no longer exists.'); html = v.html; stamp = `-version-${v.id}`; }
  if (!html) throw httpError(404, 'This blueprint isn’t published yet.');
  const base = `${slug}-blueprint${stamp}`;
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (format === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.html"`);
    return res.end(html);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(printView(html, `${rows[0].name || slug} blueprint${version ? ` (version ${version})` : ''}`));
});
