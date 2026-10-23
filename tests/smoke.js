// End-to-end check against a real Postgres. Usage:
//   DATABASE_URL=postgres://... npm test
// Starts the dev server on a spare port, applies the schema and walks every flow.
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const ADMIN = 'test-admin-password-123';
const MOCK_PORT = 3998;
const env = { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: ADMIN, SLACK_WEBHOOK_URL: `http://localhost:3998/slack`,
  ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`, ANTHROPIC_MODEL: 'test-model' };
// Stand-in for the Claude API: records the request and replies with a canned draft.
const http = await import('node:http');
let lastClaudeRequest = null;
const slackMessages = [];
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  if (req.url === '/slack') { slackMessages.push(JSON.parse(body)); res.writeHead(200); return res.end('ok'); }
  lastClaudeRequest = { headers: req.headers, body: JSON.parse(body), url: req.url };
  const draft = { subtitle: 'How Nova maps to Lean.', summary: 'Nova wants pay-ins from UAE banks.', market: 'UAE', vertical: 'Wallet',
    painPoints: [{ group: 'business', pain: 'Card fees on top-ups.', solve: 'Lean **Pay by Bank**.', advantage: 'Lower costs.' }],
    useCases: ['Wallet top-up'], journeys: [{ tag: 'Funding', title: 'Top up', feature: 'Add money.', need: 'Pull AED.', products: ['otp', 'made-up-product'], powers: 'A Charge.' }],
    phases: [{ label: 'Phase 1', title: 'Pay-ins', bullets: ['Top-ups'], unconfirmed: false, products: ['otp', 'cmi'] }, { label: 'Phase 2', title: 'Payouts', bullets: [], unconfirmed: true, products: ['payouts'] }],
    openQuestions: ['Expected monthly volume?'] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(draft) + '\n```' }] }));
});
await new Promise((r) => mock.listen(MOCK_PORT, r));
const SLUG = 'sample-' + Date.now().toString(36);
const sample = await readFile(new URL('./sample-blueprint.html', import.meta.url), 'utf8');

