// background.js
import { createStorage } from './src/storage.js';
import { runSync } from './src/sync.js';
import { createRaindropApi } from './src/raindropApi.js';
import { applyBookmarkCreated, applyBookmarkRemoved } from './src/incremental.js';
import { findOrCreateRoot, buildActualTree } from './src/raindropTree.js';
import { reverseSync } from './src/reverseSync.js';
import { createChromeAdapter } from './src/chromeAdapter.js';
import { isOverdueAlarm } from './src/alarmGate.js';

const storage = createStorage();
const ALARM = 'sync';

// Serialize ALL Raindrop work (full syncs + incremental ops) so they never
// overlap or race the rate limiter. Each enqueued task runs after the previous
// settles; enqueue() returns the task's own result promise.
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

let importing = false;
// Suppress live forward events while the reverse sync is writing to Chrome, so
// its writes don't bounce back as Chrome→Raindrop ops.
let suppressEvents = false;
// True for a short window right after a real Chrome launch. Chrome replays its
// bookmark hydration as an import session at startup, which would otherwise
// trigger a full sync; this flag lets onImportEnded skip that startup sync.
let browserJustStarted = false;

const getChromeTree = () => chrome.bookmarks.getTree();

async function scheduleAlarm() {
  const { intervalMinutes } = await storage.getSettings();
  await chrome.alarms.clear(ALARM);
  if (intervalMinutes > 0) {
    chrome.alarms.create(ALARM, { periodInMinutes: intervalMinutes });
  }
}

// True while any full sync is executing, so a popup (even one opened mid-sync)
// can disable its button. Queried via the 'get-state' message.
let running = false;

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function runAndRecord() {
  running = true;
  broadcast({ type: 'sync-start' });
  try {
    const { token, rootCollection } = await storage.getSettings();
    const res = await runSync({
      token,
      rootCollection,
      getChromeTree,
      onProgress: (stage, detail) => broadcast({ type: 'progress', stage, detail }),
    });
    await storage.setLastRun({ ok: res.ok, message: res.message, counts: res.counts, at: Date.now() });
    // Persist the rebuilt chromeFolderId → collectionId map for the live single-ops.
    if (res.folderMap) await storage.setFolderMap(res.folderMap);
    return res;
  } finally {
    running = false;
    // Notify any open popup that the run finished and the result is in storage.
    // This survives a closed message channel (the popup is destroyed on blur).
    broadcast({ type: 'synced' });
  }
}

// Full-mirror Raindrop → Chrome (the reverse direction). Writes to Chrome
// bookmarks with live forward events suppressed, then refreshes the folder map.
async function runReverseAndRecord() {
  running = true;
  suppressEvents = true;
  broadcast({ type: 'sync-start' });
  try {
    const { token, rootCollection } = await storage.getSettings();
    if (!token) {
      await storage.setLastRun({ ok: false, message: 'No Raindrop token set. Add one in Settings.', at: Date.now() });
      return;
    }
    const api = createRaindropApi({ token });
    broadcast({ type: 'progress', stage: 'reading-raindrop' });
    await findOrCreateRoot(api, rootCollection);
    const raindropTree = await buildActualTree(api, rootCollection);

    broadcast({ type: 'progress', stage: 'reading-chrome' });
    const chromeRoots = await chrome.bookmarks.getTree();

    broadcast({ type: 'progress', stage: 'mirroring' });
    const adapter = createChromeAdapter(chrome.bookmarks);
    const { counts, folderMap } = await reverseSync(raindropTree, chromeRoots, adapter, rootCollection);

    await storage.setFolderMap(folderMap);
    const message = `Pulled from Raindrop: added ${counts.added}, deleted ${counts.deleted}.`;
    await storage.setLastRun({ ok: true, message, counts, at: Date.now() });
    // Chrome now matches Raindrop — restart the periodic forward-sync countdown so
    // it doesn't immediately fire right after a pull.
    await scheduleAlarm();
  } catch (err) {
    await storage.setLastRun({ ok: false, message: `Pull failed: ${err.message}`, at: Date.now() });
  } finally {
    running = false;
    suppressEvents = false;
    broadcast({ type: 'synced' });
  }
}

async function handleIncremental(kind, payload) {
  const { token, rootCollection } = await storage.getSettings();
  if (!token) return; // periodic full sync will catch up once a token is set
  const api = createRaindropApi({ token });
  try {
    const folderMap = await storage.getFolderMap();
    const res = kind === 'created'
      ? await applyBookmarkCreated(api, payload, folderMap)
      : await applyBookmarkRemoved(api, payload, folderMap);
    if (res && res.fallback) {
      // Folder isn't mapped yet (or a folder was removed) — run a full sync,
      // which creates/deletes the collection and refreshes the folder map.
      await runAndRecord();
      return;
    }
    if (res) await storage.setLastRun({ ok: true, message: `Live ${kind}`, counts: res, at: Date.now() });
  } catch (err) {
    await storage.setLastRun({ ok: false, message: `Live ${kind} failed: ${err.message}`, at: Date.now() });
  }
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);

// At Chrome startup we only restart the schedule timer — we do NOT sync.
// scheduleAlarm resets the countdown to a fresh full interval.
chrome.runtime.onStartup.addListener(() => {
  // Cover Chrome's startup bookmark-hydration import burst so it doesn't sync.
  // Cleared after a margin past the observed hydration window (~16s); the worker
  // also usually recycles before then, which resets the flag on its own.
  browserJustStarted = true;
  setTimeout(() => { browserJustStarted = false; }, 60_000);
  return scheduleAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  // chrome.alarms persist across restarts, so a periodic alarm that came due
  // while Chrome was closed fires the instant Chrome reopens, with scheduledTime
  // in the past. Drop that overdue startup firing instead of syncing — this is
  // order-independent, unlike a flag set in onStartup which the overdue alarm can
  // race (firing before onStartup, or after it resolves).
  if (isOverdueAlarm(alarm.scheduledTime, Date.now())) return;
  enqueue(runAndRecord);
});

// Event-driven incremental sync (suppressed during bulk import).
chrome.bookmarks.onCreated.addListener((_id, node) => {
  if (importing || suppressEvents) return;
  enqueue(() => handleIncremental('created', node));
});
chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
  if (importing || suppressEvents) return;
  enqueue(() => handleIncremental('removed', removeInfo));
});
chrome.bookmarks.onImportBegan.addListener(() => { importing = true; });
chrome.bookmarks.onImportEnded.addListener(() => {
  importing = false;
  // Chrome replays its bookmark hydration as an import session at launch. Skip
  // the sync in that case — the existing bookmarks already match Raindrop — so
  // we only sync on genuine user imports.
  if (browserJustStarted) return;
  enqueue(runAndRecord);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'sync-now') {
    enqueue(runAndRecord).then(sendResponse, (err) => sendResponse({ ok: false, counts: null, message: err.message }));
    return true; // async response
  }
  if (msg.type === 'reverse-sync') {
    enqueue(runReverseAndRecord).then(sendResponse, (err) => sendResponse({ ok: false, message: err.message }));
    return true;
  }
  if (msg.type === 'reschedule') {
    scheduleAlarm().then(() => sendResponse({ ok: true }), (err) => sendResponse({ ok: false, message: err.message }));
    return true;
  }
  if (msg.type === 'get-state') {
    // Lets a freshly-opened popup learn a sync is already running.
    sendResponse({ running });
    return false;
  }
});
