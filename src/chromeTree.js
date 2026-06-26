import { emptyFolder, disambiguateNames } from './treeModel.js';
import { isValidBookmarkUrl } from './url.js';

/**
 * Populate `folder` from a Chrome node's children: valid bookmarks become
 * bookmark entries; child folders are recursed. Sibling folder names are
 * disambiguated for the PATH only (identity) — the folder's real title is kept,
 * so same-named siblings stay named the same in Raindrop and are paired by order.
 * @param {object} folder FolderNode to fill
 * @param {object[]|undefined} children Chrome child nodes (in display order)
 * @param {string[]} path path of `folder`
 */
function addChildren(folder, children, path) {
  const childFolders = [];
  for (const child of children ?? []) {
    if (child.url) {
      // Skip non-web links (javascript:, chrome://, file://, …) — not postable to Raindrop.
      if (isValidBookmarkUrl(child.url)) {
        folder.bookmarks.push({ url: child.url, title: child.title ?? child.url });
      }
    } else if (child.children) {
      childFolders.push(child);
    }
  }
  // Order siblings by Chrome node id (a stable, incrementing-at-creation value,
  // the analog of Raindrop's collection _id) so same-named folders pair with
  // Raindrop collections by creation order — stable across display reordering.
  // Distinct names are unaffected by the order.
  childFolders.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const pathNames = disambiguateNames(childFolders.map((c) => c.title));
  childFolders.forEach((child, i) => {
    folder.folders.push(convertFolder(child, pathNames[i], path));
  });
}

/**
 * @param {object} chromeNode @param {string} pathName disambiguated path component
 * @param {string[]} parentPath @returns {object} FolderNode (title = real folder name)
 */
function convertFolder(chromeNode, pathName, parentPath) {
  const path = [...parentPath, pathName];
  const folder = emptyFolder(path, chromeNode.title);
  folder.chromeId = chromeNode.id; // Chrome folder node id — used to persist the folder→collection map
  addChildren(folder, chromeNode.children, path);
  return folder;
}

/**
 * @param {object[]} chromeRoots result of chrome.bookmarks.getTree()
 * @param {string} rootTitle e.g. 'Chrome'
 * @returns {object} FolderNode rooted at [rootTitle]
 */
export function buildDesiredTree(chromeRoots, rootTitle) {
  const root = emptyFolder([rootTitle], rootTitle);
  const top = chromeRoots[0]; // the rootless container
  addChildren(root, top.children, [rootTitle]);
  return root;
}
