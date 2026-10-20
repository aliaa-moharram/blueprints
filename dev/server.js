// Local stand-in for Vercel: same rewrites as vercel.json, static files from public/ only.
// Usage: DATABASE_URL=... ADMIN_PASSWORD=... npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;
  const b = pathname.match(/^\/b\/([^/]+)$/);
  if (b) { pathname = '/api/b'; url.searchParams.set('token', b[1]); }
  if (pathname === '/admin') pathname = '/admin/index.html';

  if (pathname.startsWith('/api/')) {
    const file = path.join(root, pathname + '.js');
    if (!file.startsWith(path.join(root, 'api'))) return notFound(res);
    let mod;
    try { mod = await import(pathToFileURL(file).href); } catch { return notFound(res); }
    req.query = Object.fromEntries(url.searchParams.entries());
    return mod.default(req, res);
  }

  const file = path.join(root, 'public', pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(path.join(root, 'public'))) return notFound(res);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { notFound(res); }
}

function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }

http.createServer((req, res) => route(req, res).catch((e) => { console.error(e); res.writeHead(500); res.end(); }))
  .listen(PORT, () => console.log(`Lean blueprints running at http://localhost:${PORT}  (admin: /admin)`));
