// POST /api/track
//   { event: "identify", token, email }      -> sets the signed viewer cookie (the page then reloads, and that
//                                               load is recorded as a visit by /b/<token>)
//   { event: "forget", token }                -> clears it ("Not you?")
//   { event: "beat" | "leave", token, visit, seconds } -> adds visible time to this page load's visit
// Visits themselves are recorded by the server when the page is requested (api/b.js), so every load counts.
import { handler, readJson, send, httpError } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink } from '../lib/blueprints.js';
import { classify, viewerCookie, clearViewerCookie, isSecure } from '../lib/viewer.js';

const VISIT_RE = /^[0-9a-f-]{36}$/;

export default handler(['POST'], async (req, res) => {
  const body = await readJson(req);
  if (body.view !== undefined && body.view !== null) return send(res, 200, { ok: true, ignored: 'Lean view' });
  const link = await findActiveLink(body.token);
  if (!link) throw httpError(404, 'Link not active');

  if (body.event === 'identify') {
    const who = classify(body.email, []);
    if (!who.email) throw httpError(400, 'Enter a full email address, for example name@company.com.');
    return send(res, 200, { ok: true, name: who.name }, { 'Set-Cookie': viewerCookie(who.email, isSecure(req)) });
  }
  if (body.event === 'forget') return send(res, 200, { ok: true }, { 'Set-Cookie': clearViewerCookie(isSecure(req)) });

  if (body.event === 'beat' || body.event === 'leave') {
    if (typeof body.visit !== 'string' || !VISIT_RE.test(body.visit)) throw httpError(400, 'Bad visit');
    const seconds = Math.max(0, Math.min(120, Math.round(Number(body.seconds) || 0)));
    await query(
      `UPDATE views SET last_seen_at = now(), seconds_visible = LEAST(seconds_visible + $3, 14400)
       WHERE session_id = $1 AND token = $2`,
      [body.visit, link.token, seconds]);
    return send(res, 200, { ok: true });
  }
  throw httpError(400, 'Unknown event');
});
