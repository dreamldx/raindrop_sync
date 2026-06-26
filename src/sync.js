// src/sync.js
import { buildDesiredTree } from './chromeTree.js';
import { createRaindropApi } from './raindropApi.js';
import { findOrCreateRoot, buildActualTree } from './raindropTree.js';
import { reconcile } from './reconcile.js';
import { applyOps } from './applyOps.js';
import { pathKey } from './treeModel.js';

/** Build { [chromeFolderId]: collectionId } by resolving each desired folder's path. */
function buildFolderMap(desired, idByPath) {
  const map = {};
  const walk = (folder) => {
    if (folder.chromeId != null) {
      const id = idByPath.get(pathKey(folder.path));
      if (id != null) map[folder.chromeId] = id;
    }
    for (const child of folder.folders) walk(child);
  };
  walk(desired);
  return map;
}

export async function runSync({ token, rootCollection, getChromeTree, apiFactory = createRaindropApi, onProgress = () => {} }) {
  if (!token) return { ok: false, counts: null, folderMap: null, message: 'No Raindrop token set. Add one in Settings.' };
  try {
    onProgress('reading-chrome');
    const desired = buildDesiredTree(await getChromeTree(), rootCollection);

    const api = apiFactory({ token });
    onProgress('reading-raindrop');
    const { rootId } = await findOrCreateRoot(api, rootCollection);
    const actual = await buildActualTree(api, rootCollection);

    onProgress('applying');
    const ops = reconcile(desired, actual);
    const { counts, idByPath } = await applyOps(api, ops, rootId, rootCollection, actual);
    const folderMap = buildFolderMap(desired, idByPath);

    onProgress('done');
    const message = `Added ${counts.added}, moved ${counts.moved}, deleted ${counts.deleted}.`;
    return { ok: true, counts, folderMap, message };
  } catch (err) {
    return { ok: false, counts: null, folderMap: null, message: err.message };
  }
}
