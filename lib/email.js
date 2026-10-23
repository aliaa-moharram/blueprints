// Email through Resend's HTTP API (https://resend.com). Optional: without RESEND_API_KEY, nothing is sent.
// Until a sending domain is verified in Resend, it only delivers to the address on the Resend account.
export async function sendEmail({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!key || !recipients.length) {
    const reason = key ? 'no recipient (set Notify by email on the blueprint, or NOTIFY_EMAIL)' : 'RESEND_API_KEY is not set';
    console.warn(`Email not sent: ${reason}. Subject: ${subject}`);
    return { sent: false, reason };
  }
  const from = process.env.EMAIL_FROM || 'Lean blueprints <onboarding@resend.dev>';
  try {
    const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      // Until a sending domain is verified in Resend, it only delivers to the Resend account's own address.
      console.error(`Email not sent to ${recipients.join(', ')}: Resend said ${res.status} ${detail}`);
      return { sent: false, reason: `Resend ${res.status}: ${detail}` };
    }
    console.log(`Email sent to ${recipients.join(', ')}: ${subject}`);
    return { sent: true };
  } catch (err) { console.error('Email not sent:', err.message); return { sent: false, reason: err.message }; }
}
