// Lean-only review comments on a blueprint, for reviewing it before it's shared (for example, SolEng writes it
// and Sales reviews it). Never available on a client team's own link: only on Lean team links and on the
// signed Lean view opened from the admin page. Only Lean emails can comment.
// GET  /api/comments?token[&view]                                   -> threads with their comments
// POST /api/comments { token, view?, viewer, action, ... }
//      create { anchor, body } · reply { threadId, body } · resolve { threadId, resolved } · delete { commentId }
import { handler, readJson, send, httpError, getQuery, baseUrl } from '../lib/http.js';
import { query, withTransaction } from '../lib/db.js';
import { findActiveLink, loadMeta } from '../lib/blueprints.js';
import { checkViewParam } from '../lib/viewsig.js';
import { classify, viewerEmail } from '../lib/viewer.js';
import { sendEmail } from '../lib/email.js';

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const escH = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function access(token, view) {
  const link = await findActiveLink(token);
  if (!link) throw httpError(404, 'Link not active');
  const leanView = link.kind === 'client' && view !== undefined && checkViewParam(link.token, view) === 'ok';
  if (link.kind !== 'internal' && !leanView) throw httpError(403, 'Review comments are only available to the Lean team.');
  return link;
}
function cleanAnchor(a) {
  a = a && typeof a === 'object' ? a : {};
  return { panel: /^[a-z0-9-]{1,30}$/.test(a.panel || '') ? a.panel : null, check: /^[a-z0-9-]{1,40}$/.test(a.check || '') ? a.check : null,
    section: text(a.section, 120), block: text(a.block, 300), quote: text(a.quote, 500), tag: /^[a-z0-9]{1,10}$/.test(a.tag || '') ? a.tag : null };
}
async function threads(slug) {
  const { rows: ts } = await query('SELECT id, anchor, status, created_by, created_at, resolved_by, resolved_at FROM comment_threads WHERE slug = $1 ORDER BY created_at', [slug]);
  if (!ts.length) return [];
  const { rows: cs } = await query(`SELECT id, thread_id, author_email, author_name, body, created_at FROM comments WHERE thread_id = ANY($1) AND deleted_at IS NULL ORDER BY created_at`, [ts.map((t) => t.id)]);
  return ts.map((t) => ({ ...t, comments: cs.filter((c) => c.thread_id === t.id) })).filter((t) => t.comments.length);
}

async function notify(req, link, bp, who, thread, body, kind) {
  const owner = (bp.notify_email || process.env.NOTIFY_EMAIL || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const { rows } = await query('SELECT DISTINCT author_email FROM comments WHERE thread_id = $1 AND deleted_at IS NULL', [thread.id]);
  const participants = kind === 'reply' ? rows.map((r) => r.author_email) : [];
  const to = [...new Set([...owner, ...participants])].filter((e) => e !== who.email);
  if (!to.length) return;
  const site = (process.env.PUBLIC_BASE_URL || baseUrl(req)).replace(/\/+$/, '');
  const url = `${site}/b/${link.token}#comment-${thread.id}`;
  const a = thread.anchor || {};
  const where = a.quote ? `“${a.quote.slice(0, 160)}”` : a.block ? `“${a.block.slice(0, 160)}”` : a.section || 'the blueprint';
  const name = bp.name || link.slug;
  await sendEmail({
    to, replyTo: who.email,
    subject: `${who.name} ${kind === 'reply' ? 'replied to a review comment' : 'commented'} on ${name}`,
    text: `${who.name} ${kind === 'reply' ? 'replied' : 'commented'} on the ${name} blueprint${a.section ? `, in ${a.section}` : ''}.\n\nOn ${where}:\n\n${body}\n\nOpen it: ${url}`,
    html: `<div style="font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1c2024;max-width:560px"><p style="margin:0 0 10px"><b>${escH(who.name)}</b> ${kind === 'reply' ? 'replied' : 'commented'} on the <b>${escH(name)}</b> blueprint${a.section ? `, in ${escH(a.section)}` : ''}.</p>` +
      `<p style="margin:0 0 6px;color:#6b7280;font-size:13px">On ${escH(where)}</p><blockquote style="margin:0 0 16px;padding:10px 14px;background:#f5f6f7;border-left:3px solid #3dd68c;white-space:pre-wrap">${escH(body)}</blockquote>` +
      `<p style="margin:0"><a href="${escH(url)}" style="color:#1c2024;font-weight:700">Open the comment</a></p><p style="margin:14px 0 0;color:#6b7280;font-size:13px">Review comments are only visible to the Lean team.</p></div>`,
  });
}

export default handler(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const q = getQuery(req);
    const link = await access(q.token, q.view);
    return send(res, 200, { threads: await threads(link.slug) });
  }
  const b = await readJson(req);
  const link = await access(b.token, b.view);
  const who = classify(viewerEmail(req, b), []);
  if (who.kind !== 'lean') throw httpError(403, 'Only Lean team members can comment. Check the email you entered (Not you?).');
  const bp = await loadMeta(link.slug);
  if (b.action === 'create' || b.action === 'reply') {
    const body = text(b.body, 4000);
    if (!body) throw httpError(400, 'Write a comment first.');
    let thread;
    if (b.action === 'create') {
      thread = await withTransaction(async (db) => {
        const t = await db.query('INSERT INTO comment_threads (slug, anchor, created_by) VALUES ($1, $2, $3) RETURNING id, anchor', [link.slug, cleanAnchor(b.anchor), who.email]);
        await db.query('INSERT INTO comments (thread_id, author_email, author_name, body) VALUES ($1, $2, $3, $4)', [t.rows[0].id, who.email, who.name, body]);
        return t.rows[0];
      });
    } else {
      const t = await query('SELECT id, anchor FROM comment_threads WHERE id = $1 AND slug = $2', [Number(b.threadId) || 0, link.slug]);
      if (!t.rows.length) throw httpError(404, 'That comment no longer exists.');
      thread = t.rows[0];
      await query('INSERT INTO comments (thread_id, author_email, author_name, body) VALUES ($1, $2, $3, $4)', [thread.id, who.email, who.name, body]);
      await query(`UPDATE comment_threads SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = $1 AND status = 'resolved'`, [thread.id]); // a reply reopens it
    }
    await notify(req, link, bp || {}, who, thread, body, b.action);
    return send(res, 200, { threads: await threads(link.slug), threadId: thread.id });
  }
  if (b.action === 'resolve') {
    const resolved = b.resolved !== false;
    const r = await query(`UPDATE comment_threads SET status = $3, resolved_by = $4, resolved_at = ${resolved ? 'now()' : 'NULL'} WHERE id = $1 AND slug = $2`,
      [Number(b.threadId) || 0, link.slug, resolved ? 'resolved' : 'open', resolved ? who.email : null]);
    if (!r.rowCount) throw httpError(404, 'That comment no longer exists.');
    return send(res, 200, { threads: await threads(link.slug) });
  }
  if (b.action === 'delete') {
    const r = await query(`UPDATE comments c SET deleted_at = now() FROM comment_threads t WHERE c.id = $1 AND c.thread_id = t.id AND t.slug = $2 AND c.author_email = $3 AND c.deleted_at IS NULL`,
      [Number(b.commentId) || 0, link.slug, who.email]);
    if (!r.rowCount) throw httpError(403, 'You can only delete your own comments.');
    return send(res, 200, { threads: await threads(link.slug) });
  }
  throw httpError(400, 'Unknown action.');
});
