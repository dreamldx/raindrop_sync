// test/applyOps.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../src/applyOps.js';

function recordingApi() {
  const log = [];
  let nextId = 200;
  return {
    log,
    async createCollection(title, parentId) { log.push(['createCollection', title, parentId]); return { _id: nextId++ }; },
    async deleteCollection(id) { log.push(['deleteCollection', id]); },
    async createRaindrops(items) { log.push(['createRaindrops', items]); return items.map(() => ({ _id: nextId++ })); },
    async moveRaindrops(from, ids, to) { log.push(['moveRaindrops', from, ids, to]); },
    async deleteRaindrops(collectionId, ids) { log.push(['deleteRaindrops', collectionId, ids]); },
  };
}

test('applyOps batches creates/moves/deletes and reports counts', async () => {
  const api = recordingApi();
  const ops = [
    { type: 'createCollection', path: ['Chrome', 'Bar'], title: 'Bar', parentPath: ['Chrome'] },
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['Chrome', 'Bar'] },
    { type: 'moveRaindrop', raindropId: 9, fromCollectionId: 3, toCollectionPath: ['Chrome'] },
    { type: 'deleteRaindrop', raindropId: 5, collectionId: 3 },
    { type: 'deleteCollection', path: ['Chrome', 'Old'], collectionId: 42 },
  ];
  const res = await applyOps(api, ops, 7, 'Chrome');
  assert.deepEqual(res.counts, { added: 1, moved: 1, deleted: 1, collectionsCreated: 1, collectionsDeleted: 1 });
  assert.equal(res.idByPath.get('Chrome\0Bar'), 200);
  assert.deepEqual(api.log[0], ['createCollection', 'Bar', 7]);
  // Bar created under root id 7 → 200; the raindrop is created under Bar (200) in one batch.
  assert.deepEqual(api.log[1], ['createRaindrops', [{ link: 'https://a.com', title: 'A', collection: { $id: 200 } }]]);
  assert.deepEqual(api.log[2], ['moveRaindrops', 3, [9], 7]); // from collection 3 → root 7
  assert.deepEqual(api.log[3], ['deleteRaindrops', 3, [5]]);
  assert.deepEqual(api.log[4], ['deleteCollection', 42]);
});

test('applyOps groups creates/moves/deletes by collection into single batched calls', async () => {
  const api = recordingApi();
  const ops = [
    // two creates into the same root collection → one createRaindrops call
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['Chrome'] },
    { type: 'createRaindrop', url: 'https://b.com', title: 'B', collectionPath: ['Chrome'] },
    // two deletes from the same source collection (3) → one deleteRaindrops call
    { type: 'deleteRaindrop', raindropId: 11, collectionId: 3 },
    { type: 'deleteRaindrop', raindropId: 12, collectionId: 3 },
  ];
  await applyOps(api, ops, 7, 'Chrome');
  const creates = api.log.filter((e) => e[0] === 'createRaindrops');
  const deletes = api.log.filter((e) => e[0] === 'deleteRaindrops');
  assert.equal(creates.length, 1);
  assert.equal(creates[0][1].length, 2); // both creates in one call
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0], ['deleteRaindrops', 3, [11, 12]]);
});

test('applyOps gives each created collection the root collection cover', async () => {
  const covers = [];
  const api = {
    async createCollection(title, parentId, cover) { covers.push(cover); return { _id: 200 }; },
    async createRaindrops() { return []; },
    async moveRaindrops() {},
    async deleteRaindrops() {},
    async deleteCollection() {},
  };
  const ops = [
    { type: 'createCollection', path: ['Chrome', 'Bar'], title: 'Bar', parentPath: ['Chrome'] },
  ];
  await applyOps(api, ops, 7, 'Chrome', null, ['https://up.raindrop.io/icon.png']);
  assert.deepEqual(covers, [['https://up.raindrop.io/icon.png']]);
});

test('applyOps resolves create into a pre-existing actual folder (not undefined)', async () => {
  const api = recordingApi();
  const actual = {
    path: ['Chrome'], title: 'Chrome', collectionId: 7, bookmarks: [], folders: [
      { path: ['Chrome', 'Work'], title: 'Work', collectionId: 55, bookmarks: [], folders: [] },
    ],
  };
  const ops = [
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['Chrome', 'Work'] },
    { type: 'moveRaindrop', raindropId: 9, fromCollectionId: 7, toCollectionPath: ['Chrome', 'Work'] },
  ];
  await applyOps(api, ops, 7, 'Chrome', actual);
  assert.deepEqual(api.log[0], ['createRaindrops', [{ link: 'https://a.com', title: 'A', collection: { $id: 55 } }]]);
  assert.deepEqual(api.log[1], ['moveRaindrops', 7, [9], 55]);
});
