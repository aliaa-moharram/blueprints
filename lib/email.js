// Email through Resend's HTTP API (https://resend.com). Optional: without RESEND_API_KEY, nothing is sent.
// Until a sending domain is verified in Resend, it only delivers to the address on the Resend account.
export async function sendEmail({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!key || !recipients.length) return { sent: false, reason: key ? 'no recipient' : 'RESEND_API_KEY not set' };
  const from = process.env.EMAIL_FROM || 'Lean blueprints <onboarding@resend.dev>';
  try {
    const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error('Email not sent:', res.status, (await res.text()).slice(0, 300)); return { sent: false, reason: `HTTP ${res.status}` }; }
    return { sent: true };
  } catch (err) { console.error('Email not sent:', err.message); return { sent: false, reason: err.message }; }
}
