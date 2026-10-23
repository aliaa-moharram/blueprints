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
