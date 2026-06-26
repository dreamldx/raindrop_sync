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
    async createRaindrop(args) { log.push(['createRaindrop', args.link, args.collectionId]); return { _id: nextId++ }; },
    async moveRaindrop(id, colId) { log.push(['moveRaindrop', id, colId]); },
    async deleteRaindrop(id) { log.push(['deleteRaindrop', id]); },
  };
}

test('applyOps resolves paths to ids and reports counts', async () => {
  const api = recordingApi();
  const ops = [
    { type: 'createCollection', path: ['Chrome', 'Bar'], title: 'Bar', parentPath: ['Chrome'] },
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['Chrome', 'Bar'] },
    { type: 'moveRaindrop', raindropId: 9, toCollectionPath: ['Chrome'] },
    { type: 'deleteRaindrop', raindropId: 5 },
    { type: 'deleteCollection', path: ['Chrome', 'Old'], collectionId: 42 },
  ];
  const res = await applyOps(api, ops, 7, 'Chrome');
  assert.deepEqual(res.counts, { added: 1, moved: 1, deleted: 1, collectionsCreated: 1, collectionsDeleted: 1 });
  // idByPath exposes path → collectionId for the folder→collection map.
  assert.equal(res.idByPath.get('Chrome\0Bar'), 200);
  // Bar created under root id 7, then raindrop created under Bar's new id 200.
  assert.deepEqual(api.log[0], ['createCollection', 'Bar', 7]);
  assert.deepEqual(api.log[1], ['createRaindrop', 'https://a.com', 200]);
  assert.deepEqual(api.log[2], ['moveRaindrop', 9, 7]);
});

test('applyOps works with a non-default root name', async () => {
  const api = recordingApi();
  const ops = [
    { type: 'createCollection', path: ['MyMarks', 'Bar'], title: 'Bar', parentPath: ['MyMarks'] },
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['MyMarks', 'Bar'] },
  ];
  await applyOps(api, ops, 7, 'MyMarks');
  assert.deepEqual(api.log[0], ['createCollection', 'Bar', 7]); // resolved under root id 7
  assert.deepEqual(api.log[1], ['createRaindrop', 'https://a.com', 200]);
});

test('applyOps resolves create/move into a pre-existing actual folder (not undefined)', async () => {
  const api = recordingApi();
  // actual tree: root 'Chrome' (id 7) with pre-existing child folder 'Work' (id 55)
  const actual = {
    path: ['Chrome'], title: 'Chrome', collectionId: 7, bookmarks: [], folders: [
      { path: ['Chrome', 'Work'], title: 'Work', collectionId: 55, bookmarks: [], folders: [] },
    ],
  };
  const ops = [
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['Chrome', 'Work'] },
    { type: 'moveRaindrop', raindropId: 9, toCollectionPath: ['Chrome', 'Work'] },
  ];
  await applyOps(api, ops, 7, 'Chrome', actual);
  assert.deepEqual(api.log[0], ['createRaindrop', 'https://a.com', 55]); // NOT undefined
  assert.deepEqual(api.log[1], ['moveRaindrop', 9, 55]);
});
