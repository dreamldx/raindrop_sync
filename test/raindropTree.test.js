// test/raindropTree.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrCreateRoot, buildActualTree } from '../src/raindropTree.js';

function fakeApi({ rootCollections = [], childCollections = [], raindropsByCol = {}, created = [] }) {
  const calls = { getAllRaindrops: 0 };
  return {
    created,
    calls,
    async getRootCollections() { return rootCollections; },
    async getChildCollections() { return childCollections; },
    // Flatten the per-collection fixture into one batch response, tagging each
    // raindrop with its collectionId (as the real /raindrops/0 endpoint does).
    async getAllRaindrops() {
      calls.getAllRaindrops += 1;
      const all = [];
      for (const [cid, items] of Object.entries(raindropsByCol)) {
        for (const r of items) all.push({ ...r, collectionId: Number(cid) });
      }
      return all;
    },
    async createCollection(title, parentId) {
      const item = { _id: 1000 + created.length, title, parent: parentId ? { $id: parentId } : undefined };
      created.push(item);
      rootCollections.push(item);
      return item;
    },
  };
}

test('findOrCreateRoot returns existing root id and its cover', async () => {
  const cover = ['https://up.raindrop.io/collection/icon.png'];
  const api = fakeApi({ rootCollections: [{ _id: 7, title: 'Chrome', cover }] });
  assert.deepEqual(await findOrCreateRoot(api, 'Chrome'), { rootId: 7, cover });
});

test('findOrCreateRoot creates root when missing', async () => {
  const api = fakeApi({ rootCollections: [] });
  const { rootId, cover } = await findOrCreateRoot(api, 'Chrome');
  assert.equal(api.created[0].title, 'Chrome');
  assert.equal(rootId, 1000);
  assert.deepEqual(cover, []);
});

test('buildActualTree nests child collections and raindrops with ids', async () => {
  const api = fakeApi({
    rootCollections: [{ _id: 7, title: 'Chrome' }],
    childCollections: [{ _id: 8, title: 'Bar', parent: { $id: 7 } }],
    raindropsByCol: {
      7: [{ _id: 100, link: 'https://a.com', title: 'A' }],
      8: [{ _id: 101, link: 'https://b.com', title: 'B' }],
    },
  });
  const tree = await buildActualTree(api, 'Chrome');
  assert.equal(tree.collectionId, 7);
  assert.deepEqual(tree.bookmarks, [{ url: 'https://a.com', title: 'A', raindropId: 100 }]);
  const bar = tree.folders.find((f) => f.title === 'Bar');
  assert.equal(bar.collectionId, 8);
  assert.deepEqual(bar.path, ['Chrome', 'Bar']);
  assert.deepEqual(bar.bookmarks, [{ url: 'https://b.com', title: 'B', raindropId: 101 }]);
  // All raindrops fetched in a single batch sweep, regardless of collection count.
  assert.equal(api.calls.getAllRaindrops, 1);
});

test('same-named sibling collections get distinct paths, ordered by _id, real titles kept', () => {
  return buildActualTree(fakeApi({
    rootCollections: [{ _id: 7, title: 'Chrome' }],
    // Two 'Work' collections; listed high-id first to prove _id sort, not array order.
    childCollections: [
      { _id: 9, title: 'Work', parent: { $id: 7 } },
      { _id: 8, title: 'Work', parent: { $id: 7 } },
    ],
    raindropsByCol: {
      8: [{ _id: 80, link: 'https://a.com', title: 'A' }],
      9: [{ _id: 90, link: 'https://b.com', title: 'B' }],
    },
  }), 'Chrome').then((tree) => {
    const works = tree.folders.filter((f) => f.title === 'Work');
    assert.equal(works.length, 2);
    // Lowest _id (8) → bare path 'Work'; next (9) → 'Work (2)'. Titles stay 'Work'.
    const first = works.find((f) => f.path.join('|') === 'Chrome|Work');
    const second = works.find((f) => f.path.join('|') === 'Chrome|Work (2)');
    assert.equal(first.collectionId, 8);
    assert.deepEqual(first.bookmarks, [{ url: 'https://a.com', title: 'A', raindropId: 80 }]);
    assert.equal(second.collectionId, 9);
    assert.deepEqual(second.bookmarks, [{ url: 'https://b.com', title: 'B', raindropId: 90 }]);
  });
});
