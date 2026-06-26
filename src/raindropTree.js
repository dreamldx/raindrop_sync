// src/raindropTree.js
import { emptyFolder, disambiguateNames } from './treeModel.js';

export async function findOrCreateRoot(api, rootTitle) {
  const roots = await api.getRootCollections();
  const existing = roots.find((c) => c.title === rootTitle);
  if (existing) return { rootId: existing._id };
  const created = await api.createCollection(rootTitle, null);
  return { rootId: created._id };
}

export async function buildActualTree(api, rootTitle) {
  const { rootId } = await findOrCreateRoot(api, rootTitle);
  const children = await api.getChildCollections();

  // Map parentId -> child collection records.
  const byParent = new Map();
  for (const c of children) {
    const pid = c.parent?.$id;
    if (pid == null) continue;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(c);
  }

  // Fetch every raindrop in one paginated sweep, then bucket by collection id —
  // far fewer requests than querying each collection separately.
  const byCollection = new Map();
  for (const r of await api.getAllRaindrops()) {
    const cid = r.collectionId ?? r.collection?.$id;
    if (!byCollection.has(cid)) byCollection.set(cid, []);
    byCollection.get(cid).push(r);
  }

  function buildFolder(id, title, path) {
    const folder = emptyFolder(path, title);
    folder.collectionId = id;
    for (const r of byCollection.get(id) ?? []) {
      folder.bookmarks.push({ url: r.link, title: r.title, raindropId: r._id });
    }
    // Order siblings by collection _id so same-named collections map to Chrome
    // folders by creation order; disambiguate the PATH only, keeping real titles.
    const siblings = (byParent.get(id) ?? []).slice().sort((a, b) => a._id - b._id);
    const pathNames = disambiguateNames(siblings.map((c) => c.title));
    siblings.forEach((child, i) => {
      folder.folders.push(buildFolder(child._id, child.title, [...path, pathNames[i]]));
    });
    return folder;
  }

  return buildFolder(rootId, rootTitle, [rootTitle]);
}
