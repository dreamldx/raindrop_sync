import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathKey, emptyFolder, dedupeBookmarks } from '../src/treeModel.js';

test('pathKey joins with NUL separator', () => {
  assert.equal(pathKey(['Chrome', 'Bar']), 'Chrome\0Bar');
  assert.equal(pathKey([]), '');
});

test('emptyFolder builds an empty folder node', () => {
  assert.deepEqual(emptyFolder(['Chrome'], 'Chrome'), {
    path: ['Chrome'], title: 'Chrome', folders: [], bookmarks: [],
  });
});

test('dedupeBookmarks keeps first occurrence per url, preserves order', () => {
  const input = [
    { url: 'a', title: 'A1' },
    { url: 'b', title: 'B' },
    { url: 'a', title: 'A2' },
  ];
  assert.deepEqual(dedupeBookmarks(input), [
    { url: 'a', title: 'A1' },
    { url: 'b', title: 'B' },
  ]);
});
