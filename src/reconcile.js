// src/reconcile.js
import { pathKey, dedupeBookmarks } from './treeModel.js';

/**
 * Flatten a tree into Maps keyed by pathKey.
 * @returns {{ folders: Map<string, any>, byUrl: Map<string, {folderKey: string, node: any}> }}
 */
function index(rootNode) {
  const folders = new Map();
  const byUrl = new Map();
  const walk = (node) => {
    folders.set(pathKey(node.path), node);
    for (const b of dedupeBookmarks(node.bookmarks)) {
      // url is unique within a folder after dedupe; key by folder+url
      byUrl.set(pathKey(node.path) + '\0' + b.url, { folderKey: pathKey(node.path), node: b });
    }
    for (const f of node.folders) walk(f);
  };
  walk(rootNode);
  return { folders, byUrl };
}

/** Collect folders in parent-before-child order (preorder). */
function preorderFolders(rootNode) {
  const out = [];
  const walk = (node) => { out.push(node); for (const f of node.folders) walk(f); };
  walk(rootNode);
  return out;
}

export function reconcile(desired, actual) {
  const D = index(desired);
  const A = index(actual);

  const createCollection = [];
  const createRaindrop = [];
  const moveRaindrop = [];
  const deleteRaindrop = [];
  const deleteCollection = [];

  // --- Collections ---
  // Create: desired folders missing in actual, parent-before-child (preorder).
  for (const node of preorderFolders(desired)) {
    if (node.path.length === 1) continue; // root already exists
    if (!A.folders.has(pathKey(node.path))) {
      createCollection.push({
        type: 'createCollection',
        path: node.path,
        title: node.title,
        parentPath: node.path.slice(0, -1),
      });
    }
  }
  // Delete: actual folders missing in desired, child-before-parent (reverse preorder).
  for (const node of preorderFolders(actual).reverse()) {
    if (node.path.length === 1) continue; // never delete root
    if (!D.folders.has(pathKey(node.path))) {
      deleteCollection.push({ type: 'deleteCollection', path: node.path, collectionId: node.collectionId });
    }
  }

  // --- Bookmarks ---
  // Build url -> actual location (first occurrence) for move detection.
  const actualByUrl = new Map(); // url -> { folderKey, raindropId }
  for (const { folderKey, node } of A.byUrl.values()) {
    if (!actualByUrl.has(node.url)) actualByUrl.set(node.url, { folderKey, raindropId: node.raindropId });
  }
  // Set of every URL wanted somewhere in the desired tree (for delete detection).
  const desiredUrls = new Set();
  for (const { node } of D.byUrl.values()) desiredUrls.add(node.url);

  // Desired bookmarks: create or move.
  for (const { folderKey, node } of D.byUrl.values()) {
    const desiredFolder = D.folders.get(folderKey);
    const present = A.byUrl.get(folderKey + '\0' + node.url);
    if (present) continue; // already in the right folder
    const elsewhere = actualByUrl.get(node.url);
    if (elsewhere && elsewhere.folderKey !== folderKey) {
      moveRaindrop.push({
        type: 'moveRaindrop',
        raindropId: elsewhere.raindropId,
        fromCollectionId: A.folders.get(elsewhere.folderKey).collectionId,
        toCollectionPath: desiredFolder.path,
      });
    } else {
      createRaindrop.push({
        type: 'createRaindrop',
        url: node.url,
        title: node.title,
        collectionPath: desiredFolder.path,
      });
    }
  }

  // Actual bookmarks not wanted anywhere → delete (skip ones being moved).
  const movedIds = new Set(moveRaindrop.map((m) => m.raindropId));
  for (const { folderKey, node } of A.byUrl.values()) {
    const wantedSomewhere = desiredUrls.has(node.url);
    if (!wantedSomewhere && !movedIds.has(node.raindropId)) {
      deleteRaindrop.push({
        type: 'deleteRaindrop',
        raindropId: node.raindropId,
        collectionId: A.folders.get(folderKey).collectionId,
      });
    }
  }

  return [
    ...createCollection,
    ...createRaindrop,
    ...moveRaindrop,
    ...deleteRaindrop,
    ...deleteCollection,
  ];
}
