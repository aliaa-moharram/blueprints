// Signed, short-lived "view as Lean" addresses for a client team's link.
// Opened from the admin page: shows the team's real progress, read only, not counted as a visit.
import { createHmac, timingSafeEqual } from 'node:crypto';

const HOURS = 2;
const key = () => process.env.ADMIN_PASSWORD || '';

function mac(token, exp) {
  return createHmac('sha256', key()).update(`view:${token}:${exp}`).digest('base64url');
}

export function makeViewParam(token) {
  const exp = Math.floor(Date.now() / 1000) + HOURS * 3600;
  return `${exp}.${mac(token, exp)}`;
}

// Returns "ok", "expired" or "invalid".
export function checkViewParam(token, value) {
  if (!key() || typeof value !== 'string') return 'invalid';
  const m = value.match(/^(\d{10})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return 'invalid';
  const expected = Buffer.from(mac(token, Number(m[1])));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  return Number(m[1]) < Date.now() / 1000 ? 'expired' : 'ok';
}
