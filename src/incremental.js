// src/incremental.js
import { isValidBookmarkUrl } from './url.js';

/**
 * Walk the Chrome parent chain from `parentId` up to the rootless root (id '0')
 * and return the model path [rootTitle, ...folderTitles].
 */
export async function resolveFolderPath(getNode, parentId, rootTitle) {
  const titles = [];
  let id = parentId;
  while (id != null && id !== '0') {
    const [node] = await getNode(id);
    if (!node) break;
    titles.unshift(node.title);
    id = node.parentId;
  }
  return [rootTitle, ...titles];
}

/** Resolve a model path to a Raindrop collection id, creating segments if allowed. */
export async function resolveCollectionId(api, path, { createMissing = true } = {}) {
  const [rootTitle, ...segments] = path;
  const roots = await api.getRootCollections();
  let parentId = roots.find((c) => c.title === rootTitle)?._id ?? null;
  if (parentId == null) {
    if (!createMissing) return null;
    parentId = (await api.createCollection(rootTitle, null))._id;
  }
  const children = await api.getChildCollections();
  for (const title of segments) {
    const match = children.find((c) => c.parent?.$id === parentId && c.title === title);
    if (match) {
      parentId = match._id;
    } else {
      if (!createMissing) return null;
      parentId = (await api.createCollection(title, parentId))._id;
    }
  }
  return parentId;
}

/**
 * Walk the Chrome parent chain and report whether any folder along it shares its
 * title with a sibling folder. When true, a single-op can't reliably pick the
 * right Raindrop collection (title match is ambiguous, and creating on-demand
 * can't reproduce the id→_id order), so the caller should fall back to a full
 * sync — which pairs/creates collections in id order and self-heals.
 */
export async function chainHasDuplicateNames(getNode, getChildren, startParentId) {
  let id = startParentId;
  while (id != null && id !== '0') {
    const [node] = await getNode(id);
    if (!node) break;
    const folderSibs = (await getChildren(node.parentId)).filter((c) => !c.url);
    if (folderSibs.filter((s) => s.title === node.title).length > 1) return true;
    id = node.parentId;
  }
  return false;
}

/**
 * Single-op handler for chrome.bookmarks.onCreated.
 * Returns `{ fallback: true }` if the target folder chain has duplicate names —
 * the caller should run a full sync instead.
 */
export async function applyBookmarkCreated(api, rootTitle, node, getNode, getChildren) {
  if (!node.url) return null; // folders are created lazily when a bookmark lands
  if (!isValidBookmarkUrl(node.url)) return null; // skip non-web links (javascript:, chrome://, …)
  if (getChildren && await chainHasDuplicateNames(getNode, getChildren, node.parentId)) {
    return { fallback: true };
  }
  const path = await resolveFolderPath(getNode, node.parentId, rootTitle);
  const collectionId = await resolveCollectionId(api, path, { createMissing: true });
  const existing = await api.getRaindrops(collectionId);
  if (existing.some((r) => r.link === node.url)) return null; // dedupe by URL
  await api.createRaindrop({ link: node.url, title: node.title || node.url, collectionId });
  return { added: 1 };
}

/**
 * Single-op handler for chrome.bookmarks.onRemoved.
 * Returns `{ fallback: true }` when duplicate folder names make the target
 * collection ambiguous — the caller should run a full sync instead.
 */
export async function applyBookmarkRemoved(api, rootTitle, removeInfo, getNode, getChildren) {
  const { parentId, node } = removeInfo;
  if (getChildren) {
    // A removed folder is already gone from Chrome; a remaining same-named
    // sibling (or any ambiguous ancestor) makes the target collection unclear.
    if (!node.url) {
      const sibs = (await getChildren(parentId)).filter((c) => !c.url);
      if (sibs.some((s) => s.title === node.title)) return { fallback: true };
    }
    if (await chainHasDuplicateNames(getNode, getChildren, parentId)) return { fallback: true };
  }
  const parentPath = await resolveFolderPath(getNode, parentId, rootTitle);
  if (node.url) {
    const collectionId = await resolveCollectionId(api, parentPath, { createMissing: false });
    if (collectionId == null) return null;
    const raindrops = await api.getRaindrops(collectionId);
    const match = raindrops.find((r) => r.link === node.url);
    if (!match) return null;
    await api.deleteRaindrop(match._id);
    return { deleted: 1 };
  }
  // Folder removed: its own path is parentPath + its title.
  const folderPath = [...parentPath, node.title];
  const collectionId = await resolveCollectionId(api, folderPath, { createMissing: false });
  if (collectionId == null) return null;
  await api.deleteCollection(collectionId);
  return { collectionsDeleted: 1 };
}
