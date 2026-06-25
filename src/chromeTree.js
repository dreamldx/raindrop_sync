import { emptyFolder } from './treeModel.js';
import { isValidBookmarkUrl } from './url.js';

/** @param {object} chromeNode @param {string[]} parentPath @returns {object} FolderNode */
function convertFolder(chromeNode, parentPath) {
  const path = [...parentPath, chromeNode.title];
  const folder = emptyFolder(path, chromeNode.title);
  for (const child of chromeNode.children ?? []) {
    if (child.url) {
      // Skip non-web links (javascript:, chrome://, file://, …) — not postable to Raindrop.
      if (isValidBookmarkUrl(child.url)) {
        folder.bookmarks.push({ url: child.url, title: child.title ?? child.url });
      }
    } else if (child.children) {
      folder.folders.push(convertFolder(child, path));
    }
  }
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
  for (const container of top.children ?? []) {
    if (container.url) {
      if (isValidBookmarkUrl(container.url)) {
        root.bookmarks.push({ url: container.url, title: container.title ?? container.url });
      }
    } else {
      root.folders.push(convertFolder(container, [rootTitle]));
    }
  }
  return root;
}
