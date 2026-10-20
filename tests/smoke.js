// End-to-end check against a real Postgres. Usage:
//   DATABASE_URL=postgres://... npm test
// Starts the dev server on a spare port, applies the schema and walks every flow.
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const ADMIN = 'test-admin-password-123';
const env = { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: ADMIN, SLACK_WEBHOOK_URL: '' };
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

  // Checklist
  r = await json('/api/checklist', { token: client.token, item: 'sample-1', done: true });
  assert.equal((await r.json()).by, 'Test client'); ok('ticking an item records who ticked it');
  await json('/api/checklist', { token: client.token, item: 'sample-3', done: true });
  const state = await (await fetch(`${BASE}/api/checklist?token=${client.token}`)).json();
  assert.equal(state.items['sample-1'].done, true); ok('ticks persist and read back');
  assert.equal((await json('/api/checklist', { token: client.token, item: 'made-up', done: true })).status, 400); ok('refuses items that are not in the blueprint');
  ov = await (await admin('/api/admin/overview')).json();
  assert.equal(ov.blueprints.find((b) => b.slug === SLUG).done, 2); ok('admin overview shows checklist progress');

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
  assert.ok(!pv.includes('<script>window.__LEAN_BP')); ok('preview has no tracking');
  assert.equal((pv.match(/data-check="otp-/g) || []).length, 6); ok('guide checklist items get stable keys');
  assert.ok(pv.includes('Reconciliation') && pv.includes('GET /recon')); ok('custom products render in cards and table');
  assert.ok(pv.includes('<span class="client-name">Acme Remit</span>')); ok('name-only header shows the client name');
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
  r = await json('/api/checklist', { token: built.token, item: 'otp-2', done: true });
  assert.equal(r.status, 200); ok('its guide checklist ticks save');
  await builder({ action: 'save', slug: B, content: { ...content, summary: 'Unpublished edit.' } });
  page = await (await fetch(`${BASE}/b/${built.token}`)).text();
  assert.ok(!page.includes('Unpublished edit.')); ok('clients keep seeing the published version while a draft is edited');
  ov = await (await admin('/api/admin/overview')).json();
  assert.equal(ov.blueprints.find((b) => b.slug === B).unpublished_changes, true); ok('admin shows unpublished changes');
  assert.equal((await upload({ slug: B, html: sample, replace: true })).status, 409); ok('a form blueprint cannot be overwritten by a file upload');
  assert.equal((await admin('/api/admin/products')).status, 200); ok('product library loads');

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
}
