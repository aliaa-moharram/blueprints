// Admin auth: a shared password sent as "Authorization: Bearer <password>".
import { timingSafeEqual, createHash } from 'node:crypto';
import { httpError } from './http.js';

export function requireAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 12) throw httpError(500, 'ADMIN_PASSWORD is not set or too short');
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!given || !timingSafeEqual(a, b)) throw httpError(401, 'Wrong admin password');
}
