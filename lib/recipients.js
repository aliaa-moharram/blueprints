// Who's emailed about a blueprint (production requests, review comments): its owner, plus anyone added under
// "Also notify". With neither, the site-wide NOTIFY_EMAIL.
const split = (v) => String(v || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
export function notifyList(bp) {
  const list = [...new Set([...split(bp && bp.owner_email), ...split(bp && bp.notify_email)])];
  return list.length ? list : split(process.env.NOTIFY_EMAIL);
}
