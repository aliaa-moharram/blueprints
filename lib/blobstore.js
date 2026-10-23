// Recording storage on Vercel Blob, kept within the free plan's 1 GB. Every upload is recorded in blob_uploads,
// so usage is known without listing the store (listing counts as a paid operation).
import { del } from '@vercel/blob';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { query } from './db.js';
import { budgetBytes } from './prodrequest.js';

export const LOCAL_DIR = '/tmp/bp-uploads';

// The Blob store's token. Vercel names it BLOB_READ_WRITE_TOKEN, or <PREFIX>_READ_WRITE_TOKEN when a store is
// connected with a custom prefix, so any variable holding a Blob read-write token is used.
// Newer Blob connections give the project BLOB_STORE_ID (plus BLOB_WEBHOOK_PUBLIC_KEY) and authenticate with
// the deployment's own identity (OIDC) instead of a read-write token.
export function blobStoreId() {
  if (process.env.BLOB_STORE_ID) return process.env.BLOB_STORE_ID;
  const key = Object.keys(process.env).sort().find((k) => /(^|_)BLOB_STORE_ID$/.test(k) || /_STORE_ID$/.test(k) && /^store_/.test(process.env[k] || ''));
  return key ? process.env[key] : '';
}
// 'token' (a read-write token), 'oidc' (BLOB_STORE_ID), or '' when no store is connected.
export const blobMode = () => (blobToken() ? 'token' : blobStoreId() ? 'oidc' : '');
// Credentials for server calls (delete): a read-write token, or the store id, with the request's identity
// token when there is one (the SDK also finds it on its own on Vercel).
export function blobAuth(req) {
  if (blobToken()) return { token: blobToken() };
  const oidc = req && req.headers ? String(req.headers['x-vercel-oidc-token'] || '') : '';
  return { storeId: blobStoreId(), ...(oidc ? { oidcToken: oidc } : {}) };
}

export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).sort().find((k) => /READ_WRITE_TOKEN$/.test(k) && /^vercel_blob_rw_/.test(process.env[k] || ''));
  return key ? process.env[key] : '';
}
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
export async function deleteUpload(url, req) {
  if (!url) return;
  try {
    const u = new URL(url);
    if (process.env.UPLOAD_MODE === 'local' && u.pathname === '/api/upload') await unlink(path.join(LOCAL_DIR, path.basename(u.searchParams.get('file') || ''))).catch(() => {});
    else if (blobMode()) await del(url, blobAuth(req));
  } catch (err) { console.error('Recording not deleted:', err.message); }
  await query(`UPDATE blob_uploads SET status = 'deleted', deleted_at = now() WHERE url = $1 AND deleted_at IS NULL`, [url]);
  await query(`UPDATE production_requests SET video_deleted_at = now() WHERE video_url = $1 AND video_deleted_at IS NULL`, [url]);
}

// After a request is sent, any other recordings from that attempt are deleted.
export async function cleanupExcept(token, keepUrl, req) {
  const { rows } = await query(`SELECT url FROM blob_uploads WHERE token = $1 AND status = 'stored' AND deleted_at IS NULL AND url IS DISTINCT FROM $2`, [token, keepUrl || null]);
  for (const r of rows) await deleteUpload(r.url, req);
  return rows.length;
}
