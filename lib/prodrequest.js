// The production access request: what the client team sends, and how it's checked.
// The same rules run in the page (bp-runtime.js) for instant feedback; the server is the authority.

// IBAN: letters and digits, 15 to 34 characters, valid ISO 13616 check digits (mod 97). UAE IBANs are 23 characters.
export function ibanOk(raw) {
  const iban = String(raw || '').replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return { ok: false, iban, error: 'Enter a full IBAN, for example AE07 0331 2345 6789 0123 456.' };
  if (iban.startsWith('AE') && iban.length !== 23) return { ok: false, iban, error: 'A UAE IBAN has 23 characters, starting with AE.' };
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) { const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) rem = (rem * 10 + Number(d)) % 97; }
  if (rem !== 1) return { ok: false, iban, error: 'This IBAN doesn’t check out. Check for a mistyped character.' };
  return { ok: true, iban };
}

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);

// Sized for Vercel's free plan: 1 GB of Blob storage in total, so each recording is capped at 100 MB and the
// total kept under a budget (BLOB_BUDGET_MB, default 900) with headroom below the cap.
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const budgetBytes = () => Math.max(50, Math.min(Number(process.env.BLOB_BUDGET_MB) || 900, 1000)) * 1024 * 1024;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo', 'video/mpeg'];
export const uploadPrefix = (token) => `production-requests/${token}/`;

// Returns { values } or { errors: { field: message } }.
export function checkRequest(input, token) {
  const errors = {};
  const values = {
    accountHolderName: text(input.accountHolderName, 140),
    tradeLicenseNumber: text(input.tradeLicenseNumber, 60),
    accountNumber: text(input.accountNumber, 40).replace(/[\s-]+/g, ''),
    bankAddress: text(input.bankAddress, 400),
    note: text(input.note, 1000),
    videoNa: input.videoNa === true,
    videoNaReason: text(input.videoNaReason, 500),
    video: null,
  };
  if (values.accountHolderName.length < 2) errors.accountHolderName = 'Enter the account holder’s name, as the bank has it.';
  if (values.tradeLicenseNumber.length < 3) errors.tradeLicenseNumber = 'Enter the trade licence number.';
  const ib = ibanOk(input.iban);
  values.iban = ib.iban;
  if (!ib.ok) errors.iban = ib.error;
  if (!/^[A-Z0-9]{4,34}$/i.test(values.accountNumber)) errors.accountNumber = 'Enter the account number: letters and digits only.';
  if (values.bankAddress.length < 5) errors.bankAddress = 'Enter the bank’s address.';
  if (values.videoNa) {
    if (values.videoNaReason.length < 3) errors.video = 'Say briefly why a recording doesn’t apply.';
  } else {
    const v = input.video || {};
    let url = null;
    try { url = new URL(String(v.url || '')); } catch {}
    const local = process.env.UPLOAD_MODE === 'local' && url && url.pathname === '/api/upload' && url.searchParams.get('file');
    const blob = url && url.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/.test(url.hostname) && decodeURIComponent(url.pathname).startsWith('/' + uploadPrefix(token));
    if (!url || !(blob || (local && url.searchParams.get('file').startsWith(token + '-')))) errors.video = 'Upload the recording, or tick Not applicable.';
    else values.video = { url: url.toString(), name: text(v.name, 200) || 'recording', bytes: Math.max(0, Math.min(Number(v.bytes) || 0, VIDEO_MAX_BYTES)) };
  }
  return Object.keys(errors).length ? { errors } : { values };
}

export const mask = (s, keep = 4) => { const t = String(s || ''); return t.length <= keep ? t : '•••• ' + t.slice(-keep); };
