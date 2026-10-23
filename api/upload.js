// POST /api/upload: recording uploads for a production access request, straight from the browser to Vercel Blob
// (videos are too big to pass through a function). Within the free plan's limits:
// - each recording is up to 100 MB, and the total stays under the storage budget (900 MB by default, of 1 GB);
// - the server reserves the file's size before issuing a token, and the token only allows that size;
// - one upload operation per recording (no multipart);
// - replaced or removed recordings are deleted, and so is anything left over once the request is sent.
// Checked before any token: an active client team link, a client team email, a video.
// UPLOAD_MODE=local (development and tests only): files are stored on the server instead.
import { handleUpload } from '@vercel/blob/client';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { handler, readJson, send, httpError, getQuery } from '../lib/http.js';
import { query } from '../lib/db.js';
import { findActiveLink } from '../lib/blueprints.js';
import { classify, viewerFromRequest } from '../lib/viewer.js';
import { VIDEO_MAX_BYTES, VIDEO_TYPES, uploadPrefix, budgetBytes } from '../lib/prodrequest.js';
import { LOCAL_DIR, usedBytes, deleteUpload } from '../lib/blobstore.js';

const MB = 1024 * 1024;

// The identity comes from the request's signed viewer cookie when there is one (passed in, never shared).
async function mayUpload(req, token, email) {
  email = viewerFromRequest(req) || email;
  const link = await findActiveLink(token);
  if (!link || link.kind !== 'client') throw httpError(403, 'Uploads are only for the client team’s blueprint link.');
  if (link.environment === 'production') throw httpError(409, 'This team is already in production.');
  if (link.production_requested_at) throw httpError(409, 'This team has already requested production access.');
  if (classify(email, link.client_domains).kind !== 'client') throw httpError(403, 'Only the client team can upload a recording.');
  return link;
}
async function checkRoom(bytes) {
  if (!(bytes > 0)) throw httpError(400, 'Choose a video file.');
  if (bytes > VIDEO_MAX_BYTES) throw httpError(413, 'The recording is over 100 MB. Trim it or export it at a lower quality, for example 720p.');
  if ((await usedBytes()) + bytes > budgetBytes()) {
    throw httpError(409, 'Recording storage is full right now. Tick Not applicable, say you’ll share the recording separately, and send it to Lean another way.');
  }
}

export default handler(['POST', 'GET'], async (req, res) => {
  const local = process.env.UPLOAD_MODE === 'local';
  if (req.method === 'GET') { // local mode only: serve an uploaded file
    if (!local) throw httpError(404, 'Not found');
    const name = String(getQuery(req).file || '');
    if (!/^[A-Za-z0-9_-]+-[a-f0-9]{16}\.(mp4|mov|webm|mkv|avi|mpeg|bin)$/.test(name)) throw httpError(404, 'Not found');
    const data = await readFile(path.join(LOCAL_DIR, name)).catch(() => null);
    if (!data) throw httpError(404, 'Not found');
    res.statusCode = 200; res.setHeader('Content-Type', 'video/mp4'); return res.end(data);
  }
  if (local && String(req.headers['content-type'] || '').startsWith('video/')) {
    const { token, email, name } = getQuery(req);
    await mayUpload(req, token, email);
    const type = String(req.headers['content-type']).split(';')[0];
    if (!VIDEO_TYPES.includes(type)) throw httpError(400, 'Upload a video file.');
    const declared = Number(req.headers['content-length']) || 0;
    await checkRoom(declared || 1);
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > VIDEO_MAX_BYTES) throw httpError(413, 'The recording is over 100 MB.'); chunks.push(c); }
    const ext = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi', 'video/mpeg': 'mpeg' }[type] || 'bin';
    const file = `${token}-${randomBytes(8).toString('hex')}.${ext}`;
    await mkdir(LOCAL_DIR, { recursive: true }); await writeFile(path.join(LOCAL_DIR, file), Buffer.concat(chunks));
    const url = `${String(req.headers['x-forwarded-proto'] || 'http')}://${req.headers.host}/api/upload?file=${file}`;
    await query(`INSERT INTO blob_uploads (token, pathname, url, bytes, status, completed_at) VALUES ($1, $2, $3, $4, 'stored', now())`, [token, file, url, size]);
    return send(res, 200, { url, pathname: file, name: String(name || 'recording').slice(0, 200), bytes: size });
  }
  const body = await readJson(req);
  if (body.action === 'delete') { // the client replaced or removed a recording
    await mayUpload(req, body.token, body.email);
    const { rows } = await query(`SELECT url FROM blob_uploads WHERE token = $1 AND url = $2 AND deleted_at IS NULL`, [body.token, String(body.url || '')]);
    if (rows.length) await deleteUpload(rows[0].url);
    return send(res, 200, { deleted: rows.length > 0 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw httpError(503, 'Video uploads aren’t set up yet. Tick Not applicable for now and send the recording to Lean another way.');
  const result = await handleUpload({
    body, request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      let p = {}; try { p = JSON.parse(clientPayload || '{}'); } catch {}
      await mayUpload(req, p.token, p.email);
      if (!String(pathname).startsWith(uploadPrefix(p.token))) throw httpError(400, 'Wrong upload folder.');
      const bytes = Math.ceil(Number(p.bytes) || 0);
      await checkRoom(bytes);
      const { rows } = await query(`INSERT INTO blob_uploads (token, pathname, bytes) VALUES ($1, $2, $3) RETURNING id`, [p.token, pathname, bytes]);
      return { allowedContentTypes: VIDEO_TYPES, maximumSizeInBytes: Math.min(VIDEO_MAX_BYTES, bytes + 64 * 1024), addRandomSuffix: true,
        validUntil: Date.now() + 60 * 60 * 1000, tokenPayload: JSON.stringify({ token: p.token, reservation: rows[0].id }) };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => { // Vercel calls this when the upload finishes
      let t = {}; try { t = JSON.parse(tokenPayload || '{}'); } catch {}
      if (t.reservation) await query(`UPDATE blob_uploads SET status = 'stored', url = $2, completed_at = now() WHERE id = $1 AND deleted_at IS NULL`, [t.reservation, blob.url]);
    },
  });
  send(res, 200, result);
});
