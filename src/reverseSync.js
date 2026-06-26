// src/reverseSync.js
import { reconcile } from './reconcile.js';
import { applyOps } from './applyOps.js';
import { buildChromeActual } from './chromeActual.js';
import { pathKey } from './treeModel.js';

/**
 * Full-mirror Raindrop → Chrome: makes the Chrome bookmark tree match the
 * Raindrop tree (under the configured root collection). Reuses reconcile with
 * the Raindrop tree as "desired" and the Chrome tree as "actual", then drives
 * the changes through a chrome.bookmarks adapter.
 *
 * @param {object} raindropTree model from buildActualTree
 * @param {object[]} chromeRoots result of chrome.bookmarks.getTree()
 * @param {object} adapter chrome adapter (createChromeAdapter)
 * @param {string} rootTitle e.g. 'Chrome'
 * @param {string} rootChromeId the rootless Chrome root id (usually '0')
 * @returns {Promise<{ counts: object, folderMap: Record<string, number> }>}
 */
export async function reverseSync(raindropTree, chromeRoots, adapter, rootTitle, rootChromeId = '0') {
  const chromeActual = buildChromeActual(chromeRoots, rootTitle);
  const ops = reconcile(raindropTree, chromeActual); // desired = Raindrop, actual = Chrome
  const { counts, idByPath } = await applyOps(adapter, ops, rootChromeId, rootTitle, chromeActual);

  // Rebuild { chromeFolderId: collectionId } from the Raindrop tree + resolved paths,
  // so the forward sync and live single-ops recognise the folders we just wrote.
  const folderMap = {};
  const walk = (folder) => {
    if (folder.path.length > 1 && folder.collectionId != null) {
      const chromeId = idByPath.get(pathKey(folder.path));
      if (chromeId != null) folderMap[chromeId] = folder.collectionId;
    }
    for (const child of folder.folders) walk(child);
  };
  walk(raindropTree);

  return { counts, folderMap };
}
