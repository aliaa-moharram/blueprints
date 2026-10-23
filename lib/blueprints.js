import { parse } from 'node-html-parser';
// Blueprints are uploaded from the admin page and stored in the database.
import { query } from './db.js';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const ITEM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const MAX_BYTES = 4_000_000; // Vercel caps request and response bodies at 4.5 MB

// Admin display name from a page title: "Wise UAE Integration Blueprint - Prepared by Lean" -> "Wise".
// Titles that don't follow that pattern are used as they are.
export function deriveName(title) {
  const t = String(title || '').trim();
  return t.replace(/\s+([A-Z]{2,4}\s+)?Integration Blueprint[\s\S]*$/, '').trim() || t;
}
export const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');

// Checks an uploaded file and pulls out its title and checklist keys.
// Returns { title, items, size, problems: [] }.
// A copy made to work on its own (for example the GitHub Pages index.html) has the page script built in. The
// site adds its own, so the built-in one is removed on upload: otherwise the page would run it twice.
export function stripStandalone(html) {
  return String(html || '').replace(/[ \t]*<!-- leanbp-standalone[\s\S]*?-->\s*<script>window\.__LEAN_BP=[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>\n?/, '');
}

// A blueprint saved with the page script built in (the GitHub Pages copy, or a page saved from the browser):
// the site adds its own when it serves the page, so the built-in copy and its settings are removed on upload.
export function stripEmbeddedRuntime(html) {
  if (typeof html !== 'string') return html;
  return html
    .replace(/<!--\s*leanbp-standalone[\s\S]*?-->\s*/gi, '')
    .replace(/<script>\s*window\.__LEAN_BP\s*=[\s\S]*?<\/script>\s*/gi, '')
    .replace(/<script[^>]*src="[^"]*\/bp-runtime\.js"[^>]*>\s*<\/script>\s*/gi, '')
    .replace(/<script>\s*\/\/ Injected into every blueprint served from \/b\/<token>\.[\s\S]*?\}\)\(\);\s*<\/script>\s*/g, '');
}

export function inspectHtml(html) {
  const problems = [];
  const size = Buffer.byteLength(html || '', 'utf8');
  if (!html || !html.trim()) problems.push('The file is empty.');
  if (size > MAX_BYTES) problems.push(`The file is ${(size / 1e6).toFixed(1)} MB. Keep it under 4 MB by compressing or resizing embedded images.`);
  if (html && !/<\/body>/i.test(html)) problems.push('The file has no closing </body> tag. Upload a complete HTML page.');
  const titleMatch = html && html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  // Checklist steps are read from the page's actual elements, parsed as HTML: text inside scripts, styles,
  // templates or comments can never count as a step, whatever it contains.
  const root = html ? parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true, template: true } }) : null;
  const keys = root ? root.querySelectorAll('[data-check]').filter((el) => !el.closest('template')).map((el) => el.getAttribute('data-check') || '') : [];
  const bad = keys.filter((k) => !ITEM_RE.test(k));
  if (bad.length) problems.push(`These checklist keys aren't valid: ${bad.join(', ')}. Use lowercase letters, digits and hyphens.`);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dupes.length) problems.push(`These checklist keys appear more than once: ${dupes.join(', ')}. Each key must be unique.`);
  return { title, items: [...new Set(keys)], size, problems };
}

export async function loadBlueprint(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  const { rows } = await query('SELECT slug, title, coalesce(name, title) AS name, html, items FROM blueprints WHERE slug = $1 AND html IS NOT NULL', [slug]);
  return rows[0] || null;
}

// Metadata only (no HTML), for checklist validation and the admin page.
export async function loadMeta(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  const { rows } = await query('SELECT slug, title, coalesce(name, title) AS name, items, source, notify_email, html IS NOT NULL AS published FROM blueprints WHERE slug = $1', [slug]);
  return rows[0] || null;
}

// Returns the active link for a token, or null.
export async function findActiveLink(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const { rows } = await query(
    'SELECT token, slug, label, kind, environment, environment_changed_at, production_requested_at, production_request_note, production_requested_by, client_domains FROM links WHERE token = $1 AND revoked_at IS NULL',
    [token],
  );
  return rows[0] || null;
}
