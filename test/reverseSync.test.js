// test/reverseSync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverseSync } from '../src/reverseSync.js';
import { createChromeAdapter } from '../src/chromeAdapter.js';

function fakeBm() {
  let next = 1000;
  const calls = [];
  return {
    calls,
    async create({ parentId, title, url }) {
      const id = String(next++);
      calls.push(['create', parentId, title, url ?? null, id]);
      return { id };
    },
    async move(id, { parentId }) { calls.push(['move', id, parentId]); },
    async remove(id) { calls.push(['remove', id]); },
    async removeTree(id) { calls.push(['removeTree', id]); },
  };
}

// Raindrop tree (the desired Chrome state): Bookmarks Bar has a.com and a 'Work'
// subcollection with b.com. No 'Other Bookmarks' collection.
const raindropTree = {
  path: ['Chrome'], title: 'Chrome', collectionId: 7, bookmarks: [], folders: [
    { path: ['Chrome', 'Bookmarks Bar'], title: 'Bookmarks Bar', collectionId: 100,
      bookmarks: [{ url: 'https://a.com', title: 'A', raindropId: 500 }],
      folders: [
        { path: ['Chrome', 'Bookmarks Bar', 'Work'], title: 'Work', collectionId: 101,
          bookmarks: [{ url: 'https://b.com', title: 'B', raindropId: 501 }], folders: [] },
      ] },
  ],
};

// Current Chrome: Bookmarks Bar has only x.com (extra → delete); 'Other Bookmarks'
// exists (protected, must survive even though Raindrop has no such collection).
const chromeRoots = [{
  id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks Bar', children: [
      { id: '900', title: 'X', url: 'https://x.com' },
    ] },
    { id: '2', title: 'Other Bookmarks', children: [] },
  ],
}];

test('reverseSync mirrors Raindrop into Chrome, protects roots, rebuilds the map', async () => {
  const bm = fakeBm();
  const adapter = createChromeAdapter(bm);
  const { counts, folderMap } = await reverseSync(raindropTree, chromeRoots, adapter, 'Chrome');

  // 'Work' folder created under Bookmarks Bar ('1'); its new id is 1000.
  const workCreate = bm.calls.find((c) => c[0] === 'create' && c[2] === 'Work' && c[3] === null);
  assert.ok(workCreate, 'Work folder created under Bookmarks Bar');
  assert.equal(workCreate[1], '1');
  const workId = workCreate[4];

  // a.com created under Bookmarks Bar ('1'); b.com created under the new Work folder.
  assert.ok(bm.calls.some((c) => c[0] === 'create' && c[3] === 'https://a.com' && c[1] === '1'));
  assert.ok(bm.calls.some((c) => c[0] === 'create' && c[3] === 'https://b.com' && c[1] === workId));

  // x.com (not in Raindrop) is removed; the protected 'Other Bookmarks' folder is NOT.
  assert.ok(bm.calls.some((c) => c[0] === 'remove' && c[1] === '900'), 'extra bookmark removed');
  assert.ok(!bm.calls.some((c) => c[0] === 'removeTree'), 'no root container deleted');

  // Map rebuilt: Bookmarks Bar ('1') → 100, the new Work folder → 101.
  assert.deepEqual(folderMap, { 1: 100, [workId]: 101 });
  assert.equal(counts.added, 2);
  assert.equal(counts.deleted, 1);
  assert.equal(counts.collectionsCreated, 1);
});

test('reverseSync creates an unknown top-level collection under Other Bookmarks (not root 0)', async () => {
  const bm = fakeBm();
  const adapter = createChromeAdapter(bm);
  // Raindrop has a top-level 'Inbox' collection that maps to no Chrome container.
  const tree = {
    path: ['Chrome'], title: 'Chrome', collectionId: 7, bookmarks: [], folders: [
      { path: ['Chrome', 'Inbox'], title: 'Inbox', collectionId: 200, bookmarks: [], folders: [] },
    ],
  };
  const roots = [{ id: '0', title: '', children: [{ id: '2', title: 'Other Bookmarks', children: [] }] }];
  await reverseSync(tree, roots, adapter, 'Chrome');
  // 'Inbox' would be created under the rootless root '0' → remapped to Other Bookmarks '2'.
  const inbox = bm.calls.find((c) => c[0] === 'create' && c[2] === 'Inbox');
  assert.equal(inbox[1], '2');
});
