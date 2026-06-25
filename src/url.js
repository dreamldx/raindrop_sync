// src/url.js

/**
 * A bookmark URL is postable to Raindrop only if it is a real web link.
 * We accept parseable http(s) URLs and skip everything else the browser
 * tolerates in bookmarks — javascript:, chrome://, chrome-extension://,
 * about:, file://, data:, ftp://, and malformed/empty values.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isValidBookmarkUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
