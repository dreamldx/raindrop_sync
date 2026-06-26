import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathKey, emptyFolder, dedupeBookmarks, disambiguateNames } from '../src/treeModel.js';

test('disambiguateNames leaves unique titles untouched', () => {
  assert.deepEqual(disambiguateNames(['A', 'B', 'C']), ['A', 'B', 'C']);
});

test('disambiguateNames suffixes duplicate sibling titles by order', () => {
  assert.deepEqual(disambiguateNames(['Work', 'Work', 'Work']), ['Work', 'Work (2)', 'Work (3)']);
});

test('disambiguateNames avoids colliding with an existing suffixed sibling', () => {
  // A literal 'Work (2)' already present must not be duplicated by the 2nd 'Work'.
  assert.deepEqual(disambiguateNames(['Work (2)', 'Work', 'Work']), ['Work (2)', 'Work', 'Work (3)']);
});

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
