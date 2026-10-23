// Version history: the published HTML (and, for form-built blueprints, the form content) is kept before every
// change that replaces it. The latest KEEP versions per blueprint are kept.
import { query } from './db.js';

export const KEEP = 20;

export async function saveVersion(slug, reason, by, db = { query }) {
  const { rows } = await db.query('SELECT html, draft, source, size_bytes FROM blueprints WHERE slug = $1 AND html IS NOT NULL', [slug]);
  if (!rows.length) return null;
  const r = rows[0];
  const ins = await db.query(
    `INSERT INTO blueprint_versions (slug, html, draft, source, size_bytes, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [slug, r.html, r.draft, r.source, r.size_bytes, reason, by || null]);
  await db.query(`DELETE FROM blueprint_versions WHERE slug = $1 AND id NOT IN (SELECT id FROM blueprint_versions WHERE slug = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`, [slug, KEEP]);
  return ins.rows[0].id;
}

export async function listVersions(slug) {
  const { rows } = await query('SELECT id, reason, source, size_bytes, created_by, created_at FROM blueprint_versions WHERE slug = $1 ORDER BY created_at DESC, id DESC', [slug]);
  return rows;
}

export async function getVersion(slug, id) {
  const { rows } = await query('SELECT * FROM blueprint_versions WHERE slug = $1 AND id = $2', [slug, Number(id) || 0]);
  return rows[0] || null;
}
