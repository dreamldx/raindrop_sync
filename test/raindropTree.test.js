// test/raindropTree.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrCreateRoot, buildActualTree } from '../src/raindropTree.js';

function fakeApi({ rootCollections = [], childCollections = [], raindropsByCol = {}, created = [] }) {
  return {
    created,
    async getRootCollections() { return rootCollections; },
    async getChildCollections() { return childCollections; },
    async getRaindrops(id) { return raindropsByCol[id] ?? []; },
    async createCollection(title, parentId) {
      const item = { _id: 1000 + created.length, title, parent: parentId ? { $id: parentId } : undefined };
      created.push(item);
      rootCollections.push(item);
      return item;
    },
  };
}

test('findOrCreateRoot returns existing root id', async () => {
  const api = fakeApi({ rootCollections: [{ _id: 7, title: 'Chrome' }] });
  assert.deepEqual(await findOrCreateRoot(api, 'Chrome'), { rootId: 7 });
});

test('findOrCreateRoot creates root when missing', async () => {
  const api = fakeApi({ rootCollections: [] });
  const { rootId } = await findOrCreateRoot(api, 'Chrome');
  assert.equal(api.created[0].title, 'Chrome');
  assert.equal(rootId, 1000);
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
});
