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

/**
 * Make a list of sibling folder titles unique, in order, so they can serve as
 * stable path components. The first occurrence of a title keeps it; later
 * duplicates get a ` (N)` suffix (N≥2), skipping any suffix already taken by an
 * earlier sibling. Same input order → same output, on both the Chrome and
 * Raindrop sides, so the two trees stay aligned.
 * @param {string[]} titles sibling titles in display/sort order
 * @returns {string[]} unique names, positionally matching the input
 */
export function disambiguateNames(titles) {
  const used = new Set();
  return titles.map((title) => {
    let name = title;
    let n = 2;
    while (used.has(name)) {
      name = `${title} (${n})`;
      n += 1;
    }
    used.add(name);
    return name;
  });
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
