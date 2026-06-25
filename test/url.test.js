import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidBookmarkUrl } from '../src/url.js';

test('accepts http and https web links', () => {
  assert.equal(isValidBookmarkUrl('https://a.com'), true);
  assert.equal(isValidBookmarkUrl('http://x.org/path?q=1#frag'), true);
  assert.equal(isValidBookmarkUrl('https://sub.domain.example/a/b'), true);
});

test('rejects non-web schemes the browser allows in bookmarks', () => {
  assert.equal(isValidBookmarkUrl('javascript:void(0)'), false);
  assert.equal(isValidBookmarkUrl('chrome://settings'), false);
  assert.equal(isValidBookmarkUrl('chrome-extension://abc/page.html'), false);
  assert.equal(isValidBookmarkUrl('about:blank'), false);
  assert.equal(isValidBookmarkUrl('file:///C:/notes.txt'), false);
  assert.equal(isValidBookmarkUrl('data:text/plain,hi'), false);
  assert.equal(isValidBookmarkUrl('ftp://host/file'), false);
});

test('rejects malformed or empty values', () => {
  assert.equal(isValidBookmarkUrl('not a url'), false);
  assert.equal(isValidBookmarkUrl('http://'), false);
  assert.equal(isValidBookmarkUrl(''), false);
  assert.equal(isValidBookmarkUrl(null), false);
  assert.equal(isValidBookmarkUrl(undefined), false);
});