execFileSync('node', ['scripts/migrate.js'], { env, stdio: 'inherit' });
const server = spawn('node', ['dev/server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.once('data', resolve));

const admin = (path, opts = {}) => fetch(BASE + path, {
  ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN, ...(opts.headers || {}) },
});
const upload = (body) => admin('/api/admin/blueprints', { method: 'POST', body: JSON.stringify(body) });
const json = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

try {
  // Access control
  assert.equal((await fetch(BASE + '/api/admin/overview')).status, 401); ok('admin API rejects missing password');
  assert.equal((await fetch(BASE + '/api/admin/overview', { headers: { Authorization: 'Bearer nope' } })).status, 401); ok('admin API rejects wrong password');
  assert.equal((await fetch(BASE + '/api/admin/blueprints', { method: 'POST', body: '{}' })).status, 401); ok('upload rejects missing password');
  assert.equal((await fetch(BASE + '/b/not-a-real-token-1234567890')).status, 404); ok('unknown link shows the "isn’t active" page');

  // Upload
  assert.equal((await upload({ slug: 'Bad Name', html: sample })).status, 400); ok('refuses a short name with spaces or capitals');
  assert.equal((await upload({ slug: SLUG, html: '<html><title>x</title>no body end' })).status, 400); ok('refuses a file without </body>');
  assert.equal((await upload({ slug: SLUG, html: sample.replace('<title>Sample Client Integration Blueprint</title>', '') })).status, 400); ok('refuses a file without a <title>');
  assert.equal((await upload({ slug: SLUG, html: sample.replace('sample-2', 'sample-1') })).status, 400); ok('refuses duplicate checklist keys');
  let r = await upload({ slug: SLUG, html: sample, uploadedBy: 'Smoke test' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).items, 3); ok('uploads a blueprint and finds its 3 checklist items');
  assert.equal((await upload({ slug: SLUG, html: sample })).status, 409); ok('will not overwrite an existing blueprint without "replace"');
  let named = (await (await admin('/api/admin/overview')).json()).blueprints.find((b) => b.slug === SLUG);
  assert.equal(named.name, 'Sample Client'); ok('an uploaded blueprint is named after the client, from its title');
  const N = 'named-' + Date.now().toString(36);
  await upload({ slug: N, html: sample, name: 'Northwind Pay' });
  named = (await (await admin('/api/admin/overview')).json()).blueprints.find((b) => b.slug === N);
  assert.equal(named.name, 'Northwind Pay'); ok('a name typed at upload is used');
  assert.equal((await admin('/api/admin/blueprints', { method: 'PATCH', body: JSON.stringify({ slug: N, name: 'Northwind' }) })).status, 200);
  await upload({ slug: N, html: sample.replace('Sample Client Integration', 'Other Integration'), replace: true });
  named = (await (await admin('/api/admin/overview')).json()).blueprints.find((b) => b.slug === N);
  assert.equal(named.name, 'Northwind'); ok('renaming works, and replacing the file keeps the name');

  // Links
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Test client', kind: 'client', createdBy: 'Smoke test' }) });
  assert.equal(r.status, 201);
  const client = await r.json();
  assert.match(client.url, /\/b\/[A-Za-z0-9_-]{24}$/); ok('creates a client link with a 24-character token');
  assert.equal((await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: 'does-not-exist', label: 'x' }) })).status, 400); ok('refuses a link to a blueprint that does not exist');
  assert.equal((await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: '  ' }) })).status, 400); ok('refuses a link without a label');

  // Serve
  r = await fetch(`${BASE}/b/${client.token}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('window.__LEAN_BP=') && html.includes('/bp-runtime.js')); ok('serves the blueprint with the runtime injected');
  assert.ok(html.includes('noindex')); ok('adds noindex');
  assert.equal(r.headers.get('cache-control'), 'private, no-store'); ok('blueprint responses are not cached');

  // Visits
  const session = 'smoke-' + Date.now();
  assert.equal((await json('/api/track', { token: client.token, session, event: 'open' })).status, 200);
  assert.equal((await json('/api/track', { token: client.token, session, event: 'open' })).status, 200);
  assert.equal((await json('/api/track', { token: client.token, session, event: 'beat', seconds: 30 })).status, 200);
  r = await fetch(BASE + '/api/track', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: client.token, session, event: 'leave', seconds: 999 }) });
  assert.equal(r.status, 200); ok('accepts sendBeacon-style text/plain bodies');
  assert.equal((await json('/api/track', { token: client.token, session: 'x', event: 'open' })).status, 400); ok('rejects a malformed session id');
  let ov = await (await admin('/api/admin/overview')).json();
  const row = ov.links.find((l) => l.token === client.token);
  assert.equal(row.views, 1); ok('a repeated "open" for one page load counts once');
  assert.equal(row.seconds, 10 + 30 + 120); ok('visible time adds up, capped at 120 s per update');

  // Who's viewing (one client link, Lean colleagues told apart by email)
  const before = slackMessages.length;
  await json('/api/track', { token: client.token, session: 'viewer-wise-0001', event: 'open', viewer: { email: '  David.Vu@Wise.com ' } });
  await json('/api/track', { token: client.token, session: 'viewer-lean-0001', event: 'open', viewer: { email: 'will.smith@leantech.me', kind: 'client' } });
  await json('/api/track', { token: client.token, session: 'viewer-bad-00001', event: 'open', viewer: { email: 'not-an-email' } });
  ov = await (await admin('/api/admin/overview')).json();
  const vrow = ov.links.find((l) => l.token === client.token);
  assert.equal(vrow.views, 3); ok('a Lean colleague’s visit on the client link doesn’t count as the client team’s');
  const people = Object.fromEntries(vrow.people.map((x) => [x.email, x]));
  assert.ok(people['david.vu@wise.com'] && people['david.vu@wise.com'].kind === 'client' && people['david.vu@wise.com'].name === 'David Vu'); ok('a client viewer is recorded by name, worked out from their email');
  assert.ok(people['will.smith@leantech.me'] && people['will.smith@leantech.me'].kind === 'lean'); ok('a Lean email is recorded as Lean, decided by the server whatever the page says');
  assert.ok(!vrow.people.some((x) => x.email === 'not-an-email')); ok('an invalid email is ignored');
  const namedVisit = ov.recent.find((v) => v.viewer_name === 'Will Smith');
  assert.ok(namedVisit && namedVisit.viewer_kind === 'lean'); ok('recent visits show who viewed');
  const alerts = slackMessages.slice(before).map((m) => m.text);
  assert.ok(!alerts.some((t) => /Will Smith/.test(t))); ok('a Lean colleague opening the client link never triggers the first-view alert');
  const page0 = await (await fetch(`${BASE}/b/${client.token}`)).text();
  assert.ok(/"kind":"client"/.test(page0) && /"leanDomains":\["leantech\.me"\]/.test(page0)); ok('the page knows it’s a client link and which domains are Lean');

  // Checklist
  r = await json('/api/checklist', { token: client.token, item: 'sample-1', done: true });
  assert.equal((await r.json()).done, true); ok('a client team can tick an item');
  await json('/api/checklist', { token: client.token, item: 'sample-3', done: true });
  const state = await (await fetch(`${BASE}/api/checklist?token=${client.token}`)).json();
  assert.equal(state.items['sample-1'].done, true); ok('ticks persist and read back');
  assert.equal((await json('/api/checklist', { token: client.token, item: 'made-up', done: true })).status, 400); ok('refuses items that are not in the blueprint');
  ov = await (await admin('/api/admin/overview')).json();
  assert.equal(ov.links.find((l) => l.token === client.token).done, 2); ok('admin overview shows each team’s checklist progress');

  // One link per team, state per team, Lean links read only
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'test CLIENT', kind: 'client' }) });
  const again = await r.json();
  assert.equal(r.status, 200); assert.equal(again.existing, true); assert.equal(again.token, client.token); ok('a team that already has a link gets the same link back');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Second team', kind: 'client' }) });
  assert.equal(r.status, 409); ok('a blueprint has one client team: a second client team is refused');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: N, label: 'Second team', kind: 'client' }) });
  const team2 = await r.json();
  assert.notEqual(team2.token, client.token);
  let t2 = await (await fetch(`${BASE}/api/checklist?token=${team2.token}`)).json();
  assert.equal(t2.mode, 'edit'); assert.deepEqual(t2.items, {}); ok('a new client team starts with an empty checklist');
  await json('/api/checklist', { token: team2.token, item: 'sample-2', done: true });
  const t1 = await (await fetch(`${BASE}/api/checklist?token=${client.token}`)).json();
  assert.equal(t1.items['sample-2'], undefined); ok('one client’s ticks never show on another blueprint’s team link');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Lean', kind: 'internal' }) });
  const lean = await r.json();
  assert.equal((await json('/api/checklist', { token: lean.token, item: 'sample-1', done: false })).status, 403); ok('a Lean team link cannot tick');
  const lv = await (await fetch(`${BASE}/api/checklist?token=${lean.token}`)).json();
  assert.equal(lv.mode, 'view');
  assert.deepEqual(lv.teams.map((t) => t.name), ['Test client']);
  assert.equal(lv.teams[0].items['sample-1'].done, true); ok('a Lean team link sees each client team’s progress');
  assert.ok(!JSON.stringify(lv).includes(client.token) && !JSON.stringify(lv).includes(team2.token)); ok('the Lean view never reveals client team links');
  const leanN = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: N, label: 'Lean N', kind: 'internal' }) })).json();
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: team2.token, revoked: true }) });
  const lv2 = await (await fetch(`${BASE}/api/checklist?token=${leanN.token}`)).json();
  assert.deepEqual(lv2.teams, []); ok('revoked teams drop out of the Lean view');
  const team3n = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: N, label: 'Replacement team', kind: 'client' }) })).json();
  assert.ok(team3n.token); ok('after revoking the client team, a new one can be created');
  assert.equal((await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: team2.token, revoked: false }) })).status, 409); ok('restoring an old client team is refused while another is active');

  // Replace the file: keeps ticks for keys that remain, reports the ones that went
  const v2 = sample.replace('<li data-check="sample-3">Listen for payment webhooks.</li>', '').replace('Sample Client', 'Sample Client v2');
  r = await upload({ slug: SLUG, html: v2, uploadedBy: 'Smoke test', replace: true });
  assert.equal(r.status, 200);
  const rep = await r.json();
  assert.deepEqual(rep.droppedTicks, ['sample-3']); ok('replacing a file reports ticks whose items were removed');
  const after = await (await fetch(`${BASE}/api/checklist?token=${client.token}`)).json();
  assert.equal(after.items['sample-1'].done, true); assert.equal(after.items['sample-3'], undefined); ok('ticks survive a replace for items still in the file');
  assert.ok((await (await fetch(`${BASE}/b/${client.token}`)).text()).includes('Sample Client v2')); ok('existing links show the replaced file straight away');

  // Revoke and restore
  assert.equal((await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: client.token, revoked: true }) })).status, 200);
  assert.equal((await fetch(`${BASE}/b/${client.token}`)).status, 404); ok('a revoked link stops working');
  assert.equal((await json('/api/checklist', { token: client.token, item: 'sample-1', done: false })).status, 404); ok('a revoked link cannot change the checklist');
  assert.equal((await json('/api/track', { token: client.token, session: session + 'b', event: 'open' })).status, 404); ok('a revoked link cannot record visits');
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: client.token, revoked: false }) });
  assert.equal((await fetch(`${BASE}/b/${client.token}`)).status, 200); ok('a restored link works again');

  // Builder: start in the form, save, preview, publish
  const B = 'built-' + Date.now().toString(36);
  const builder = (body) => admin('/api/admin/builder', { method: 'POST', body: JSON.stringify(body) });
  const content = {
    client: { name: 'Acme Remit', logo: '' }, header: { mode: 'name' }, theme: { mode: 'client', color: '#e60000' },
    meta: { preparedBy: 'Smoke test', market: 'UAE', vertical: 'Remittance' }, hero: { subtitle: 'How **Acme** maps to Lean.' }, summary: 'Summary.',
    pain: { intro: '', rows: [{ group: 'business', pain: 'Card fees.', solve: 'Lean **Pay by Bank**.', advantage: 'Lower costs.' }] },
    journeys: { title: '', intro: '', useCases: ['Wallet top-up'], items: [{ tag: 'Funding', title: 'Top up', feature: 'Add money.', need: 'Pull AED.', products: ['otp'], powers: 'A Charge.', images: [] }] },
    design: { enabled: false },
    launch: { products: [{ product: 'otp', status: 'scope' }, { product: 'custom', status: 'future', custom: { name: 'Reconciliation' }, card: 'Match payments.' }],
      phases: [{ label: 'Phase 1', title: 'Funding', bullets: 'Pay-ins', rows: [{ product: 'otp' }, { product: 'cmi' }, { product: 'custom', custom: { name: 'Reconciliation', sub: 'daily', apis: 'GET /recon' } }] }],
      totals: [{ label: 'Phase 1', value: '~1-2 weeks' }], summary: 'Committed: **Phase 1**.' },
  };
  assert.equal((await builder({ action: 'create', slug: B, content: { ...content, client: { name: ' ' } } })).status, 400); ok('form blueprint needs a client name');
  r = await builder({ action: 'create', slug: B, content, by: 'Smoke test' });
  assert.equal(r.status, 201); ok('starts a blueprint from the form');
  assert.equal((await builder({ action: 'create', slug: B, content })).status, 409); ok('will not start a second blueprint with the same short name');
  assert.equal((await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: B, label: 'Too early' }) })).status, 400); ok('refuses a link before the blueprint is published');
  r = await builder({ action: 'preview', content });
  const pv = (await r.json()).html;
  assert.ok(pv.includes('Acme Remit') && pv.includes('<b>Pay by Bank</b>') && pv.includes('openPanel(\'otp\')')); ok('preview renders content, bold text and the guide button');
  assert.ok(pv.includes('--bright:#e60000') && pv.includes('--on-bright:#ffffff')); ok('client colour applied, with white text on a dark accent');
  const rt = await (await fetch(`${BASE}/bp-runtime.js`)).text();
  assert.ok(rt.includes('bp-rowbar') && rt.includes('function paintGuides') && rt.includes('bp-guidebar')); ok('the page script draws progress bars on guide rows and in guide headers');
  assert.ok(pv.includes('<script>window.__LEAN_BP={"local":true};</script>') && pv.includes('/bp-runtime.js"></script>') && !/"token"/.test(pv)); ok('previews load checkboxes and progress in local mode, with no link and no tracking');
  assert.equal((pv.match(/data-check="otp-/g) || []).length, 6); ok('guide checklist items get stable keys');
  assert.ok(pv.includes('Reconciliation') && pv.includes('GET /recon')); ok('custom products render in cards and table');
  assert.ok(pv.includes('<span class="client-name">Acme Remit</span>')); ok('name-only header shows the client name');
  assert.ok(pv.includes('<div class="phase" data-panels="otp e2e">')); ok('phase cards list their guide checklists for phase progress');
  assert.ok(!/footer \.row2\{[^}]*border-top/.test(pv)); ok('the footer has a single divider');
  assert.ok(!pv.includes('Prepared by Lean for') && pv.includes('Confidential, for discussion')); ok('the footer has no “Prepared by Lean for” line');
  r = await builder({ action: 'save', slug: B, content: { ...content, summary: 'Saved draft.' } });
  assert.equal(r.status, 200); ok('saves a draft');
  r = await builder({ action: 'publish', slug: B, content, by: 'Smoke test' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).published, true); ok('publishes');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: B, label: 'Acme client', kind: 'client' }) });
  assert.equal(r.status, 201);
  const built = await r.json();
  let page = await (await fetch(`${BASE}/b/${built.token}`)).text();
  assert.ok(page.includes('Acme Remit') && page.includes('window.__LEAN_BP=')); ok('a published form blueprint is served through its link with tracking');
  ov = await (await admin('/api/admin/overview')).json();
  const builtBp = ov.blueprints.find((b) => b.slug === B);
  const doneBefore = ov.links.find((l) => l.token === built.token).done;
  r = await json('/api/checklist', { token: built.token, item: 'dev-prod-1', done: true });
  assert.equal(r.status, 200); ok('production steps can be ticked');
  ov = await (await admin('/api/admin/overview')).json();
  assert.equal(ov.links.find((l) => l.token === built.token).done, doneBefore); ok('a production tick isn’t counted in progress');
  const builtItems = (await (await admin(`/api/admin/progress?slug=${B}`)).json()).structure.panels;
  const allKeys = Object.values(builtItems).flatMap((p) => p.items.map((i) => i.key));
  assert.equal(builtBp.items, allKeys.filter((k) => !k.includes('-prod-')).length); ok('the item total leaves production steps out');
  let envr = await (await fetch(`${BASE}/api/checklist?token=${built.token}`)).json();
  assert.equal(envr.environment, 'sandbox'); ok('a client team starts in Sandbox');
  r = await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: built.token, environment: 'live' }) });
  assert.equal(r.status, 400); ok('only sandbox or production can be set');
  r = await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: built.token, environment: 'production' }) });
  assert.equal(r.status, 200); envr = await (await fetch(`${BASE}/api/checklist?token=${built.token}`)).json();
  assert.equal(envr.environment, 'production'); ok('Lean sets the team to production, and the page is told');
  r = await fetch(`${BASE}/api/admin/links`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: built.token, environment: 'sandbox' }) });
  assert.equal(r.status, 401); ok('only Lean can change the environment');
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: built.token, environment: 'sandbox' }) });
  // Requesting production access
  const prodReq = (body) => fetch(`${BASE}/api/production`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  r = await prodReq({ token: built.token, note: '  Target go-live 1 Dec \u0007 ' });
  let pj = await r.json();
  assert.equal(r.status, 200); assert.ok(pj.requestedAt); assert.equal(pj.note, 'Target go-live 1 Dec'); ok('a client team can request production access, with an optional note');
  const sm = slackMessages.find((m) => /requested production access/.test(m.text));
  assert.ok(sm && /Sandbox setup: \d+ of \d+/.test(sm.text) && /End-to-end test: \d+ of \d+/.test(sm.text) && sm.text.includes('Target go-live 1 Dec') && sm.text.includes('/admin')); ok('Lean is notified in Slack, with readiness from the server, the note and a link to the admin page');
  r = await prodReq({ token: built.token, note: 'again' }); pj = await r.json();
  assert.equal(r.status, 200); assert.ok(pj.alreadyRequested && pj.note === 'Target go-live 1 Dec'); assert.equal(slackMessages.filter((m) => /requested production access/.test(m.text)).length, 1); ok('asking twice is harmless and doesn’t notify again');
  envr = await (await fetch(`${BASE}/api/checklist?token=${built.token}`)).json();
  assert.ok(envr.production.requestedAt && !envr.production.grantedAt); ok('the page is told the request is waiting');
  ov = await (await admin('/api/admin/overview')).json();
  assert.ok(ov.links.find((l) => l.token === built.token).production_requested_at); ok('the admin page lists the request');
  r = await prodReq({ token: 'nope' }); assert.equal(r.status, 404); ok('unknown links can’t request');
  r = await prodReq({ token: lean.token }); assert.equal(r.status, 403); ok('Lean team links can’t request production access');
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: built.token, environment: 'production' }) });
  envr = await (await fetch(`${BASE}/api/checklist?token=${built.token}`)).json();
  assert.ok(envr.production.grantedAt); ok('setting the team to Production grants it, and the page is told');
  r = await prodReq({ token: built.token }); assert.equal(r.status, 409); ok('a team already in production can’t request again');
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: built.token, environment: 'sandbox' }) });
  const rtJ = await (await fetch(`${BASE}/bp-runtime.js`)).text();
  assert.ok(rtJ.includes('Your path to production') && rtJ.includes('Request production access') && rtJ.includes('Request anyway') && rtJ.includes("aria-current=\"step\"")); ok('the page shows the path to production, with the request button');
  r = await json('/api/checklist', { token: built.token, item: 'otp-2', done: true });
  assert.equal((await json('/api/checklist', { token: built.token, item: 'otp-2', done: true })).status, 200);
  assert.equal(r.status, 200); ok('its guide checklist ticks save');
  await builder({ action: 'save', slug: B, content: { ...content, summary: 'Unpublished edit.' } });
  page = await (await fetch(`${BASE}/b/${built.token}`)).text();
  assert.ok(!page.includes('Unpublished edit.')); ok('clients keep seeing the published version while a draft is edited');
  ov = await (await admin('/api/admin/overview')).json();
  assert.equal(ov.blueprints.find((b) => b.slug === B).unpublished_changes, true); ok('admin shows unpublished changes');
  assert.equal((await upload({ slug: B, html: sample, replace: true })).status, 409); ok('a form blueprint cannot be overwritten by a file upload');
  assert.equal(ov.blueprints.find((b) => b.slug === B).name, 'Acme Remit'); ok('a form blueprint is named after the client name in Basics');
  assert.equal((await admin('/api/admin/blueprints', { method: 'PATCH', body: JSON.stringify({ slug: B, name: 'Other' }) })).status, 409); ok('a form blueprint is renamed through Basics, not Rename');
  assert.equal((await admin('/api/admin/products')).status, 200); ok('product library loads');

  // Lean "View progress": a client team's real page, read only, never counted as a visit
  assert.equal((await fetch(BASE + '/api/admin/view', { method: 'POST', body: JSON.stringify({ token: client.token }) })).status, 401); ok('view addresses need the admin password');
  r = await admin('/api/admin/view', { method: 'POST', body: JSON.stringify({ token: client.token }) });
  const viewUrl = (await r.json()).url;
  const viewParam = new URL(viewUrl).searchParams.get('view');
  assert.match(viewUrl, new RegExp(`/b/${client.token}\\?view=\\d{10}\\.`)); ok('creates a signed, expiring view address for a client team');
  const vpage = await (await fetch(viewUrl)).text();
  assert.ok(vpage.includes('"view":"' + viewParam + '"') && vpage.includes('"team":"Test client"')); ok('the view page loads in Lean view mode');
  const vstate = await (await fetch(`${BASE}/api/checklist?token=${client.token}&view=${encodeURIComponent(viewParam)}`)).json();
  assert.equal(vstate.mode, 'view'); assert.equal(vstate.teams[0].items['sample-1'].done, true); ok('the view shows the team’s real ticks');
  assert.equal((await json('/api/checklist', { token: client.token, item: 'sample-1', done: false, view: viewParam })).status, 403); ok('a Lean view cannot tick');
  const viewsBefore = (await (await admin('/api/admin/overview')).json()).links.find((l) => l.token === client.token).views;
  await json('/api/track', { token: client.token, session: 'view-sess-' + Date.now(), event: 'open', view: viewParam });
  const viewsAfter = (await (await admin('/api/admin/overview')).json()).links.find((l) => l.token === client.token).views;
  assert.equal(viewsAfter, viewsBefore); ok('a Lean view is never counted as a visit');
  const forged = viewParam.slice(0, -2) + (viewParam.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await fetch(`${BASE}/b/${client.token}?view=${forged}`)).status, 403); ok('a tampered view address shows the expired page, not the client’s page');
  assert.equal((await fetch(`${BASE}/b/${team3n.token}?view=${viewParam}`)).status, 403); ok('a view address only works for the team it was made for');
  const { createHmac } = await import('node:crypto');
  const past = Math.floor(Date.now() / 1000) - 60;
  const expired = past + '.' + createHmac('sha256', ADMIN).update(`view:${client.token}:${past}`).digest('base64url');
  const ex = await fetch(`${BASE}/b/${client.token}?view=${expired}`);
  assert.equal(ex.status, 403); assert.ok((await ex.text()).includes('This view has expired')); ok('an expired view address explains how to open a new one');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Lean again', kind: 'internal' }) });
  assert.equal((await admin('/api/admin/view', { method: 'POST', body: JSON.stringify({ token: (await r.json()).token }) })).status, 400); ok('view progress is only offered for client team links');

  // Progress breakdown for the admin page
  assert.equal((await fetch(`${BASE}/api/admin/progress?slug=${SLUG}`)).status, 401); ok('the progress breakdown needs the admin password');
  let pgr = await (await admin(`/api/admin/progress?slug=${SLUG}`)).json();
  assert.deepEqual(pgr.structure.loose.map((i) => i.key), ['sample-1', 'sample-2']); ok('lists checklist items for a file without phases');
  const tc = pgr.teams.find((t) => t.label === 'Test client');
  assert.equal(tc.items['sample-1'].done, true); ok('shows each client team’s ticks');
  assert.ok(!pgr.teams.some((t) => t.label === 'Second team')); ok('revoked teams are left out of the breakdown');
  pgr = await (await admin(`/api/admin/progress?slug=${B}`)).json();
  assert.equal(pgr.structure.phases[0].label, 'Phase 0'); assert.deepEqual(pgr.structure.phases[0].panels, ['dev', 'start', 'wh']); assert.equal(pgr.structure.phases[1].label, 'Phase 1'); assert.deepEqual(pgr.structure.phases[1].panels, ['otp', 'e2e']);
  assert.equal(pgr.structure.panels.otp.items.length, 6); assert.equal(pgr.structure.panels.otp.name, 'One-Time Payments'); ok('a form blueprint’s phases and guides are read on publish');
  assert.equal(pgr.teams[0].items['otp-2'].done, true); ok('the breakdown shows ticks per guide item');
  assert.equal((await admin('/api/admin/progress?slug=no-such-blueprint')).status, 404); ok('the breakdown reports a missing blueprint');

  // Templates, copies, plans from product choices, edit mode
  const T = 'tpl-' + Date.now().toString(36);
  r = await builder({ action: 'create', slug: T, template: 'standard', vertical: 'remittance', clientName: 'Nova Pay', by: 'Smoke test' });
  assert.equal(r.status, 201);
  const trow = await (await admin(`/api/admin/builder?slug=${T}`)).json();
  assert.equal(trow.draft.client.name, 'Nova Pay'); assert.ok(!JSON.stringify(trow.draft).includes('{client}')); const { reviewNote: _rn, ...tcontent } = trow.draft; assert.ok(!JSON.stringify(tcontent).includes('Wise')); ok('a template fills in the client name and its content contains nothing about Wise');
  assert.ok(/template/i.test(trow.draft.reviewNote)); ok('a blueprint started from a template carries a review note');
  assert.equal(trow.draft.pain.rows.length, 5); assert.equal(trow.draft.meta.vertical, 'Remittance'); assert.ok(trow.draft.journeys.useCases.includes('Wallet top-up')); ok('the Remittance vertical brings its pain points and use cases');
  const tpv = (await (await builder({ action: 'preview', content: trow.draft })).json()).html;
  assert.ok(tpv.includes('Nova Pay') && tpv.includes('Verified pay-ins') && tpv.includes("openPanel('otp')")); ok('the template renders a full launch plan');
  assert.equal((await builder({ action: 'create', slug: T + 'x', template: 'nope', clientName: 'X' })).status, 400); ok('an unknown template is refused');
  r = await builder({ action: 'create', slug: T + '-copy', copyFrom: B, clientName: 'Copy Co' });
  assert.equal(r.status, 201);
  const crow = await (await admin(`/api/admin/builder?slug=${T}-copy`)).json();
  assert.equal(crow.draft.client.name, 'Copy Co'); assert.equal(crow.draft.client.logo, ''); assert.ok(crow.draft.journeys.items.every((x) => !x.images.length)); assert.ok(/Copied/.test(crow.draft.reviewNote)); ok('a copy keeps the content but drops the other client’s logo and screenshots');
  const planned = { client: { name: 'Plan Co' }, launch: { phases: [{ label: 'Phase 1', title: 'Pay-ins', bullets: 'Top-ups' }, { label: 'Later', title: 'Payouts', unconfirmed: true }],
    assign: { otp: { phase: 0, effort: '~3 days' }, payouts: { phase: 1 }, cmi: { phase: 0 } }, custom: [{ name: 'Reconciliation', apis: 'GET /recon', phase: 0, showCard: true }] } };
  const ppv = (await (await builder({ action: 'preview', content: planned })).json()).html;
  assert.ok(ppv.includes('~3 days') && ppv.includes('POST /payouts/v1/payment') && ppv.includes('GET /recon')); ok('picking products and phases builds the table, with endpoints and effort');
  assert.ok(/<span class="ext">Future<\/span><h3>Payouts<\/h3>/.test(ppv) && /<span class="core">In scope<\/span><h3>One-Time Payments<\/h3>/.test(ppv)); ok('products in an unconfirmed phase show as Future, others as In scope');
  assert.ok(!/<h3>Consent Management Interface<\/h3>/.test(ppv)); ok('products without a card by default (CMI) only appear in the table');
  const excluded = (await (await builder({ action: 'preview', content: { ...planned, launch: { ...planned.launch, assign: { ...planned.launch.assign, payouts: { phase: -1, showCard: true } } } } })).json()).html;
  assert.ok(!/<span class="(?:ext|core)">[^<]*<\/span><h3>Payouts<\/h3>/.test(excluded) && !excluded.includes('POST /payouts/v1/payment')); ok('a product set to Not included has no card and no table row');
  const epv = (await (await builder({ action: 'preview', content: planned, edit: true })).json()).html;
  assert.ok(epv.includes('data-edit="launch.phases.0.title"') && epv.includes('data-edit="launch.assign.otp.effort"') && epv.includes("type: 'lb-edit'")); ok('edit mode marks text with its form field');
  assert.ok(!ppv.includes('data-edit=')); ok('normal pages carry no edit marks');
  assert.ok(ppv.includes('<a class="apilink" href="https://docs.leantech.me/v4.0-GLOBAL/reference/createpaymentcharge"')); ok('endpoints in the table link to the API reference');
  assert.ok(/<div class="sp-codes"><a class="apilink" href="[^"]+getpaymentcharge"/.test(ppv) || ppv.includes('reference/getpaymentcharge')); ok('endpoints in the guides link to the API reference');
  assert.ok(ppv.includes('<code>Hosted authentication (redirect)</code>') && !ppv.includes('>Hosted authentication (redirect)</code></a>')); ok('items that aren’t endpoints stay plain');
  assert.ok(ppv.includes('Phase 0 · Setup</td>') && ppv.includes('reference/postoauth2token')); ok('Phase 0 covers the access token');
  assert.ok(!/reference\/(createcustomer|getbanks|getevents)/.test(ppv) && !ppv.includes('Core resources')); ok('no Create Customer, List Banks or Get all Events: no step needs them');
  assert.ok(ppv.indexOf('Phase 0 · Setup</td>') < ppv.indexOf('Phase 1 &middot;')); ok('Phase 0 · Setup comes first in the table');
  assert.ok(ppv.indexOf('<td>Developer portal setup') < ppv.indexOf('<td>Authentication') && ppv.indexOf('<td>Authentication') < ppv.indexOf('<td>Webhooks')); ok('Phase 0 lists Developer portal setup, Authentication, then Webhooks');
  assert.ok(ppv.includes(`openPanel('dev')`) && ['dev-1', 'dev-4', 'dev-prod-1', 'dev-prod-3'].every((k) => ppv.includes(`data-check="${k}"`))); ok('Developer portal setup has its own guide, with sandbox and production steps');
  assert.ok(ppv.includes('href="https://dev.leantech.me/"') && /your sandbox <span class="term"/.test(ppv) && ppv.includes('production</b> application ID')); ok('the guide covers the dev portal, the sandbox app token and the production one');
  assert.ok(ppv.indexOf('id="panel-dev"') < ppv.indexOf('id="panel-start"')); ok('the setup guides come in order: portal setup, then getting started');
  assert.ok(['dev-5', 'dev-6', 'dev-7', 'dev-8', 'dev-9', 'dev-10'].every((k) => ppv.includes(`data-check="${k}"`)) && /client secret/.test(ppv) && /with the HTTPS endpoint where your backend receives events/.test(ppv) && /redirect URLs/.test(ppv) && /enable Open Finance/.test(ppv) && /purpose statement and the benefit/.test(ppv)); ok('portal setup covers client secret, webhooks, redirect URLs, Open Finance and consent copy');
  const devPanel = ppv.slice(ppv.indexOf('id="panel-dev"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-dev"')));
  const authP = ppv.slice(ppv.indexOf('id="panel-start"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-start"')));
  assert.ok(!devPanel.includes('Settlement Account') && !devPanel.includes('Add Account')); ok('portal setup no longer creates the Settlement Account: it’s an API call now');
  assert.ok(/data-check="start-4">Create your <span class="term"[^>]*>Settlement Account/.test(authP) && authP.includes('POST /payments/v1/destinations') && authP.includes('TRADE_LICENSE_NUMBER') && authP.includes('reference/createpaymentdestination')); ok('Authentication creates the Settlement Account with POST /payments/v1/destinations, with its fields and reference');
  assert.ok(/data-check="start-prod-1">Create your production Settlement Account/.test(authP)); ok('production includes its own Settlement Account, by API');
  assert.ok(/Lean creates a <span class="term"[^>]*>Payment Instrument/.test(ppv) && ppv.includes('Lean creates one when the customer selects the account to pay with')); ok('guides say Lean creates a Payment Instrument when the customer selects an account, with a definition');
  assert.ok(ppv.includes('Also in the dev portal') && ppv.includes('consumption and billing') && ppv.includes('docs/configuring-your-application')); ok('the guide lists what the dev portal shows and links the configuration guide');
  assert.ok(ppv.indexOf('<td>Authentication') < ppv.indexOf('<td>Webhooks') && ppv.includes(`openPanel('wh')`)); ok('Phase 0 has a Webhooks row with its own guide');
  assert.ok(['wh-1', 'wh-6', 'wh-prod-1'].every((k) => ppv.includes(`data-check="${k}"`)) && !ppv.includes('data-check="wh-7"')); ok('the Webhooks guide has six core steps and a production step; testing is in the end-to-end test');
  const whPanel = ppv.slice(ppv.indexOf('id="panel-wh"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-wh"')));
  assert.ok(['Reference: webhook fields', 'Reference: signature and code example', 'Reference: retry schedule', 'Reference: payment events'].every((t) => whPanel.includes(`<details class="sp-more"><summary>${t}</summary>`))); ok('the Webhooks guide keeps its reference material in collapsed sections');
  assert.ok(whPanel.includes('<div class="sp-h">If you run into these</div>') && ['#5-allowlist-lean-webhook-ip-addresses', '#monitor-webhook-deliveries', '#2-manage-webhooks-in-the-lean-dashboard', '#5-handle-unknown-events-safely'].every((a) => whPanel.includes(a))); ok('edge cases are linked to the exact doc sections');
  const whSteps = whPanel.slice(whPanel.indexOf('<ol class="sp-check">'), whPanel.indexOf('</ol>'));
  assert.ok(!/allowlist|unknown event|rotate/i.test(whSteps)); ok('edge cases are not checklist steps');
  assert.ok(['charge.created', 'charge.captured', 'charge.declined', 'charge.discarded', 'agreement.activated', 'agreement.revoked', 'refund.succeeded', 'lean-signature'].every((t) => whPanel.includes(t))); ok('events and the signature header are named');
  assert.equal((whPanel.match(/<svg class="seqsvg"/g) || []).length, 2); ok('the Webhooks guide has its delivery and duplicate-handling diagrams');
  assert.ok(ppv.includes('Plan Co backend') && !ppv.includes('Wise backend') && !ppv.includes('{client}')); ok('diagrams use the blueprint’s client name');
  assert.ok(!/payout lifecycle webhooks|listen for both agreement\.\* and charge\.\*|Configure a webhook endpoint with signature verification/.test(ppv)); ok('no generic webhook wording left in the guides');
  for (const id of ['dev', 'start']) { const pn = ppv.slice(ppv.indexOf(`id="panel-${id}"`), ppv.indexOf('</aside>', ppv.indexOf(`id="panel-${id}"`))); assert.ok(pn.includes('<svg class="seqsvg"')); }
  ok('every Phase 0 guide has a sequence diagram');
  const whRef = ppv.slice(ppv.indexOf('id="panel-wh"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-wh"')));
  assert.ok(whRef.includes('<div class="sp-sub-h">Instrument events</div>') && whRef.includes('same shape as Fetch Payment Instrument') && whRef.includes('rather than merging fields') && whRef.includes('&quot;type&quot;: &quot;BANK_ACCOUNT&quot;')); ok('the Webhooks reference explains instrument.created and instrument.updated, with an example');
  assert.ok(/sends <code>instrument\.created<\/code>/.test(ppv)); ok('the payment guides say Lean sends instrument.created when it creates the instrument');
  assert.ok(ppv.includes('A Payment Instrument is a funding source, created once and then referenced by its id from Charges and Agreements')); ok('hovering Payment Instrument explains what it is');
  const guidesOnly = (ppv.match(/<aside class="spanel"[\s\S]*?<\/aside>/g) || []).join('');
  assert.ok(!/\b[Cc]ards?\b/.test(guidesOnly)); ok('nothing in the guides mentions cards');
  const authRef = ppv.slice(ppv.indexOf('id="panel-start"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-start"')));
  assert.ok(['bank_identifier', 'CONFIRMED', 'NBF_OF_UAE', 'YOUR COMPANY LLC'].every((t) => authRef.includes(t)) && !/NAVIN|AE710380000012706550621/i.test(ppv)); ok('the Settlement Account example follows the working request, with sample values only');
  assert.ok(!/Saudi|sa\.leantech/.test(ppv)); ok('no Saudi Arabia details');
  assert.ok(/<span class="term" tabindex="0">Charge<span class="tip" role="tooltip">A Charge is a single payment/.test(ppv) && !ppv.includes('[[')); ok('key terms carry hover definitions');
  const otpPanel = ppv.slice(ppv.indexOf('id="panel-otp"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-otp"')));
  const otpSteps = otpPanel.slice(otpPanel.indexOf('<div class="sp-h">Integration checklist</div>'));
  const order = ['POST /v4/payment-charges</code> with an', 'in the same request', 'Store the Charge', 'details.url', 'PENDING_PROVIDER_CONFIRMATION', 'never comes back'].map((t) => otpSteps.indexOf(t));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]))); ok('One-Time Payments follows the guide: create, customer, store the ID, redirect, outcome, webhooks');
  const mind = (pn) => { const a = pn.indexOf('<ul class="sp-mind">'); return a < 0 ? '' : pn.slice(a, pn.indexOf('</ul>', a)); };
  assert.ok(mind(otpPanel).includes('10 minutes') && !mind(otpPanel).includes('data-check')); ok('One-Time Payments keeps the 10-minute window in Keep in mind, without a checkbox');
  const authPanel = ppv.slice(ppv.indexOf('id="panel-start"'), ppv.indexOf('</aside>', ppv.indexOf('id="panel-start"')));
  assert.ok(mind(authPanel).includes('Idempotency-Key') && mind(authPanel).includes('source of payment state') && !mind(authPanel).includes('data-check')); ok('idempotency and the source of payment state are things to keep in mind, not steps');
  assert.ok(['start-1', 'start-4'].every((k) => authPanel.includes(`data-check="${k}"`)) && !authPanel.includes('data-check="start-5"') && /data-check="start-1">Configure your backend with the Sandbox addresses/.test(authPanel)); ok('Authentication has four real steps, starting with the Sandbox addresses and ending with the Settlement Account');
  assert.ok(authPanel.indexOf('<div class="sp-h">Keep in mind</div>') < authPanel.indexOf('<div class="sp-h">Integration checklist</div>')); ok('Keep in mind comes before the checklist');
  assert.ok((ppv.match(/<button class="sp-wide"[^>]*onclick="toggleWide\(this\)"/g) || []).length >= 6); ok('every guide has an Expand button');
  assert.equal((ppv.match(/<button class="sp-zoom"/g) || []).length, (ppv.match(/<div class="sp-diagram">/g) || []).length); ok('every diagram can open full screen');
  assert.ok(ppv.includes('function toggleWide') && ppv.includes('function zoomDiagram') && ppv.includes('svg.seqsvg') && ppv.includes('if(!closeZoom())closePanels()')); ok('the page carries the expand script, and Escape closes the diagram first');
  assert.ok(ppv.includes('Authorization: Bearer &lt;token&gt;')); ok('diagram labels are escaped, so <token> shows');
  assert.ok(['dev', 'start', 'wh', 'otp', 'e2e'].every((id) => ppv.includes(`<tr data-row-panel="${id}">`))); ok('every row with a guide carries its progress count');
  assert.ok(/data-check="dev-10">In <b>Development<\/b>, <b>Integration settings<\/b>, copy your webhook/.test(ppv)); ok('portal setup includes copying the webhook signing secret');
  assert.ok(!/setup \(steps? \d/.test(ppv)); ok('guides refer to each other by name, not step numbers');
  assert.ok(/<tr class="grp" data-setup="dev start wh">/.test(ppv)); ok('the Phase 0 header carries the setup milestone');
  assert.ok(/<div class="phase" data-panels="dev start wh"><span class="ph">Phase 0<\/span><h3>Setup<\/h3>/.test(ppv) && ppv.indexOf('<span class="ph">Phase 0') < ppv.indexOf('<span class="ph">Phase 1')); ok('a Phase 0 card comes first in Delivery phases, so setup gets a progress bar');
  assert.equal((ppv.match(/<span class="lbl">Expand<\/span>/g) || []).length, (ppv.match(/<aside class="spanel"/g) || []).length); ok('every guide has a labelled Expand button');
  assert.ok(['function spInit', 'sp-next', 'sp-prev', "'Back to the plan'", 'tr[data-row-panel]'].every((t) => ppv.includes(t))); ok('guides get Next and Previous buttons, in the plan table’s order');
  assert.ok(['sp-resize', "role','separator'", 'pointerdown', 'ArrowLeft', 'leanbp-panel-width'].every((t) => ppv.includes(t))); ok('guides can be resized by dragging or from the keyboard, and keep their width');
  assert.ok(otpPanel.includes('<div class="sp-sub-h">The payment lifecycle</div>')); ok('One-Time Payments shows the payment lifecycle diagram');
  const recPv = (await (await builder({ action: 'preview', content: { client: { name: 'Rec Co' }, launch: { phases: [{ label: 'Phase 1', title: 'Pay-ins' }], assign: { rec: { phase: 0 } } } } })).json()).html;
  const recPanel = recPv.slice(recPv.indexOf('id="panel-rec"'), recPv.indexOf('</aside>', recPv.indexOf('id="panel-rec"')));
  assert.ok(['on demand', 'POST /v4/payment-agreements</code> with an', 'Confirm activation', 'payment-charges</code> with an Idempotency-Key', '/pauses', 'agreement.fulfilled'].every((t) => recPanel.includes(t))); ok('Recurring Payments follows the guide, step by step');
  // End-to-end test in Sandbox
  const e2ePanel = recPv.slice(recPv.indexOf('id="panel-e2e"'), recPv.indexOf('</aside>', recPv.indexOf('id="panel-e2e"')));
  assert.ok(recPv.includes('<td>End-to-end test<br>') && recPv.includes(`openPanel('e2e')`)); ok('the plan ends Phase 1 with an end-to-end test row and guide');
  assert.ok(['1. Environment', '2. A one-time payment', '3. A recurring payment', '4. Webhooks', '5. Failure cases', '6. Ready for production'].every((t) => e2ePanel.includes(`<div class="sp-h">${t}</div>`))); ok('the end-to-end test runs in order: environment, one-time, recurring, webhooks, failures, go-live');
  assert.ok(e2ePanel.includes('data-check="e2e-1"') && e2ePanel.includes('data-check="e2e-25"') && !e2ePanel.includes('data-check="e2e-26"') && e2ePanel.includes('counter-reset:spc 3')); ok('its 25 steps are numbered continuously across the groups');
  assert.ok(['e2e-prod-1', 'e2e-prod-3'].every((k) => e2ePanel.includes(`data-check="${k}"`)) && e2ePanel.includes('https://api.leantech.me')); ok('going live is listed, not counted');
  assert.ok(['https://sandbox.leantech.me', 'test user', 'charge.discarded', 'lean-signature', 'per_charge_max_amount', 'agreement.revoked', '403', 'delivery history'].every((t) => e2ePanel.includes(t))); ok('the test covers environment, test users, both flows, webhooks and failures');
  assert.ok(/data-panels="[^"]*\be2e\b/.test(recPv)); ok('the end-to-end test counts in Phase 1’s progress');
  assert.ok(/data-check="dev-11">In <b>Development<\/b>, open the test-user management section/.test(recPv)); ok('portal setup creates a Sandbox test user');
  assert.ok(!/Test in Sandbox:/.test(recPv.slice(recPv.indexOf('id="panel-otp"'), recPv.indexOf('id="panel-e2e"')))); ok('test steps live in the end-to-end test only, not repeated in each guide');
  const step7 = ppv.slice(ppv.indexOf('data-check="dev-9"'), ppv.indexOf('</li>', ppv.indexOf('data-check="dev-9"')));
  assert.equal((step7.match(/<details class="evgroup">/g) || []).length, 4); assert.ok(!step7.includes('<details class="evgroup" open')); ok('the events step shows four collapsible groups, closed by default');
  assert.ok(['Charge events', 'Agreement events', 'Instrument events', 'Optional: refunds'].every((g) => step7.includes(`<span class="evt">${g}</span>`))); ok('the groups are Charge, Agreement, Instrument and optional refunds');
  assert.ok(step7.includes('<code>instrument.created</code>') && step7.includes('<code>instrument.updated</code>')); ok('instrument.created and instrument.updated are among the events to select');
  assert.ok(!/capture\.(pending|succeeded|failed)|void\.(pending|succeeded|failed)|charge\.(authorized|voided)/.test(ppv)); ok('no capture or void events: Pay by Bank doesn’t support manual capture or voids');
  assert.ok(!/<li[^>]*>[^<]*<li/.test(step7) && !step7.includes('<li>')); ok('the groups don’t nest list items inside the checklist step');
  const whRow = ppv.slice(ppv.indexOf('<td>Webhooks'), ppv.indexOf('</tr>', ppv.indexOf('<td>Webhooks')));
  assert.equal((whRow.match(/<details class="evgroup">/g) || []).length, 4); ok('the Webhooks row lists its events in the same groups');
  assert.ok(step7.includes('under <b>Other</b>') && whRow.includes('under <b>Other</b>')); ok('the events step and the Webhooks row say the events are under Other in the dev portal');
  const devItems = (await (await admin(`/api/admin/progress?slug=${B}`)).json()).structure.panels.dev.items;
  const st7 = devItems.find((i) => i.key === 'dev-9');
  assert.ok(st7.text.startsWith('Select these webhook events') && !st7.text.includes('charge.created')); ok('the admin Progress section shows the events step’s sentence, not every event');
  assert.ok(!devItems.some((i) => i.text.includes('Your application ID from the dev portal'))); ok('hover definitions aren’t part of a step’s text in the admin page');
  assert.ok(!ppv.includes('class="apiref"') && !ppv.includes('API reference: ')); ok('no separate API reference block or links at the end');
  assert.ok(ppv.includes(`openPanel('start')`) && ppv.includes('id="panel-start"') && ppv.includes('data-check="start-4"')); ok('the Prerequisites row opens a Getting started guide with its own checklist');
  assert.ok(ppv.includes('docs/introduction') && ppv.includes('docs/sandbox-testing') && ppv.includes('https://dev.leantech.me')); ok('the guide links to the intro, Sandbox testing and the Lean Dashboard');
  assert.ok(/create the <span class="term"[^>]*>Customer<span class="tip"[^>]*>[^<]*<\/span><\/span> in the same request/.test(ppv) && !ppv.includes('Create a Customer for each user before')); ok('customers are created with the first payment, as the guides describe');
  const howItWorks = ppv.split('<div class="sp-h">How it works</div>').slice(1);
  assert.ok(howItWorks.length >= 4 && howItWorks.every((part) => /^\s*(<div class="sp-sub-h">[^<]*<\/div>)?<div class="sp-diagram">(<button class="sp-zoom"[\s\S]*?<\/button>)?<svg class="seqsvg"/.test(part))); ok('every How it works section has a diagram');
  const noPay = (await (await builder({ action: 'preview', content: { client: { name: 'Data Co' }, launch: { phases: [{ label: 'Phase 1', title: 'Data' }], assign: { data: { phase: 0 } } } } })).json()).html;
  assert.ok(!noPay.includes('Phase 0 · Setup</td>')); ok('blueprints without v4 payments products have no Phase 0');

  // Verticals: maintained in the admin page, used by new blueprints
  assert.equal((await fetch(BASE + '/api/admin/verticals')).status, 401); ok('verticals need the admin password');
  let vs = (await (await admin('/api/admin/verticals')).json()).verticals;
  assert.deepEqual(vs.map((v) => v.name), ['Remittance', 'Trading & Gaming', 'Lending', 'Emerging Industries']); ok('verticals are seeded: Remittance plus the other GTM verticals');
  assert.ok(vs.slice(1).every((v) => !v.painRows.length)); ok('only Remittance comes with pain points; the others start empty');
  r = await builder({ action: 'create', slug: T + '-lend', template: 'standard', vertical: 'lending', clientName: 'Lendco' });
  let lrow = await (await admin(`/api/admin/builder?slug=${T}-lend`)).json();
  assert.equal(lrow.draft.pain.rows.length, 0); assert.equal(lrow.draft.meta.vertical, 'Lending'); assert.ok(/no pain points yet/.test(lrow.draft.reviewNote)); ok('an empty vertical starts with no pain points and says so');
  r = await admin('/api/admin/verticals', { method: 'POST', body: JSON.stringify({ id: 'lending', name: 'Lending', painIntro: 'Lending pains for {client}.', painRows: [{ group: 'business', pain: 'Manual income checks.', solve: 'Lean **Data**.', advantage: 'Faster decisions.' }, { pain: '' }], useCases: ['Salary verification', ''], by: 'Smoke test' }) });
  assert.equal(r.status, 200); const lend = await r.json();
  assert.equal(lend.painRows.length, 1); assert.deepEqual(lend.useCases, ['Salary verification']); assert.equal(lend.updatedBy, 'Smoke test'); ok('saving a vertical keeps its filled rows and records who saved it');
  await builder({ action: 'create', slug: T + '-lend2', template: 'standard', vertical: 'lending', clientName: 'Lendco Two' });
  lrow = await (await admin(`/api/admin/builder?slug=${T}-lend2`)).json();
  assert.equal(lrow.draft.pain.intro, 'Lending pains for Lendco Two.'); assert.equal(lrow.draft.pain.rows[0].solve, 'Lean **Data**.'); ok('the next blueprint picks up the vertical’s edits, with the client name filled in');
  r = await admin('/api/admin/verticals', { method: 'POST', body: JSON.stringify({ name: 'Real Estate', painRows: [], useCases: ['Rent collection'] }) });
  assert.equal(r.status, 201); assert.equal((await r.json()).id, 'real-estate'); ok('adds a new vertical');
  assert.equal((await admin('/api/admin/verticals', { method: 'POST', body: JSON.stringify({ name: 'Real estate' }) })).status, 409); ok('refuses a second vertical with the same name');
  assert.equal((await admin('/api/admin/verticals', { method: 'DELETE', body: JSON.stringify({ id: 'real-estate' }) })).status, 200); ok('deletes a vertical');
  assert.equal((await builder({ action: 'create', slug: T + '-gone', template: 'standard', vertical: 'real-estate', clientName: 'X' })).status, 400); ok('a deleted vertical can’t be used for new blueprints');
  assert.equal((await admin(`/api/admin/builder?slug=${T}-lend`)).status, 200); ok('blueprints keep their content when a vertical changes or goes');

  // Drafting from meeting notes (against a stand-in for the Claude API)
  assert.equal((await (await admin('/api/admin/products')).json()).drafting, true); ok('drafting shows as switched on when a key is set');
  assert.equal((await admin('/api/admin/draft', { method: 'POST', body: JSON.stringify({ notes: 'too short' }) })).status, 400); ok('drafting needs real notes');
  r = await admin('/api/admin/draft', { method: 'POST', body: JSON.stringify({ notes: 'Call with Nova. They want wallet top-ups from UAE banks via Pay by Bank. Payouts later, undecided.', clientName: 'Nova' }) });
  assert.equal(r.status, 200);
  const drafted = (await r.json()).content;
  assert.equal(lastClaudeRequest.url, '/v1/messages'); assert.equal(lastClaudeRequest.headers['x-api-key'], 'test-key'); assert.equal(lastClaudeRequest.headers['anthropic-version'], '2023-06-01'); assert.equal(lastClaudeRequest.body.model, 'test-model'); ok('sends the notes to the Messages API with the key, version and model');
  assert.ok(lastClaudeRequest.body.system.includes('Never invent')); ok('instructs Claude to use only facts in the notes');
  assert.deepEqual(drafted.journeys.items[0].products, ['otp']); ok('drops products that aren’t in the library');
  assert.equal(drafted.launch.assign.otp.phase, 0); assert.equal(drafted.launch.assign.payouts.phase, 1); assert.equal(drafted.launch.phases[1].unconfirmed, true); ok('turns the drafted phases into product choices');
  assert.deepEqual(drafted.draftQuestions, ['Expected monthly volume?']); assert.ok(/Drafted by Claude/.test(drafted.reviewNote)); ok('keeps the open questions and a review note');
  r = await builder({ action: 'create', slug: T + '-notes', content: drafted, by: 'Smoke test' });
  assert.equal(r.status, 201);
  const dpv = (await (await builder({ action: 'preview', content: drafted })).json()).html;
  assert.ok(dpv.includes('Lean <b>Pay by Bank</b>') && dpv.includes("openPanel('otp')")); ok('a drafted blueprint renders with its plan');

  // Deleting links and blueprints
  const D = 'del-' + Date.now().toString(36);
  await upload({ slug: D, html: sample });
  const dl = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: D, label: 'Delete me', kind: 'client' }) })).json();
  const keep = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: D, label: 'Keep me', kind: 'internal' }) })).json();
  await json('/api/track', { token: dl.token, session: 'del-sess-' + Date.now(), event: 'open' });
  await json('/api/checklist', { token: dl.token, item: 'sample-1', done: true });
  const delLink = (token) => admin('/api/admin/links', { method: 'DELETE', body: JSON.stringify({ token }) });
  r = await delLink(dl.token);
  const gone = await r.json();
  assert.equal(r.status, 200); assert.equal(gone.visits, 1); assert.equal(gone.ticks, 1); ok('an active link can be deleted directly, with its visits and ticks');
  assert.equal((await fetch(`${BASE}/b/${dl.token}`)).status, 404); ok('a deleted link stops working straight away');
  const rv = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: D, label: 'Revoked one', kind: 'client' }) })).json();
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: rv.token, revoked: true }) });
  assert.equal((await delLink(rv.token)).status, 200); ok('a revoked link can be deleted too');
  ov = await (await admin('/api/admin/overview')).json();
  assert.ok(!ov.links.some((l) => l.token === dl.token)); assert.ok(!ov.recent.some((v) => v.label === 'Delete me')); ok('a deleted link is gone from the admin page');
  assert.equal((await fetch(`${BASE}/b/${keep.token}`)).status, 200); ok('other links on the blueprint are untouched');
  assert.equal((await delLink(dl.token)).status, 404); ok('deleting the same link twice reports it is gone');
  const delBp = (slug, confirm) => admin('/api/admin/blueprints', { method: 'DELETE', body: JSON.stringify({ slug, confirm }) });
  assert.equal((await delBp(D, 'wrong')).status, 400); ok('a blueprint is only deleted when its short name is typed correctly');
  r = await delBp(D, D);
  assert.equal(r.status, 200); assert.equal((await r.json()).links, 1); ok('deleting a blueprint removes it with its links');
  ov = await (await admin('/api/admin/overview')).json();
  assert.ok(!ov.blueprints.some((b) => b.slug === D) && !ov.links.some((l) => l.slug === D)); ok('a deleted blueprint is gone from the admin page');
  assert.equal((await fetch(`${BASE}/b/${keep.token}`)).status, 404); ok('links to a deleted blueprint stop working');
  assert.equal((await delBp(D, D)).status, 404); ok('deleting the same blueprint twice reports it is gone');
  assert.ok(ov.blueprints.some((b) => b.slug === SLUG)); ok('other blueprints are untouched');

  // Static
  assert.equal((await fetch(BASE + '/admin')).status, 200); ok('admin page loads');
  assert.equal((await fetch(BASE + '/theme.js')).status, 200); ok('theme script loads');
  assert.equal((await fetch(BASE + '/bp-runtime.js')).status, 200); ok('runtime script loads');

  console.log(`\n${passed} checks passed.`);
} catch (err) {
  console.error('\nFAILED after ' + passed + ' checks:', err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  mock.close();
}
