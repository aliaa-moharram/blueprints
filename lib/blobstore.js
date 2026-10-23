// Recording storage on Vercel Blob, kept within the free plan's 1 GB. Every upload is recorded in blob_uploads,
// so usage is known without listing the store (listing counts as a paid operation).
import { del } from '@vercel/blob';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { query } from './db.js';
import { budgetBytes } from './prodrequest.js';

export const LOCAL_DIR = '/tmp/bp-uploads';
const RESERVATION_MINUTES = 60; // an upload token is valid for an hour

// Bytes stored, plus uploads reserved in the last hour that may still complete.
export async function usedBytes() {
  const { rows } = await query(
    `SELECT coalesce(sum(bytes), 0)::bigint AS used FROM blob_uploads
      WHERE deleted_at IS NULL AND (status = 'stored' OR (status = 'reserved' AND created_at > now() - make_interval(mins => $1)))`, [RESERVATION_MINUTES]);
  return Number(rows[0].used);
}

export async function usage() {
  return { usedBytes: await usedBytes(), budgetBytes: budgetBytes() };
}

// Deletes one stored recording, in Blob or (local mode) on disk, and marks it deleted.
export async function deleteUpload(url) {
  if (!url) return;
  try {
    const u = new URL(url);
    if (process.env.UPLOAD_MODE === 'local' && u.pathname === '/api/upload') await unlink(path.join(LOCAL_DIR, path.basename(u.searchParams.get('file') || ''))).catch(() => {});
    else if (process.env.BLOB_READ_WRITE_TOKEN) await del(url);
  } catch (err) { console.error('Recording not deleted:', err.message); }
  await query(`UPDATE blob_uploads SET status = 'deleted', deleted_at = now() WHERE url = $1 AND deleted_at IS NULL`, [url]);
  await query(`UPDATE production_requests SET video_deleted_at = now() WHERE video_url = $1 AND video_deleted_at IS NULL`, [url]);
}

// After a request is sent, any other recordings from that attempt are deleted.
export async function cleanupExcept(token, keepUrl) {
  const { rows } = await query(`SELECT url FROM blob_uploads WHERE token = $1 AND status = 'stored' AND deleted_at IS NULL AND url IS DISTINCT FROM $2`, [token, keepUrl || null]);
  for (const r of rows) await deleteUpload(r.url);
  return rows.length;
}
