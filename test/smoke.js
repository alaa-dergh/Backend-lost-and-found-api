// End-to-end smoke test: starts the app on a random port with a throwaway DB.
const os = require('os');
const path = require('path');
const fs = require('fs');

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-')), 'test.sqlite');
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const assert = require('assert');
const app = require('../src/app');

let passed = 0;
async function main() {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, url, { body, token } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
  const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log('  ✓', name); };

  try {
    // Auth
    const a = await call('POST', '/auth/register', { body: { name: 'Alice', email: 'alice@example.com', password: 'secret123' } });
    ok('register alice -> 201 + token', a.status === 201 && a.data.token);
    const b = await call('POST', '/auth/register', { body: { name: 'Bob', email: 'bob@example.com', password: 'secret123' } });
    ok('register bob -> 201', b.status === 201);
    ok('duplicate email -> 409', (await call('POST', '/auth/register', { body: { name: 'A', email: 'alice@example.com', password: 'secret123' } })).status === 409);
    ok('bad register -> 400', (await call('POST', '/auth/register', { body: { name: '', email: 'x', password: '1' } })).status === 400);
    ok('wrong password -> 401', (await call('POST', '/auth/login', { body: { email: 'alice@example.com', password: 'nope' } })).status === 401);
    const login = await call('POST', '/auth/login', { body: { email: 'alice@example.com', password: 'secret123' } });
    ok('login -> 200 + token', login.status === 200 && login.data.token);
    const tA = login.data.token, tB = b.data.token;
    ok('/auth/me works', (await call('GET', '/auth/me', { token: tA })).data.user.email === 'alice@example.com');

    // Create
    ok('create without token -> 401', (await call('POST', '/items/lost', { body: { title: 'Keys' } })).status === 401);
    ok('create without title -> 400', (await call('POST', '/items/lost', { token: tA, body: {} })).status === 400);
    const lost = await call('POST', '/items/lost', { token: tA, body: { title: 'Black wallet', description: 'Leather, contains ID', category: 'Wallet', location: 'Didouche Mourad, Algiers', date_occurred: '2026-10-20', contact_info: '0555 00 00 00' } });
    ok('report lost -> 201, type lost, status open', lost.status === 201 && lost.data.item.type === 'lost' && lost.data.item.status === 'open');
    ok('category normalized to lowercase', lost.data.item.category === 'wallet');
    const found = await call('POST', '/items/found', { token: tB, body: { title: 'Blue backpack', category: 'bag', location: 'Bab Ezzouar', date_occurred: '2026-10-22' } });
    ok('report found -> 201, type found', found.status === 201 && found.data.item.type === 'found');
    await call('POST', '/items/found', { token: tB, body: { title: 'Wallet near tram', category: 'wallet', location: 'Algiers center', date_occurred: '2026-10-21' } });

    // Search / filter
    const all = await call('GET', '/items');
    ok('list is public, 3 items', all.status === 200 && all.data.pagination.total === 3);
    ok('filter type=lost', (await call('GET', '/items?type=lost')).data.items.length === 1);
    ok('filter category=wallet', (await call('GET', '/items?category=wallet')).data.items.length === 2);
    ok('search q=backpack', (await call('GET', '/items?q=backpack')).data.items.length === 1);
    ok('search q matches location', (await call('GET', '/items?q=Bab')).data.items.length === 1);
    ok('filter location=Algiers', (await call('GET', '/items?location=Algiers')).data.items.length === 2);
    ok('date range filter', (await call('GET', '/items?date_from=2026-10-21&date_to=2026-10-22')).data.items.length === 2);
    ok('combined filters', (await call('GET', '/items?type=found&category=wallet')).data.items.length === 1);
    ok('pagination limit=2', (await call('GET', '/items?limit=2&page=2')).data.items.length === 1);
    ok('mine=true needs auth', (await call('GET', '/items?mine=true')).status === 401);
    ok('mine=true returns own', (await call('GET', '/items?mine=true', { token: tA })).data.items.length === 1);
    ok('invalid type filter -> 400', (await call('GET', '/items?type=banana')).status === 400);

    // Details
    const id = lost.data.item.id;
    const det = await call('GET', `/items/${id}`);
    ok('details -> 200 with reporter', det.status === 200 && det.data.item.reporter.name === 'Alice');
    ok('unknown id -> 404', (await call('GET', '/items/99999')).status === 404);

    // Update own
    ok('update by non-owner -> 403', (await call('PATCH', `/items/${id}`, { token: tB, body: { title: 'hijack' } })).status === 403);
    ok('update without token -> 401', (await call('PATCH', `/items/${id}`, { body: { title: 'x' } })).status === 401);
    const upd = await call('PATCH', `/items/${id}`, { token: tA, body: { description: 'Updated description' } });
    ok('owner update -> 200', upd.status === 200 && upd.data.item.description === 'Updated description' && upd.data.item.title === 'Black wallet');
    ok('empty update -> 400', (await call('PATCH', `/items/${id}`, { token: tA, body: {} })).status === 400);
    ok('cannot set status via update -> 400', (await call('PATCH', `/items/${id}`, { token: tA, body: { status: 'recovered' } })).status === 400);

    // Recovered
    ok('recovered by non-owner -> 403', (await call('PATCH', `/items/${id}/recovered`, { token: tB })).status === 403);
    const rec = await call('PATCH', `/items/${id}/recovered`, { token: tA });
    ok('mark recovered -> 200', rec.status === 200 && rec.data.item.status === 'recovered' && rec.data.item.recovered_at);
    ok('recovered twice -> 409', (await call('PATCH', `/items/${id}/recovered`, { token: tA })).status === 409);
    ok('filter status=recovered', (await call('GET', '/items?status=recovered')).data.items.length === 1);
    ok('filter status=open', (await call('GET', '/items?status=open')).data.items.length === 2);

    // Delete
    ok('delete by non-owner -> 403', (await call('DELETE', `/items/${id}`, { token: tB })).status === 403);
    ok('owner delete -> 204', (await call('DELETE', `/items/${id}`, { token: tA })).status === 204);
    ok('deleted item -> 404', (await call('GET', `/items/${id}`)).status === 404);

    console.log(`\nAll ${passed} checks passed`);
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
