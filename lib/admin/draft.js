// POST /api/admin/draft  { notes, clientName }  (admin)
// Asks Claude to draft blueprint content from meeting notes. Returns form content for review; saves nothing.
// Needs ANTHROPIC_API_KEY. ANTHROPIC_MODEL picks the model (default below).
import { handler, readJson, send, httpError } from '../http.js';
import { requireAdmin } from '../auth.js';
import { PRODUCTS } from '../products.js';

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const BASE = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const MAX_NOTES = 60_000;

const SYSTEM = `You draft content for Lean Technologies integration blueprints. Lean is a UAE open banking and payments company.
A blueprint maps a client's product experience to Lean products. You are given meeting notes and Lean's product library.

Rules:
- Use only facts stated in the notes. Never invent figures, volumes, dates, timelines, names, commitments or client features.
- If the notes don't say something, leave that field as an empty string or empty list. An empty field is better than a guess.
- Products must be ids from the library. Only include a product if the notes discuss it.
- A phase is "unconfirmed" when the notes say it is undecided, under discussion or not committed.
- Put anything important that the notes leave open into "openQuestions".
- Write plainly, in sentence case, without long dashes. Use **double asterisks** around a product name for bold where useful.

Reply with JSON only, no other text, in exactly this shape:
{
  "subtitle": "one sentence: what this blueprint maps for the client",
  "summary": "the opening paragraph",
  "market": "", "vertical": "",
  "painPoints": [{ "group": "business" | "technical", "pain": "", "solve": "", "advantage": "" }],
  "useCases": [""],
  "journeys": [{ "tag": "", "title": "", "feature": "", "need": "", "products": ["id"], "powers": "" }],
  "phases": [{ "label": "Phase 1", "title": "", "bullets": [""], "unconfirmed": false, "products": ["id"] }],
  "openQuestions": [""]
}`;

const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v, max = 20) => (Array.isArray(v) ? v.slice(0, max) : []);
const ids = new Set(PRODUCTS.map((p) => p.id));
const prods = (v) => [...new Set(arr(v).filter((id) => ids.has(id)))];

function parseReply(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw httpError(502, 'The draft came back in an unexpected format. Try again.');
  try { return JSON.parse(t.slice(start, end + 1)); } catch { throw httpError(502, 'The draft came back in an unexpected format. Try again.'); }
}

// Turns the model's reply into form content, keeping only what fits the form.
export function toContent(d, clientName) {
  const phases = arr(d.phases, 8).map((p, i) => ({
    label: str(p.label, 40) || `Phase ${i + 1}`, title: str(p.title, 80), chip: '',
    bullets: arr(p.bullets, 8).map((b) => str(b, 300)).filter(Boolean).join('\n'),
    unconfirmed: p.unconfirmed === true, products: prods(p.products),
  }));
  const assign = {};
  phases.forEach((p, i) => { for (const id of p.products) if (!assign[id]) assign[id] = { phase: i }; });
  return {
    client: { name: String(clientName || '').trim(), logo: '' }, header: { mode: 'name', logoSize: 'medium' }, theme: { mode: 'lean', color: '#3dd68c' },
    meta: { preparedBy: '', market: str(d.market, 40), vertical: str(d.vertical, 60) },
    hero: { subtitle: str(d.subtitle, 400) }, summary: str(d.summary, 1500),
    pain: { intro: '', rows: arr(d.painPoints, 10).map((r) => ({ group: r.group === 'technical' ? 'technical' : 'business', pain: str(r.pain), solve: str(r.solve), advantage: str(r.advantage) })).filter((r) => r.pain || r.solve) },
    journeys: { title: '', intro: '', useCases: arr(d.useCases, 8).map((u) => str(u, 40)).filter(Boolean),
      items: arr(d.journeys, 6).map((j) => ({ tag: str(j.tag, 60), title: str(j.title, 80), feature: str(j.feature), need: str(j.need), products: prods(j.products), otherProducts: '', powers: str(j.powers), alsoCovers: '', alsoImage: '', images: [], unconfirmed: false })).filter((j) => j.title || j.feature) },
    design: { enabled: false, title: '', subtitle: '', name: '', description: '', fileUrl: '', images: [], flows: [] },
    launch: { intro: '', phases: phases.map(({ products, ...p }) => ({ ...p, rows: [] })), assign, custom: [], products: [], note: '', totals: [], summary: '' },
    draftQuestions: arr(d.openQuestions, 15).map((q) => str(q, 300)).filter(Boolean),
    reviewNote: 'Drafted by Claude from meeting notes. Check every section against the notes, and add screenshots, effort and totals, before publishing.',
  };
}

export default handler(['POST'], async (req, res) => {
  requireAdmin(req);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(400, 'Drafting from notes isn’t switched on. Add ANTHROPIC_API_KEY in Vercel to use it.');
  const body = await readJson(req, MAX_NOTES * 4);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length < 40) throw httpError(400, 'Paste the meeting notes first. A few sentences at least.');
  if (notes.length > MAX_NOTES) throw httpError(400, 'Those notes are too long. Paste the most relevant part, under 60,000 characters.');
  const library = PRODUCTS.map((p) => ({ id: p.id, name: p.name, description: p.card }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 110_000);
  let r;
  try {
    r = await fetch(`${BASE()}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL(), max_tokens: 8000, system: SYSTEM,
        messages: [{ role: 'user', content: `Client: ${String(body.clientName || '').trim() || 'not given'}\n\nLean product library:\n${JSON.stringify(library, null, 1)}\n\nMeeting notes:\n<notes>\n${notes}\n</notes>` }],
      }),
    });
  } catch (err) {
    throw httpError(504, err.name === 'AbortError' ? 'The draft took too long. Try again with shorter notes.' : 'Couldn’t reach Claude. Try again.');
  } finally { clearTimeout(timer); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Draft request failed', r.status, data && data.error);
    throw httpError(502, r.status === 401 ? 'The ANTHROPIC_API_KEY in Vercel was rejected. Check it.' : 'Claude couldn’t draft this right now. Try again.');
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  send(res, 200, { content: toContent(parseReply(text), body.clientName) });
});
