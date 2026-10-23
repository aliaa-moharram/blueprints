import { createHmac, timingSafeEqual } from 'node:crypto';
// Who's viewing a client team's link, from the work email they entered (not verified).
// - a Lean domain                    -> 'lean'   (read only, never counted as the client team)
// - one of the link's client domains -> 'client' (can tick and request production, counted)
// - anything else                    -> 'other'  (read only, never counted)
// Until Lean sets a link's client domains, no email counts as the client team's, so nothing can be
// misattributed in the meantime.
const EMAIL_RE = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,40}$/;
export const DOMAIN_RE = /^(?=.{3,100}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function leanDomains() {
  return String(process.env.LEAN_EMAIL_DOMAINS || 'leantech.me').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}
const within = (domain, list) => list.some((d) => domain === d || domain.endsWith('.' + d));

export function nameFromEmail(email) {
  return email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 80);
}

export function classify(rawEmail, clientDomains) {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase().slice(0, 200) : '';
  if (!EMAIL_RE.test(email)) return { email: null, name: null, kind: null };
  const domain = email.split('@')[1];
  const kind = within(domain, leanDomains()) ? 'lean' : within(domain, clientDomains || []) ? 'client' : 'other';
  return { email, name: nameFromEmail(email), kind };
}

// Admin input ("wise.com, @transferwise.com") -> a clean list. Lean domains are refused.
export function parseDomains(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/))
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  const bad = list.filter((d) => !DOMAIN_RE.test(d));
  if (bad.length) return { error: `Not a domain: ${bad.join(', ')}` };
  const lean = list.filter((d) => within(d, leanDomains()));
  if (lean.length) return { error: `${lean.join(', ')} is a Lean domain, so it can’t be a client domain.` };
  return { domains: [...new Set(list)].slice(0, 10) };
}

// ---------- The viewer's identity, held by the server ----------
// A signed cookie (bp_viewer) set when someone enters their email, valid for a year on that browser, for every
// blueprint on the site. HttpOnly: the page can't read or change it. Signed: it can't be edited by hand.
const COOKIE = 'bp_viewer';
const sigKey = () => process.env.ADMIN_PASSWORD || '';
const sign = (email) => createHmac('sha256', sigKey()).update(`viewer:${email}`).digest('base64url');

export function viewerCookie(email, secure) {
  const v = `${Buffer.from(email).toString('base64url')}.${sign(email)}`;
  return `${COOKIE}=${v}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export function clearViewerCookie(secure) {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
// The email in a valid cookie, or null.
export function viewerFromRequest(req) {
  const raw = String((req.headers && req.headers.cookie) || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw || !sigKey()) return null;
  const [b64, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!b64 || !sig) return null;
  let email = ''; try { email = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  const want = Buffer.from(sign(email)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return EMAIL_RE.test(email) ? email : null;
}
// The identity for a write: the signed cookie when there is one, otherwise what the page sent.
export const viewerEmail = (req, body) => viewerFromRequest(req) || (body && body.viewer && body.viewer.email) || '';
export const isSecure = (req) => String(req.headers['x-forwarded-proto'] || '').includes('https');
