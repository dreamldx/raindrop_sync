// background.js
import { createStorage } from './src/storage.js';
import { runSync } from './src/sync.js';
import { createRaindropApi } from './src/raindropApi.js';
import { applyBookmarkCreated, applyBookmarkRemoved } from './src/incremental.js';

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
chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) enqueue(runAndRecord);
});

// Event-driven incremental sync (suppressed during bulk import).
chrome.bookmarks.onCreated.addListener((_id, node) => {
  if (importing) return;
  enqueue(() => handleIncremental('created', node));
});
chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
  if (importing) return;
  enqueue(() => handleIncremental('removed', removeInfo));
});
chrome.bookmarks.onImportBegan.addListener(() => { importing = true; });
chrome.bookmarks.onImportEnded.addListener(() => { importing = false; enqueue(runAndRecord); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'sync-now') {
    enqueue(runAndRecord).then(sendResponse, (err) => sendResponse({ ok: false, counts: null, message: err.message }));
    return true; // async response
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
