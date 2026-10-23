// Small helpers that work both on Vercel's Node runtime and in dev/server.js.

export function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const url = new URL(req.url, 'http://local');
  return Object.fromEntries(url.searchParams.entries());
}

// Reads a JSON body. Accepts application/json and text/plain (navigator.sendBeacon).
export async function readJson(req, maxBytes = 64 * 1024) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    return parse(text);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  return parse(Buffer.concat(chunks).toString('utf8'));
}

function parse(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw httpError(400, 'Body must be JSON'); }
}

// extra: optional details added to the error response, for example { fields: { iban: '…' } }.
export function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) err.extra = extra;
  return err;
}

export function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string';
  res.statusCode = status;
  res.setHeader('Content-Type', isString ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(isString ? body : JSON.stringify(body));
}

// Wraps a handler: method check plus uniform error responses.
export function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        return send(res, 405, { error: 'Method not allowed' }, { Allow: methods.join(', ') });
      }
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, status >= 500 ? { error: 'Server error' } : { error: err.message, ...(err.extra || {}) });
    }
  };
}

export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = req.headers['x-forwarded-proto'] || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}
