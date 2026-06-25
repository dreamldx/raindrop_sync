// test/reconcile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/reconcile.js';

const root = (folders = [], bookmarks = [], extra = {}) =>
  ({ path: ['Chrome'], title: 'Chrome', folders, bookmarks, ...extra });

test('empty desired and actual produce no ops', () => {
  assert.deepEqual(reconcile(root(), root([], [], { collectionId: 1 })), []);
});

test('new bookmark at root → createRaindrop', () => {
  const desired = root([], [{ url: 'https://a.com', title: 'A' }]);
  const actual = root([], [], { collectionId: 1 });
  assert.deepEqual(reconcile(desired, actual), [
    { type: 'createRaindrop', url: 'https://a.com', title: 'A', collectionPath: ['Chrome'] },
  ]);
});

test('bookmark only in actual → deleteRaindrop', () => {
  const desired = root();
  const actual = root([], [{ url: 'https://a.com', title: 'A', raindropId: 9 }], { collectionId: 1 });
  assert.deepEqual(reconcile(desired, actual), [
    { type: 'deleteRaindrop', raindropId: 9 },
  ]);
});

test('new folder → createCollection parent-before-child', () => {
  const desired = root([
    { path: ['Chrome', 'Bar'], title: 'Bar', folders: [
      { path: ['Chrome', 'Bar', 'Dev'], title: 'Dev', folders: [], bookmarks: [] },
    ], bookmarks: [] },
  ]);
  const actual = root([], [], { collectionId: 1 });
  assert.deepEqual(reconcile(desired, actual), [
    { type: 'createCollection', path: ['Chrome', 'Bar'], title: 'Bar', parentPath: ['Chrome'] },
    { type: 'createCollection', path: ['Chrome', 'Bar', 'Dev'], title: 'Dev', parentPath: ['Chrome', 'Bar'] },
  ]);
});

test('folder only in actual → deleteCollection child-before-parent, last', () => {
  const desired = root();
  const actual = root([
    { path: ['Chrome', 'Bar'], title: 'Bar', collectionId: 2, folders: [
      { path: ['Chrome', 'Bar', 'Dev'], title: 'Dev', collectionId: 3, folders: [], bookmarks: [] },
    ], bookmarks: [] },
  ], [], { collectionId: 1 });
  assert.deepEqual(reconcile(desired, actual), [
    { type: 'deleteCollection', path: ['Chrome', 'Bar', 'Dev'], collectionId: 3 },
    { type: 'deleteCollection', path: ['Chrome', 'Bar'], collectionId: 2 },
  ]);
});

test('same url in different folder → moveRaindrop', () => {
  const desired = root([
    { path: ['Chrome', 'B'], title: 'B', folders: [], bookmarks: [{ url: 'https://a.com', title: 'A' }] },
  ]);
  const actual = root([
    { path: ['Chrome', 'A'], title: 'A', collectionId: 2, folders: [],
      bookmarks: [{ url: 'https://a.com', title: 'A', raindropId: 9 }] },
  ], [], { collectionId: 1 });
  const ops = reconcile(desired, actual);
  // 'B' is created before the move targets it; old folder 'A' is deleted last.
  assert.deepEqual(ops, [
    { type: 'createCollection', path: ['Chrome', 'B'], title: 'B', parentPath: ['Chrome'] },
    { type: 'moveRaindrop', raindropId: 9, toCollectionPath: ['Chrome', 'B'] },
    { type: 'deleteCollection', path: ['Chrome', 'A'], collectionId: 2 },
  ]);
});

test('global ordering: creates, then moves, then deleteRaindrop, then deleteCollection', () => {
  const desired = root(
    [{ path: ['Chrome', 'New'], title: 'New', folders: [], bookmarks: [{ url: 'https://n.com', title: 'N' }] }],
    [{ url: 'https://keep.com', title: 'Keep' }],
  );
  const actual = root(
    [{ path: ['Chrome', 'Old'], title: 'Old', collectionId: 2, folders: [],
       bookmarks: [{ url: 'https://gone.com', title: 'Gone', raindropId: 7 }] }],
    [{ url: 'https://keep.com', title: 'Keep', raindropId: 5 }],
    { collectionId: 1 },
  );
  const ops = reconcile(desired, actual);
  const types = ops.map((o) => o.type);
  const firstDeleteRaindrop = types.indexOf('deleteRaindrop');
  const firstDeleteCollection = types.indexOf('deleteCollection');
  const lastCreate = Math.max(types.lastIndexOf('createCollection'), types.lastIndexOf('createRaindrop'));
  assert.ok(lastCreate < firstDeleteRaindrop, 'creates precede deleteRaindrop');
  assert.ok(firstDeleteRaindrop < firstDeleteCollection, 'deleteRaindrop precedes deleteCollection');
});
