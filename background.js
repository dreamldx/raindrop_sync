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
const getNode = (id) => chrome.bookmarks.get(id);

async function scheduleAlarm() {
  const { intervalMinutes } = await storage.getSettings();
  await chrome.alarms.clear(ALARM);
  if (intervalMinutes > 0) {
    chrome.alarms.create(ALARM, { periodInMinutes: intervalMinutes });
  }
}

async function runAndRecord() {
  const { token, rootCollection } = await storage.getSettings();
  const res = await runSync({
    token,
    rootCollection,
    getChromeTree,
    onProgress: (stage) => { chrome.runtime.sendMessage({ type: 'progress', stage }).catch(() => {}); },
  });
  await storage.setLastRun({ ok: res.ok, message: res.message, counts: res.counts, at: Date.now() });
  return res;
}

async function handleIncremental(kind, payload) {
  const { token, rootCollection } = await storage.getSettings();
  if (!token) return; // periodic full sync will catch up once a token is set
  const api = createRaindropApi({ token });
  try {
    const res = kind === 'created'
      ? await applyBookmarkCreated(api, rootCollection, payload, getNode)
      : await applyBookmarkRemoved(api, rootCollection, payload, getNode);
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
});
