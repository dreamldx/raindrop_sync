// test/incremental.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBookmarkCreated, applyBookmarkRemoved } from '../src/incremental.js';

function fakeApi(state) {
  return {
    async getRaindrops(id) { return state.raindrops[id] ?? []; },
    async createRaindrop(a) { state.createdRaindrops.push(a); return { _id: state.nextId++ }; },
    async deleteRaindrop(id) { state.deletedRaindrops.push(id); },
  };
}
const baseState = (over = {}) => ({
  raindrops: {}, nextId: 200,
  createdRaindrops: [], deletedRaindrops: [],
  ...over,
});

// folderMap: chromeFolderId → raindropCollectionId. Two same-named Chrome folders
// '10' and '11' map to distinct collections 1001 and 1002.
const folderMap = { '5': 201, '10': 1001, '11': 1002 };

test('applyBookmarkCreated creates a raindrop in the mapped collection', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const node = { id: '9', parentId: '5', title: 'GH', url: 'https://github.com' };
  assert.deepEqual(await applyBookmarkCreated(api, node, folderMap), { added: 1 });
  assert.deepEqual(state.createdRaindrops, [{ link: 'https://github.com', title: 'GH', collectionId: 201 }]);
});

test('applyBookmarkCreated routes duplicate-named folders to distinct collections by id', async () => {
  const state = baseState();
  const api = fakeApi(state);
  await applyBookmarkCreated(api, { id: 'a', parentId: '10', title: 'A', url: 'https://a.com' }, folderMap);
  await applyBookmarkCreated(api, { id: 'b', parentId: '11', title: 'B', url: 'https://b.com' }, folderMap);
  assert.deepEqual(state.createdRaindrops, [
    { link: 'https://a.com', title: 'A', collectionId: 1001 },
    { link: 'https://b.com', title: 'B', collectionId: 1002 },
  ]);
});

test('applyBookmarkCreated dedupes when the URL already exists', async () => {
  const state = baseState({ raindrops: { 201: [{ _id: 7, link: 'https://github.com' }] } });
  const api = fakeApi(state);
  const node = { id: '9', parentId: '5', title: 'GH', url: 'https://github.com' };
  assert.equal(await applyBookmarkCreated(api, node, folderMap), null);
  assert.equal(state.createdRaindrops.length, 0);
});

test('applyBookmarkCreated skips non-web URLs', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const node = { id: '9', parentId: '5', title: 'JS', url: 'javascript:void(0)' };
  assert.equal(await applyBookmarkCreated(api, node, folderMap), null);
  assert.equal(state.createdRaindrops.length, 0);
});

test('applyBookmarkCreated falls back to full sync for an unmapped folder', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const node = { id: '9', parentId: '999', title: 'New', url: 'https://new.com' };
  assert.deepEqual(await applyBookmarkCreated(api, node, folderMap), { fallback: true });
  assert.equal(state.createdRaindrops.length, 0);
});

test('applyBookmarkRemoved deletes the matching raindrop from the mapped collection', async () => {
  const state = baseState({ raindrops: { 1002: [{ _id: 88, link: 'https://b.com' }] } });
  const api = fakeApi(state);
  const removeInfo = { parentId: '11', node: { title: 'B', url: 'https://b.com' } };
  assert.deepEqual(await applyBookmarkRemoved(api, removeInfo, folderMap), { deleted: 1 });
  assert.deepEqual(state.deletedRaindrops, [88]);
});

test('applyBookmarkRemoved returns null when the raindrop is absent', async () => {
  const state = baseState({ raindrops: { 1002: [] } });
  const api = fakeApi(state);
  const removeInfo = { parentId: '11', node: { title: 'B', url: 'https://b.com' } };
  assert.equal(await applyBookmarkRemoved(api, removeInfo, folderMap), null);
});

test('applyBookmarkRemoved falls back for an unmapped folder', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const removeInfo = { parentId: '999', node: { title: 'X', url: 'https://x.com' } };
  assert.deepEqual(await applyBookmarkRemoved(api, removeInfo, folderMap), { fallback: true });
});

test('applyBookmarkRemoved falls back when a folder is removed', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const removeInfo = { parentId: '1', node: { title: 'Dev' } }; // no url → folder
  assert.deepEqual(await applyBookmarkRemoved(api, removeInfo, folderMap), { fallback: true });
});
