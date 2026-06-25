/**
 * @typedef {{ url: string, title: string }} BookmarkNode
 * @typedef {{ path: string[], title: string, folders: FolderNode[], bookmarks: BookmarkNode[] }} FolderNode
 */

const SEP = '\0';

/** @param {string[]} path */
export function pathKey(path) {
  return path.join(SEP);
}

/** @param {string[]} path @param {string} title @returns {FolderNode} */
export function emptyFolder(path, title) {
  return { path, title, folders: [], bookmarks: [] };
}

/** @param {BookmarkNode[]} bookmarks @returns {BookmarkNode[]} */
export function dedupeBookmarks(bookmarks) {
  const seen = new Set();
  const out = [];
  for (const b of bookmarks) {
    if (seen.has(b.url)) continue;
    seen.add(b.url);
    out.push(b);
  }
  return out;
}
