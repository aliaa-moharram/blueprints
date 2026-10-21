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
  const team2 = await r.json();
  assert.notEqual(team2.token, client.token);
  let t2 = await (await fetch(`${BASE}/api/checklist?token=${team2.token}`)).json();
  assert.equal(t2.mode, 'edit'); assert.deepEqual(t2.items, {}); ok('a new client team starts with an empty checklist');
  await json('/api/checklist', { token: team2.token, item: 'sample-2', done: true });
  const t1 = await (await fetch(`${BASE}/api/checklist?token=${client.token}`)).json();
  assert.equal(t1.items['sample-2'], undefined); ok('one team’s ticks never show on another team’s link');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Lean', kind: 'internal' }) });
  const lean = await r.json();
  assert.equal((await json('/api/checklist', { token: lean.token, item: 'sample-1', done: false })).status, 403); ok('a Lean team link cannot tick');
  const lv = await (await fetch(`${BASE}/api/checklist?token=${lean.token}`)).json();
  assert.equal(lv.mode, 'view');
  assert.deepEqual(lv.teams.map((t) => t.name), ['Test client', 'Second team']);
  assert.equal(lv.teams[0].items['sample-1'].done, true); ok('a Lean team link sees each client team’s progress');
  assert.ok(!JSON.stringify(lv).includes(client.token) && !JSON.stringify(lv).includes(team2.token)); ok('the Lean view never reveals client team links');
  await admin('/api/admin/links', { method: 'PATCH', body: JSON.stringify({ token: team2.token, revoked: true }) });
  const lv2 = await (await fetch(`${BASE}/api/checklist?token=${lean.token}`)).json();
  assert.deepEqual(lv2.teams.map((t) => t.name), ['Test client']); ok('revoked teams drop out of the Lean view');

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
  assert.ok(pv.includes('<div class="phase" data-panels="otp">')); ok('phase cards list their guide checklists for phase progress');
  assert.ok(!/footer \.row2\{[^}]*border-top/.test(pv)); ok('the footer has a single divider');
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
  const team3 = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Third team', kind: 'client' }) })).json();
  assert.equal((await fetch(`${BASE}/b/${team3.token}?view=${viewParam}`)).status, 403); ok('a view address only works for the team it was made for');
  const { createHmac } = await import('node:crypto');
  const past = Math.floor(Date.now() / 1000) - 60;
  const expired = past + '.' + createHmac('sha256', ADMIN).update(`view:${client.token}:${past}`).digest('base64url');
  const ex = await fetch(`${BASE}/b/${client.token}?view=${expired}`);
  assert.equal(ex.status, 403); assert.ok((await ex.text()).includes('This view has expired')); ok('an expired view address explains how to open a new one');
  r = await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: SLUG, label: 'Lean again', kind: 'internal' }) });
  assert.equal((await admin('/api/admin/view', { method: 'POST', body: JSON.stringify({ token: (await r.json()).token }) })).status, 400); ok('view progress is only offered for client team links');

  // Deleting links and blueprints
  const D = 'del-' + Date.now().toString(36);
  await upload({ slug: D, html: sample });
  const dl = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: D, label: 'Delete me', kind: 'client' }) })).json();
  const keep = await (await admin('/api/admin/links', { method: 'POST', body: JSON.stringify({ slug: D, label: 'Keep me', kind: 'client' }) })).json();
  await json('/api/track', { token: dl.token, session: 'del-sess-' + Date.now(), event: 'open' });
  await json('/api/checklist', { token: dl.token, item: 'sample-1', done: true });
  await json('/api/checklist', { token: keep.token, item: 'sample-2', done: true });
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
  assert.equal((await fetch(`${BASE}/api/checklist?token=${keep.token}`).then((x) => x.json())).items['sample-2'].done, true); ok('other teams on the blueprint are untouched');
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
}
