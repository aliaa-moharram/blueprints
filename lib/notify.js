// Optional Slack message when a client link is opened. Never throws.
export async function notifySlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('Slack notification failed:', err.message);
  } finally {
    clearTimeout(timer);
  }
}
