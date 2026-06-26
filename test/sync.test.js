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

// A stateful in-memory Raindrop, enough to prove end-to-end convergence.
function statefulRaindrop() {
  let nextCol = 1000;
  let nextRd = 5000;
  const collections = [{ _id: 7, title: 'Chrome', parent: null }];
  const raindrops = [];
  return () => ({
    async getRootCollections() { return collections.filter((c) => !c.parent); },
    async getChildCollections() { return collections.filter((c) => c.parent); },
    async getAllRaindrops() { return raindrops.map((r) => ({ ...r })); },
    async createCollection(title, parentId) {
      const c = { _id: nextCol++, title, parent: parentId ? { $id: parentId } : null };
      collections.push(c);
      return c;
    },
    async deleteCollection(id) {
      const i = collections.findIndex((c) => c._id === id);
      if (i >= 0) collections.splice(i, 1);
      for (let k = raindrops.length - 1; k >= 0; k--) if (raindrops[k].collectionId === id) raindrops.splice(k, 1);
    },
    async createRaindrop({ link, title, collectionId }) {
      const r = { _id: nextRd++, link, title, collectionId };
      raindrops.push(r);
      return r;
    },
    async moveRaindrop(id, collectionId) { const r = raindrops.find((x) => x._id === id); if (r) r.collectionId = collectionId; },
    async deleteRaindrop(id) { const i = raindrops.findIndex((x) => x._id === id); if (i >= 0) raindrops.splice(i, 1); },
    _state: { collections, raindrops },
  });
}

test('two same-named Chrome folders sync to two distinct collections and converge', async () => {
  const dupTree = [{ id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks Bar', children: [
      { id: '11', title: 'Work', children: [{ id: '21', title: 'B', url: 'https://b.com' }] },
      { id: '10', title: 'Work', children: [{ id: '20', title: 'A', url: 'https://a.com' }] },
    ] },
  ] }];
  const apiFactory = statefulRaindrop();
  const opts = { token: 'T', rootCollection: 'Chrome', getChromeTree: async () => dupTree, apiFactory };

  const first = await runSync(opts);
  assert.equal(first.ok, true);
  assert.equal(first.counts.collectionsCreated, 3); // Bookmarks Bar + two Work
  assert.equal(first.counts.added, 2);

  // Two collections both titled 'Work', each with the right bookmark.
  const api = apiFactory();
  const works = api._state.collections.filter((c) => c.title === 'Work').sort((a, b) => a._id - b._id);
  assert.equal(works.length, 2);
  const linksFor = (cid) => api._state.raindrops.filter((r) => r.collectionId === cid).map((r) => r.link);
  assert.deepEqual(linksFor(works[0]._id), ['https://a.com']); // lower Chrome id → lower _id
  assert.deepEqual(linksFor(works[1]._id), ['https://b.com']);

  // The folder map pins each Chrome folder id to its exact collection — this is
  // what makes live add/remove precise for duplicate-named folders.
  assert.equal(first.folderMap['10'], works[0]._id);
  assert.equal(first.folderMap['11'], works[1]._id);

  // Second run must be a pure no-op — proves the disambiguation is stable/idempotent.
  const second = await runSync(opts);
  assert.deepEqual(second.counts, { added: 0, moved: 0, deleted: 0, collectionsCreated: 0, collectionsDeleted: 0 });
});
