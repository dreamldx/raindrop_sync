// test/sync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync } from '../src/sync.js';

const chromeTree = [{ id: '0', title: '', children: [
  { id: '1', title: 'Bookmarks Bar', children: [{ id: '4', title: 'A', url: 'https://a.com' }] },
] }];

function apiFactory() {
  const state = { roots: [{ _id: 7, title: 'Chrome' }], children: [], raindrops: {}, created: [] };
  return {
    async getUser() { return { fullName: 'Ada' }; },
    async getRootCollections() { return state.roots; },
    async getChildCollections() { return state.children; },
    async getAllRaindrops() { return Object.entries(state.raindrops).flatMap(([cid, items]) => items.map((r) => ({ ...r, collectionId: Number(cid) }))); },
    async createCollection(t, p) { const item = { _id: 50 + state.created.length, title: t }; state.created.push(item); return item; },
    async createRaindrop(a) { state.created.push(a); return { _id: 999 }; },
    async moveRaindrop() {},
    async deleteRaindrop() {},
    async deleteCollection() {},
  };
}

test('runSync mirrors a new bookmark and returns counts', async () => {
  const stages = [];
  const res = await runSync({
    token: 'T',
    rootCollection: 'Chrome',
    getChromeTree: async () => chromeTree,
    apiFactory,
    onProgress: (s) => stages.push(s),
  });
  assert.equal(res.ok, true);
  assert.equal(res.counts.added, 1);
  assert.deepEqual(stages, ['reading-chrome', 'reading-raindrop', 'applying', 'done']);
});

test('runSync fails clearly without a token', async () => {
  const res = await runSync({ token: '', rootCollection: 'Chrome', getChromeTree: async () => chromeTree });
  assert.equal(res.ok, false);
  assert.match(res.message, /token/i);
});
