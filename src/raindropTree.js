// src/raindropTree.js
import { emptyFolder } from './treeModel.js';

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

  async function buildFolder(id, title, path) {
    const folder = emptyFolder(path, title);
    folder.collectionId = id;
    const raindrops = await api.getRaindrops(id);
    for (const r of raindrops) {
      folder.bookmarks.push({ url: r.link, title: r.title, raindropId: r._id });
    }
    for (const child of byParent.get(id) ?? []) {
      folder.folders.push(await buildFolder(child._id, child.title, [...path, child.title]));
    }
    return folder;
  }

  return buildFolder(rootId, rootTitle, [rootTitle]);
}
