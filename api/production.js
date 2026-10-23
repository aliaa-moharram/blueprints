// POST /api/production { token, viewer, accountHolderName, tradeLicenseNumber, iban, accountNumber, bankAddress,
//                        video: { url, name, bytes } | videoNa: true, videoNaReason, note? }
// A client team asks Lean for production access, with a demo recording (or why one doesn't apply) and their
// production Settlement Account details. Lean is told by email and Slack (bank details masked) and sees the
// full request in the admin page; it grants access by setting the team's environment to Production.
import { handler, readJson, send, httpError, baseUrl } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink, loadMeta } from '../lib/blueprints.js';
import { notifySlack } from '../lib/notify.js';
import { sendEmail } from '../lib/email.js';
import { classify, viewerEmail } from '../lib/viewer.js';
import { checkRequest, mask } from '../lib/prodrequest.js';
import { cleanupExcept } from '../lib/blobstore.js';

const SETUP = ['dev', 'start', 'wh'];
const counted = (k) => !k.includes('-prod-');
const of = (ids) => (k) => ids.some((id) => k.startsWith(id + '-')) && counted(k);
const escH = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (b) => (b ? `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB` : '');

export default handler(['POST'], async (req, res) => {
  const input = await readJson(req);
  const link = await findActiveLink(input.token);
  if (!link) throw httpError(404, 'Link not active');
  if (link.kind !== 'client') throw httpError(403, 'Only the client team can request production access, from their blueprint link.');
  if (link.environment === 'production') throw httpError(409, 'This team is already in production.');
  const who = classify(viewerEmail(req, input), link.client_domains);
  if (who.kind !== 'client') throw httpError(403, who.kind === 'lean' ? 'Lean team members can’t request production access for the client.' : 'Only the client team can request production access. Check the email you entered (Not you?).');
  const bp = await loadMeta(link.slug);
  if (!bp) throw httpError(404, 'Blueprint not found');
  if (link.production_requested_at) {
    return send(res, 200, { requestedAt: link.production_requested_at, note: link.production_request_note, alreadyRequested: true });
  }
  const checked = checkRequest(input, link.token);
  if (checked.errors) throw httpError(400, 'Check the highlighted fields.', { fields: checked.errors });
  const v = checked.values;
  const { rows } = await query(
    `UPDATE links SET production_requested_at = now(), production_request_note = $2, production_requested_by = $3
     WHERE token = $1 AND kind = 'client' AND revoked_at IS NULL AND production_requested_at IS NULL
     RETURNING production_requested_at, production_request_note`, [link.token, v.note || null, who.email]);
  if (!rows.length) { // sent at the same moment from another tab
    const again = await findActiveLink(input.token);
    return send(res, 200, { requestedAt: again.production_requested_at, note: again.production_request_note, alreadyRequested: true });
  }
  await query(
    `INSERT INTO production_requests (token, requested_by, note, video_url, video_name, video_bytes, video_na_reason,
       account_holder_name, trade_license_number, iban, account_number, bank_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [link.token, who.email, v.note || null, v.video && v.video.url, v.video && v.video.name, v.video && v.video.bytes,
      v.videoNa ? v.videoNaReason : null, v.accountHolderName, v.tradeLicenseNumber, v.iban, v.accountNumber, v.bankAddress]);

  // Storage: make sure the sent recording is counted (if Vercel's completion callback hasn't arrived yet),
  // then delete anything else uploaded during this attempt.
  if (v.video) {
    const have = await query('SELECT 1 FROM blob_uploads WHERE url = $1', [v.video.url]);
    if (!have.rows.length) {
      await query(`UPDATE blob_uploads SET status = 'stored', url = $2, completed_at = now()
         WHERE id = (SELECT id FROM blob_uploads WHERE token = $1 AND url IS NULL AND status = 'reserved' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1)`, [link.token, v.video.url]);
    }
  }
  await cleanupExcept(link.token, v.video && v.video.url, req);

  // Readiness from the team's own ticks, worked out here rather than taken from the page.
  const { rows: ticks } = await query('SELECT item FROM team_checklist WHERE token = $1 AND done', [link.token]);
  const done = new Set(ticks.map((t) => t.item));
  const tally = (pick) => { const all = bp.items.filter(pick); return `${all.filter((k) => done.has(k)).length} of ${all.length}`; };
  const site = (process.env.PUBLIC_BASE_URL || baseUrl(req)).replace(/\/+$/, '');
  const name = bp.name || link.slug;
  const recording = v.video ? `${v.video.name}${v.video.bytes ? ` (${mb(v.video.bytes)})` : ''}` : `Not applicable: ${v.videoNaReason}`;
  const lines = [
    ['Requested by', `${who.name} <${who.email}>`],
    ['Sandbox setup', tally(of(SETUP))], ['End-to-end test', tally(of(['e2e']))],
    ['Demo recording', recording],
    ['Account holder', v.accountHolderName], ['Trade licence', v.tradeLicenseNumber],
    ['IBAN', mask(v.iban)], ['Account number', mask(v.accountNumber)], ['Bank address', v.bankAddress],
    ...(v.note ? [['Note', v.note]] : []),
  ];
  await notifySlack(`🚀 ${who.name} (${link.label}) requested production access for the ${name} blueprint.\n` +
    `Sandbox setup: ${tally(of(SETUP))} · End-to-end test: ${tally(of(['e2e']))} · Recording: ${v.video ? 'uploaded' : 'not applicable'}` +
    (v.note ? `\nNote: ${v.note}` : '') + `\nReview it and grant access in the admin page: ${site}/admin`);
  const to = (bp.notify_email || process.env.NOTIFY_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
  await sendEmail({
    to, replyTo: who.email,
    subject: `${link.label} requested production access (${name})`,
    text: `${link.label} requested production access for the ${name} blueprint.\n\n` + lines.map(([k, val]) => `${k}: ${val}`).join('\n') +
      (v.video ? `\n\nWatch the recording: ${v.video.url}` : '') + `\n\nReview the full details and grant access: ${site}/admin\nThe IBAN and account number are shown in full in the admin page.`,
    html: `<div style="font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1c2024;max-width:560px">` +
      `<h2 style="font-size:18px;margin:0 0 6px">${escH(link.label)} requested production access</h2><p style="margin:0 0 16px;color:#4b5563">${escH(name)} blueprint</p>` +
      `<table style="border-collapse:collapse;width:100%;font-size:14px">${lines.map(([k, val]) => `<tr><td style="padding:6px 10px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escH(k)}</td><td style="padding:6px 0;vertical-align:top">${escH(val)}</td></tr>`).join('')}</table>` +
      `<p style="margin:20px 0 8px">${v.video ? `<a href="${escH(v.video.url)}" style="color:#1c2024;font-weight:700">Watch the recording</a> · ` : ''}<a href="${escH(site)}/admin" style="color:#1c2024;font-weight:700">Review and grant access</a></p>` +
      `<p style="margin:12px 0 0;color:#6b7280;font-size:13px">The IBAN and account number are shown in full in the admin page. Reply to this email to answer ${escH(who.name)} directly.</p></div>`,
  });
  send(res, 200, { requestedAt: rows[0].production_requested_at, note: rows[0].production_request_note,
    summary: { video: v.video ? { name: v.video.name, bytes: v.video.bytes } : null, videoNaReason: v.videoNa ? v.videoNaReason : null,
      accountHolderName: v.accountHolderName, iban: mask(v.iban), accountNumber: mask(v.accountNumber) } });
});
