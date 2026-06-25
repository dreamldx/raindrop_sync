// test/raindropApi.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRaindropApi, createTokenBucket } from '../src/raindropApi.js';

test('token bucket allows a full burst then forces a wait', async () => {
  let clock = 0;
  let slept = 0;
  const bucket = createTokenBucket({
    ratePerSec: 50,
    now: () => clock,
    sleep: async (ms) => { slept += ms; clock += ms; },
  });
  // 50 immediate acquisitions consume the full bucket without sleeping.
  for (let i = 0; i < 50; i += 1) await bucket.acquire();
  assert.equal(slept, 0, 'no wait while tokens remain');
  // The 51st must wait ~20ms (1 token / 50 per sec).
  await bucket.acquire();
  assert.ok(slept >= 20, `51st acquire waited for a refill, got ${slept}ms`);
});

function mockFetch(responses) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (typeof next === 'function') return next(url, opts);
    return next;
  };
  impl.calls = calls;
  return impl;
}
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

test('getUser sends bearer token and parses fullName', async () => {
  const fetchImpl = mockFetch([json({ user: { fullName: 'Ada' } })]);
  const api = createRaindropApi({ token: 'T', fetchImpl, sleep: async () => {} });
  const user = await api.getUser();
  assert.equal(user.fullName, 'Ada');
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, 'Bearer T');
});

test('429 then success retries after Retry-After', async () => {
  let slept = 0;
  const fetchImpl = mockFetch([
    new Response('rate', { status: 429, headers: { 'Retry-After': '1' } }),
    json({ user: { fullName: 'Ada' } }),
  ]);
  const api = createRaindropApi({ token: 'T', fetchImpl, sleep: async (ms) => { slept += ms; } });
  const user = await api.getUser();
  assert.equal(user.fullName, 'Ada');
  assert.ok(slept >= 1000, 'waited at least Retry-After');
});

test('getRaindrops paginates until a short page', async () => {
  const page0 = json({ items: Array.from({ length: 50 }, (_, i) => ({ _id: i, link: `l${i}`, title: `t${i}` })) });
  const page1 = json({ items: [{ _id: 99, link: 'l99', title: 't99' }] });
  const fetchImpl = mockFetch([page0, page1]);
  const api = createRaindropApi({ token: 'T', fetchImpl, sleep: async () => {} });
  const items = await api.getRaindrops(123);
  assert.equal(items.length, 51);
  assert.match(fetchImpl.calls[0].url, /\/raindrops\/123\?/);
});

test('getAllRaindrops fetches the "all" collection (0) in one sweep', async () => {
  const page0 = json({ items: [{ _id: 1, link: 'l1', title: 't1', collectionId: 8 }] });
  const fetchImpl = mockFetch([page0]);
  const api = createRaindropApi({ token: 'T', fetchImpl, sleep: async () => {} });
  const items = await api.getAllRaindrops();
  assert.equal(items.length, 1);
  assert.equal(items[0].collectionId, 8);
  assert.match(fetchImpl.calls[0].url, /\/raindrops\/0\?/);
});
