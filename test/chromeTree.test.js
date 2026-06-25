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
