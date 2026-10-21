// POST /api/track  { token, session, event: "open" | "beat" | "leave", seconds? }
// "open" is sent once the page has been visible for ~10 seconds; "beat" and
// "leave" add visible time to that visit.
import { handler, readJson, send, httpError } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta } from '../lib/blueprints.js';
import { notifySlack } from '../lib/notify.js';

const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const NOTIFY_GAP_HOURS = 12;

export default handler(['POST'], async (req, res) => {
  const body = await readJson(req);
  if (body.view !== undefined && body.view !== null) return send(res, 200, { ok: true, ignored: 'Lean view' });
  const link = await findActiveLink(body.token);
  if (!link) throw httpError(404, 'Link not active');
  if (typeof body.session !== 'string' || !SESSION_RE.test(body.session)) throw httpError(400, 'Bad session');

  if (body.event === 'open') {
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const country = String(req.headers['x-vercel-ip-country'] || '').slice(0, 2) || null;
    const { rows } = await query(
      `INSERT INTO views (session_id, token, slug, user_agent, country, seconds_visible)
       VALUES ($1, $2, $3, $4, $5, 10)
       ON CONFLICT (session_id) DO NOTHING RETURNING id`,
      [body.session, link.token, link.slug, ua, country],
    );
    if (rows.length && link.kind === 'client') {
      const recent = await query(
        `SELECT 1 FROM views WHERE token = $1 AND id <> $2
           AND opened_at > now() - make_interval(hours => $3) LIMIT 1`,
        [link.token, rows[0].id, NOTIFY_GAP_HOURS],
      );
      if (!recent.rows.length) {
        const bp = await loadMeta(link.slug);
        await notifySlack(`${link.label} opened the ${bp ? bp.name : link.slug} blueprint.`);
      }
    }
    return send(res, 200, { ok: true });
  }

  if (body.event === 'beat' || body.event === 'leave') {
    const seconds = Math.max(0, Math.min(120, Math.round(Number(body.seconds) || 0)));
    await query(
      `UPDATE views SET last_seen_at = now(), seconds_visible = LEAST(seconds_visible + $3, 14400)
       WHERE session_id = $1 AND token = $2`,
      [body.session, link.token, seconds],
    );
    return send(res, 200, { ok: true });
  }

  throw httpError(400, 'Unknown event');
});
