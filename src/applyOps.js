import { pathKey } from './treeModel.js';

export async function applyOps(api, ops, rootId, rootCollection, actual, rootCover) {
  // Seed the path→id map with the configured root so any root name resolves.
  const idByPath = new Map([[pathKey([rootCollection]), rootId]]);
  // Pre-seed with every pre-existing collection from the actual Raindrop tree,
  // so create/move ops targeting folders not created this run still resolve.
  if (actual) {
    const seed = (folder) => {
      idByPath.set(pathKey(folder.path), folder.collectionId);
      for (const child of folder.folders) seed(child);
    };
    seed(actual);
  }
  const counts = { added: 0, moved: 0, deleted: 0, collectionsCreated: 0, collectionsDeleted: 0 };

  // Collections must be created sequentially (parent before child, each needs the
  // parent's new id). Raindrop ops are gathered and applied in batches afterwards.
  const createRaindrops = [];
  const moveRaindrops = [];
  const deleteRaindrops = [];
  const deleteCollections = [];
  for (const op of ops) {
    if (op.type === 'createCollection') {
      const parentId = idByPath.get(pathKey(op.parentPath));
      const created = await api.createCollection(op.title, parentId, rootCover);
      idByPath.set(pathKey(op.path), created._id);
      counts.collectionsCreated += 1;
    } else if (op.type === 'createRaindrop') {
      createRaindrops.push(op);
    } else if (op.type === 'moveRaindrop') {
      moveRaindrops.push(op);
    } else if (op.type === 'deleteRaindrop') {
      deleteRaindrops.push(op);
    } else if (op.type === 'deleteCollection') {
      deleteCollections.push(op);
    }
  }

  // Create — one POST per 100 items; each item carries its own collection.
  const items = createRaindrops.map((op) => ({
    link: op.url,
    title: op.title,
    collection: { $id: idByPath.get(pathKey(op.collectionPath)) },
  }));
  for (const chunk of chunk100(items)) await api.createRaindrops(chunk);
  counts.added = items.length;

  // Move — group by (source collection → target collection), one PUT per group/100.
  const moveGroups = new Map();
  for (const op of moveRaindrops) {
    const toId = idByPath.get(pathKey(op.toCollectionPath));
    const key = `${op.fromCollectionId}\0${toId}`;
    if (!moveGroups.has(key)) moveGroups.set(key, { from: op.fromCollectionId, to: toId, ids: [] });
    moveGroups.get(key).ids.push(op.raindropId);
  }
  for (const { from, to, ids } of moveGroups.values()) {
    for (const chunk of chunk100(ids)) await api.moveRaindrops(from, chunk, to);
  }
  counts.moved = moveRaindrops.length;

  // Delete — group by source collection, one DELETE per group/100.
  const deleteGroups = new Map();
  for (const op of deleteRaindrops) {
    if (!deleteGroups.has(op.collectionId)) deleteGroups.set(op.collectionId, []);
    deleteGroups.get(op.collectionId).push(op.raindropId);
  }
  for (const [collectionId, ids] of deleteGroups) {
    for (const chunk of chunk100(ids)) await api.deleteRaindrops(collectionId, chunk);
  }
  counts.deleted = deleteRaindrops.length;

  // Empty collections are deleted last (child-before-parent order preserved).
  for (const op of deleteCollections) {
    await api.deleteCollection(op.collectionId);
    counts.collectionsDeleted += 1;
  }

  // idByPath now holds pathKey(path) → collectionId for every folder (existing +
  // created), so the caller can build the chromeFolderId → collectionId map.
  return { counts, idByPath };
}

/** Split an array into chunks of at most 100 (Raindrop's batch cap). */
function chunk100(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 100) out.push(arr.slice(i, i + 100));
  return out;
}
