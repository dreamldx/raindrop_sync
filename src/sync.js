// src/sync.js
import { buildDesiredTree } from './chromeTree.js';
import { createRaindropApi } from './raindropApi.js';
import { findOrCreateRoot, buildActualTree } from './raindropTree.js';
import { reconcile } from './reconcile.js';
import { applyOps } from './applyOps.js';

export async function runSync({ token, rootCollection, getChromeTree, apiFactory = createRaindropApi, onProgress = () => {} }) {
  if (!token) return { ok: false, counts: null, message: 'No Raindrop token set. Add one in Settings.' };
  try {
    onProgress('reading-chrome');
    const desired = buildDesiredTree(await getChromeTree(), rootCollection);

    const api = apiFactory({ token });
    onProgress('reading-raindrop');
    const { rootId } = await findOrCreateRoot(api, rootCollection);
    const actual = await buildActualTree(api, rootCollection);

    onProgress('applying');
    const ops = reconcile(desired, actual);
    const counts = await applyOps(api, ops, rootId, rootCollection, actual);

    onProgress('done');
    const message = `Added ${counts.added}, moved ${counts.moved}, deleted ${counts.deleted}.`;
    return { ok: true, counts, message };
  } catch (err) {
    return { ok: false, counts: null, message: err.message };
  }
}
