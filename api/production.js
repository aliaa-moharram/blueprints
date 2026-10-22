// POST /api/production { token, note? }
// A client team asks Lean for production access from their blueprint. Lean is told (Slack, if set up, and the
// admin page), then grants it by setting the team's environment to Production. Asking twice is harmless.
import { handler, readJson, send, httpError, baseUrl } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta } from '../lib/blueprints.js';
import { notifySlack } from '../lib/notify.js';

const SETUP = ['dev', 'start', 'wh'];
const counted = (k) => !k.includes('-prod-');
const of = (ids) => (k) => ids.some((id) => k.startsWith(id + '-')) && counted(k);

export default handler(['POST'], async (req, res) => {
  const input = await readJson(req);
  const link = await findActiveLink(input.token);
  if (!link) throw httpError(404, 'Link not active');
  if (link.kind !== 'client') throw httpError(403, 'Only the client team can request production access, from their blueprint link.');
  if (link.environment === 'production') throw httpError(409, 'This team is already in production.');
  const bp = await loadMeta(link.slug);
  if (!bp) throw httpError(404, 'Blueprint not found');
  if (link.production_requested_at) {
    return send(res, 200, { requestedAt: link.production_requested_at, note: link.production_request_note, alreadyRequested: true });
  }
  const note = typeof input.note === 'string' ? input.note.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, 1000) : '';
  const { rows } = await query(
    `UPDATE links SET production_requested_at = now(), production_request_note = $2
     WHERE token = $1 AND kind = 'client' AND revoked_at IS NULL AND production_requested_at IS NULL
     RETURNING production_requested_at, production_request_note`, [link.token, note || null]);
  if (!rows.length) { // requested at the same moment from another tab
    const again = await findActiveLink(input.token);
    return send(res, 200, { requestedAt: again.production_requested_at, note: again.production_request_note, alreadyRequested: true });
  }
  // Readiness from the team's own ticks, worked out here rather than taken from the page.
  const { rows: ticks } = await query('SELECT item FROM team_checklist WHERE token = $1 AND done', [link.token]);
  const done = new Set(ticks.map((t) => t.item));
  const tally = (pick) => { const all = bp.items.filter(pick); return `${all.filter((k) => done.has(k)).length} of ${all.length}`; };
  const site = (process.env.PUBLIC_BASE_URL || baseUrl(req)).replace(/\/+$/, '');
  await notifySlack(`🚀 ${link.label} requested production access for the ${bp.name || link.slug} blueprint.\n` +
    `Sandbox setup: ${tally(of(SETUP))} · End-to-end test: ${tally(of(['e2e']))}` +
    (note ? `\nNote: ${note}` : '') + `\nGrant it by setting their environment to Production: ${site}/admin`);
  send(res, 200, { requestedAt: rows[0].production_requested_at, note: rows[0].production_request_note });
});
