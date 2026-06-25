// test/incremental.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFolderPath, resolveCollectionId,
  applyBookmarkCreated, applyBookmarkRemoved,
} from '../src/incremental.js';

// Chrome nodes keyed by id; getNode mimics chrome.bookmarks.get → array.
const NODES = {
  '1': { id: '1', parentId: '0', title: 'Bookmarks Bar' },
  '5': { id: '5', parentId: '1', title: 'Dev' },
};
const getNode = async (id) => [NODES[id]];

function fakeApi(state) {
  return {
    async getRootCollections() { return state.roots; },
    async getChildCollections() { return state.children; },
    async getRaindrops(id) { return state.raindrops[id] ?? []; },
    async createCollection(title, parentId) {
      const item = { _id: state.nextId++, title, parent: parentId ? { $id: parentId } : undefined };
      state.children.push(item);
      state.createdCols.push(item);
      return item;
    },
    async createRaindrop(a) { state.createdRaindrops.push(a); return { _id: state.nextId++ }; },
    async deleteRaindrop(id) { state.deletedRaindrops.push(id); },
    async deleteCollection(id) { state.deletedCols.push(id); },
  };
}
const baseState = (over = {}) => ({
  roots: [{ _id: 100, title: 'Chrome' }],
  children: [], raindrops: {}, nextId: 200,
  createdCols: [], createdRaindrops: [], deletedRaindrops: [], deletedCols: [],
  ...over,
});

test('resolveFolderPath walks the chrome parent chain', async () => {
  assert.deepEqual(await resolveFolderPath(getNode, '5', 'Chrome'), ['Chrome', 'Bookmarks Bar', 'Dev']);
});

test('resolveCollectionId creates the missing chain and returns the leaf id', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const id = await resolveCollectionId(api, ['Chrome', 'Bookmarks Bar', 'Dev'], { createMissing: true });
  assert.equal(id, 201); // 200=Bookmarks Bar, 201=Dev
  assert.deepEqual(state.createdCols.map((c) => [c.title, c.parent?.$id]), [['Bookmarks Bar', 100], ['Dev', 200]]);
});

test('applyBookmarkCreated creates a raindrop under the resolved collection', async () => {
  const state = baseState();
  const api = fakeApi(state);
  const node = { id: '9', parentId: '5', title: 'GH', url: 'https://github.com' };
  const res = await applyBookmarkCreated(api, 'Chrome', node, getNode);
  assert.deepEqual(res, { added: 1 });
  assert.deepEqual(state.createdRaindrops, [{ link: 'https://github.com', title: 'GH', collectionId: 201 }]);
});

test('applyBookmarkCreated is a no-op when the URL already exists (dedupe)', async () => {
  const state = baseState({
    children: [
      { _id: 200, title: 'Bookmarks Bar', parent: { $id: 100 } },
      { _id: 201, title: 'Dev', parent: { $id: 200 } },
    ],
    raindrops: { 201: [{ _id: 7, link: 'https://github.com', title: 'GH' }] },
  });
  const api = fakeApi(state);
  const node = { id: '9', parentId: '5', title: 'GH', url: 'https://github.com' };
  assert.equal(await applyBookmarkCreated(api, 'Chrome', node, getNode), null);
  assert.equal(state.createdRaindrops.length, 0);
});

test('applyBookmarkRemoved deletes the matching raindrop', async () => {
  const state = baseState({
    children: [
      { _id: 200, title: 'Bookmarks Bar', parent: { $id: 100 } },
      { _id: 201, title: 'Dev', parent: { $id: 200 } },
    ],
    raindrops: { 201: [{ _id: 7, link: 'https://github.com', title: 'GH' }] },
  });
  const api = fakeApi(state);
  const removeInfo = { parentId: '5', node: { title: 'GH', url: 'https://github.com' } };
  assert.deepEqual(await applyBookmarkRemoved(api, 'Chrome', removeInfo, getNode), { deleted: 1 });
  assert.deepEqual(state.deletedRaindrops, [7]);
});

test('applyBookmarkRemoved deletes the collection when a folder is removed', async () => {
  const state = baseState({
    children: [
      { _id: 200, title: 'Bookmarks Bar', parent: { $id: 100 } },
      { _id: 201, title: 'Dev', parent: { $id: 200 } },
    ],
  });
  const api = fakeApi(state);
  // Folder 'Dev' removed; its parent is Bookmarks Bar ('1'). node has no url.
  const removeInfo = { parentId: '1', node: { title: 'Dev' } };
  assert.deepEqual(await applyBookmarkRemoved(api, 'Chrome', removeInfo, getNode), { collectionsDeleted: 1 });
  assert.deepEqual(state.deletedCols, [201]);
});
