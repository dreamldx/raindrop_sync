import { pathKey } from './treeModel.js';

export async function applyOps(api, ops, rootId, rootCollection, actual) {
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

  for (const op of ops) {
    if (op.type === 'createCollection') {
      const parentId = idByPath.get(pathKey(op.parentPath));
      const created = await api.createCollection(op.title, parentId);
      idByPath.set(pathKey(op.path), created._id);
      counts.collectionsCreated += 1;
    } else if (op.type === 'createRaindrop') {
      const collectionId = idByPath.get(pathKey(op.collectionPath));
      await api.createRaindrop({ link: op.url, title: op.title, collectionId });
      counts.added += 1;
    } else if (op.type === 'moveRaindrop') {
      const collectionId = idByPath.get(pathKey(op.toCollectionPath));
      await api.moveRaindrop(op.raindropId, collectionId);
      counts.moved += 1;
    } else if (op.type === 'deleteRaindrop') {
      await api.deleteRaindrop(op.raindropId);
      counts.deleted += 1;
    } else if (op.type === 'deleteCollection') {
      await api.deleteCollection(op.collectionId);
      counts.collectionsDeleted += 1;
    }
  }
  return counts;
}
