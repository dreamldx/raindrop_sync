// test/chromeTree.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesiredTree } from '../src/chromeTree.js';

// Mimic chrome.bookmarks.getTree() output: array with one rootless root.
const chromeTree = [{
  id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks Bar', children: [
      { id: '4', title: 'A', url: 'https://a.com' },
      { id: '5', title: 'Dev', children: [
        { id: '6', title: 'GH', url: 'https://github.com' },
      ] },
    ] },
    { id: '2', title: 'Other Bookmarks', children: [
      { id: '7', title: 'B', url: 'https://b.com' },
    ] },
  ],
}];

test('buildDesiredTree maps Chrome containers to child folders under root', () => {
  const tree = buildDesiredTree(chromeTree, 'Chrome');
  assert.equal(tree.title, 'Chrome');
  assert.deepEqual(tree.path, ['Chrome']);
  const barFolder = tree.folders.find((f) => f.title === 'Bookmarks Bar');
  assert.ok(barFolder, 'Bookmarks Bar folder exists');
  assert.deepEqual(barFolder.path, ['Chrome', 'Bookmarks Bar']);
  assert.deepEqual(barFolder.bookmarks, [{ url: 'https://a.com', title: 'A' }]);
  const dev = barFolder.folders.find((f) => f.title === 'Dev');
  assert.deepEqual(dev.path, ['Chrome', 'Bookmarks Bar', 'Dev']);
  assert.deepEqual(dev.bookmarks, [{ url: 'https://github.com', title: 'GH' }]);
});

test('buildDesiredTree skips non-web bookmark URLs', () => {
  const withJunk = [{
    id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks Bar', children: [
        { id: '4', title: 'Good', url: 'https://good.com' },
        { id: '5', title: 'Bookmarklet', url: 'javascript:void(0)' },
        { id: '6', title: 'Settings', url: 'chrome://settings' },
        { id: '7', title: 'Local', url: 'file:///C:/x.txt' },
      ] },
    ],
  }];
  const tree = buildDesiredTree(withJunk, 'Chrome');
  const bar = tree.folders.find((f) => f.title === 'Bookmarks Bar');
  assert.deepEqual(bar.bookmarks, [{ url: 'https://good.com', title: 'Good' }]);
});

test('same-named sibling folders get distinct paths, sorted by id, real titles kept', () => {
  const dup = [{
    id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks Bar', children: [
        // Listed b.com first, but it has the higher id (created later).
        { id: '11', title: 'Work', children: [{ id: '21', title: 'B', url: 'https://b.com' }] },
        { id: '10', title: 'Work', children: [{ id: '20', title: 'A', url: 'https://a.com' }] },
      ] },
    ],
  }];
  const tree = buildDesiredTree(dup, 'Chrome');
  const bar = tree.folders.find((f) => f.title === 'Bookmarks Bar');
  // Sorted by id: the lower-id 'Work' (a.com) takes the bare path; both keep title 'Work'.
  const works = bar.folders.filter((f) => f.title === 'Work');
  assert.equal(works.length, 2);
  const first = works.find((f) => f.path.join('|') === 'Chrome|Bookmarks Bar|Work');
  const second = works.find((f) => f.path.join('|') === 'Chrome|Bookmarks Bar|Work (2)');
  assert.ok(first && second, 'paths are Work and Work (2)');
  assert.equal(first.title, 'Work');
  assert.equal(second.title, 'Work');
  assert.deepEqual(first.bookmarks, [{ url: 'https://a.com', title: 'A' }]);
  assert.deepEqual(second.bookmarks, [{ url: 'https://b.com', title: 'B' }]);
});
