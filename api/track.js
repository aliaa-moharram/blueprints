// POST /api/track  { token, session, event: "open" | "beat" | "leave", seconds? }
// "open" is sent once the page has been visible for ~10 seconds; "beat" and
// "leave" add visible time to that visit.
import { handler, readJson, send, httpError } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta } from '../lib/blueprints.js';
import { notifySlack } from '../lib/notify.js';

const SESSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const EMAIL_RE = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,40}$/;
const LEAN_DOMAINS = () => String(process.env.LEAN_EMAIL_DOMAINS || 'leantech.me').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
// Who's viewing, from the email they entered. Lean or client is decided here, from the domain.
function viewerOf(v) {
  const email = v && typeof v.email === 'string' ? v.email.trim().toLowerCase().slice(0, 200) : '';
  if (!EMAIL_RE.test(email)) return { email: null, name: null, kind: null };
  const domain = email.split('@')[1];
  const kind = LEAN_DOMAINS().some((d) => domain === d || domain.endsWith('.' + d)) ? 'lean' : 'client';
  const name = email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 80);
  return { email, name, kind };
}
const NOTIFY_GAP_HOURS = 12;

export default handler(['POST'], async (req, res) => {
  const body = await readJson(req);
  if (body.view !== undefined && body.view !== null) return send(res, 200, { ok: true, ignored: 'Lean view' });
  const link = await findActiveLink(body.token);
  if (!link) throw httpError(404, 'Link not active');
  if (typeof body.session !== 'string' || !SESSION_RE.test(body.session)) throw httpError(400, 'Bad session');

  if (body.event === 'open') {
    const who = link.kind === 'client' ? viewerOf(body.viewer) : { email: null, name: null, kind: null };
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const country = String(req.headers['x-vercel-ip-country'] || '').slice(0, 2) || null;
    const { rows } = await query(
      `INSERT INTO views (session_id, token, slug, user_agent, country, seconds_visible, viewer_email, viewer_name, viewer_kind)
       VALUES ($1, $2, $3, $4, $5, 10, $6, $7, $8)
       ON CONFLICT (session_id) DO NOTHING RETURNING id`,
      [body.session, link.token, link.slug, ua, country, who.email, who.name, who.kind],
    );
    // The first-view alert is for the client team, never a Lean colleague opening their link.
    if (rows.length && link.kind === 'client' && who.kind !== 'lean') {
      const recent = await query(
        `SELECT 1 FROM views WHERE token = $1 AND id <> $2 AND coalesce(viewer_kind, 'client') <> 'lean'
           AND opened_at > now() - make_interval(hours => $3) LIMIT 1`,
        [link.token, rows[0].id, NOTIFY_GAP_HOURS],
      );
      if (!recent.rows.length) {
        const bp = await loadMeta(link.slug);
        await notifySlack(`${who.name ? `${who.name} (${link.label})` : link.label} opened the ${bp ? bp.name : link.slug} blueprint.`);
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
