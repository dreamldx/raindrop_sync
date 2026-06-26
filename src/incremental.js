// src/incremental.js
import { isValidBookmarkUrl } from './url.js';

/**
 * Single-op handler for chrome.bookmarks.onCreated.
 *
 * The target collection is resolved by the persistent folder map
 * (chromeFolderId → raindropCollectionId, rebuilt by every full sync), so
 * duplicate-named folders are never confused — each Chrome folder id pins its
 * exact collection. Returns `{ fallback: true }` when the bookmark's folder
 * isn't in the map yet (e.g. a brand-new folder), so the caller runs a full
 * sync, which creates the collection and refreshes the map.
 *
 * @param {object} api Raindrop API client
 * @param {object} node the created bookmark node ({ url, title, parentId })
 * @param {Record<string, number>} folderMap chromeFolderId → collectionId
 */
export async function applyBookmarkCreated(api, node, folderMap) {
  if (!node.url) return null; // folders are created lazily by the full sync
  if (!isValidBookmarkUrl(node.url)) return null; // skip non-web links (javascript:, chrome://, …)
  const collectionId = folderMap[node.parentId];
  if (collectionId == null) return { fallback: true }; // folder not synced yet
  const existing = await api.getRaindrops(collectionId);
  if (existing.some((r) => r.link === node.url)) return null; // dedupe by URL
  await api.createRaindrop({ link: node.url, title: node.title || node.url, collectionId });
  return { added: 1 };
}

/**
 * Single-op handler for chrome.bookmarks.onRemoved.
 *
 * A removed bookmark resolves its collection via the folder map and deletes the
 * matching raindrop by URL. A removed folder falls back to a full sync (which
 * deletes the collection and rebuilds the map).
 *
 * @param {object} api Raindrop API client
 * @param {object} removeInfo { parentId, node } from chrome.bookmarks.onRemoved
 * @param {Record<string, number>} folderMap chromeFolderId → collectionId
 */
export async function applyBookmarkRemoved(api, removeInfo, folderMap) {
  const { parentId, node } = removeInfo;
  if (!node.url) return { fallback: true }; // folder removed → full sync deletes it + rebuilds map
  const collectionId = folderMap[parentId];
  if (collectionId == null) return { fallback: true };
  const raindrops = await api.getRaindrops(collectionId);
  const match = raindrops.find((r) => r.link === node.url);
  if (!match) return null;
  await api.deleteRaindrop(match._id);
  return { deleted: 1 };
}
