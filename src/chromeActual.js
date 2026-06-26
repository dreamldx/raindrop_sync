// src/chromeActual.js
import { disambiguateNames } from './treeModel.js';
import { isValidBookmarkUrl } from './url.js';

// Builds the CURRENT Chrome bookmark tree as a model that `reconcile` can treat
// as the "actual" side (folders carry `collectionId` = Chrome folder id, bookmarks
// carry `raindropId` = Chrome bookmark id). Same disambiguation/validation as
// `buildDesiredTree`, so it lines up with the Raindrop "desired" tree.

function makeFolder(path, title, chromeId) {
  return { path, title, collectionId: chromeId, folders: [], bookmarks: [] };
}

function addChildren(folder, children, path) {
  const childFolders = [];
  for (const child of children ?? []) {
    if (child.url) {
      // Skip non-web links so a full mirror never deletes bookmarklets/chrome:// etc.
      if (isValidBookmarkUrl(child.url)) {
        folder.bookmarks.push({ url: child.url, title: child.title ?? child.url, raindropId: child.id });
      }
    } else if (child.children) {
      childFolders.push(child);
    }
  }
  // Same ordering/disambiguation as the Chrome→Raindrop direction so paths match.
  childFolders.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const names = disambiguateNames(childFolders.map((c) => c.title));
  childFolders.forEach((child, i) => {
    const childPath = [...path, names[i]];
    const sub = makeFolder(childPath, child.title, child.id);
    addChildren(sub, child.children, childPath);
    folder.folders.push(sub);
  });
}

/**
 * @param {object[]} chromeRoots result of chrome.bookmarks.getTree()
 * @param {string} rootTitle e.g. 'Chrome'
 * @returns {object} model rooted at [rootTitle]; root.collectionId is the rootless root id
 */
export function buildChromeActual(chromeRoots, rootTitle) {
  const top = chromeRoots[0]; // the rootless root (id '0')
  const root = makeFolder([rootTitle], rootTitle, top.id);
  addChildren(root, top.children, [rootTitle]);
  return root;
}
