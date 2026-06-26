// src/chromeAdapter.js

// Adapts the chrome.bookmarks write API to the `api` interface that applyOps
// drives (createCollection / createRaindrops / moveRaindrops / deleteRaindrops /
// deleteCollection), so the reverse sync reuses reconcile + applyOps unchanged.
// "collection" == Chrome folder, "raindrop" == Chrome bookmark.
//
// Two Chrome-specific rules:
//  - the rootless root ('0') can't hold children, so folders meant for it are
//    created under Other Bookmarks instead;
//  - the special root folders ('0','1','2','3') are never deleted.

export function createChromeAdapter(bm, {
  rootId = '0',
  otherBookmarksId = '2',
  protectedIds = new Set(['0', '1', '2', '3']),
} = {}) {
  return {
    async createCollection(title, parentId /* cover ignored for Chrome */) {
      const pid = String(parentId) === rootId ? otherBookmarksId : String(parentId);
      const node = await bm.create({ parentId: pid, title });
      return { _id: node.id };
    },
    async createRaindrops(items) {
      const out = [];
      for (const it of items) {
        const node = await bm.create({ parentId: String(it.collection.$id), title: it.title, url: it.link });
        out.push({ _id: node.id });
      }
      return out;
    },
    async moveRaindrops(_from, ids, to) {
      for (const id of ids) await bm.move(String(id), { parentId: String(to) });
    },
    async deleteRaindrops(_collectionId, ids) {
      for (const id of ids) await bm.remove(String(id));
    },
    async deleteCollection(id) {
      if (protectedIds.has(String(id))) return; // never delete Chrome's root containers
      await bm.removeTree(String(id));
    },
  };
}
