// Every /api/admin/* endpoint runs in this one serverless function (Vercel's Hobby plan allows 12 per deployment).
// vercel.json rewrites /api/admin/<route> to /api/admin?__route=<route>; the handlers themselves live in lib/admin/.
import blueprints from '../lib/admin/blueprints.js';
import builder from '../lib/admin/builder.js';
import draft from '../lib/admin/draft.js';
import download from '../lib/admin/download.js';
import versions from '../lib/admin/versions.js';
import links from '../lib/admin/links.js';
import overview from '../lib/admin/overview.js';
import products from '../lib/admin/products.js';
import recordings from '../lib/admin/recordings.js';
import progress from '../lib/admin/progress.js';
import verticals from '../lib/admin/verticals.js';
import view from '../lib/admin/view.js';

const ROUTES = { blueprints, builder, download, draft, links, overview, products, progress, recordings, verticals, versions, view };

export default async function admin(req, res) {
  const u = new URL(req.url, 'http://local');
  let route = u.searchParams.get('__route') || '';
  if (!route) { const m = u.pathname.match(/^\/api\/admin\/([a-z]+)\/?$/); route = m ? m[1] : ''; }
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, route) ? ROUTES[route] : null;
  if (!fn) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Not found' }));
  }
  // Hand the endpoint its own address and query, without the routing parameter.
  u.searchParams.delete('__route');
  req.url = `/api/admin/${route}${u.search}`;
  try { req.query = Object.fromEntries(u.searchParams.entries()); } catch { /* read-only on some runtimes: getQuery falls back to req.url */ }
  return fn(req, res);
}
