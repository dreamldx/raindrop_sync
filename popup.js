// popup.js
import { createStorage } from './src/storage.js';

const storage = createStorage();
const $ = (id) => document.getElementById(id);
const SYNC_LABEL = 'Sync to Raindrop';
const PULL_LABEL = 'Sync from Raindrop';

let syncing = false;

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'md-status' + (kind ? ` md-status--${kind}` : '');
}

function timeAgo(at) {
  if (!at) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  return mins <= 0 ? 'just now' : `${mins} min ago`;
}

function stageText(stage, detail) {
  switch (stage) {
    case 'reading-chrome': return 'Reading Chrome bookmarks…';
    case 'reading-raindrop': return 'Fetching Raindrop collections…';
    case 'applying': {
      const n = detail?.changes ?? 0;
      return n === 0 ? 'Already up to date…' : `Applying ${n} change${n === 1 ? '' : 's'}…`;
    }
    case 'mirroring': return 'Updating Chrome bookmarks…';
    case 'done': return 'Finishing up…';
    default: return String(stage);
  }
}

// Put the popup into the "busy" state: both buttons disabled, spinner on the
// active one. `active` is 'sync' or 'pull'.
function enterSyncingUI(active = 'sync', text = 'Starting…') {
  syncing = true;
  $('sync').disabled = true;
  $('pull').disabled = true;
  $('sync').innerHTML = active === 'sync' ? '<span class="md-spinner"></span> Syncing…' : SYNC_LABEL;
  $('pull').innerHTML = active === 'pull' ? '<span class="md-spinner"></span> Pulling…' : PULL_LABEL;
  setStatus($('progress'), text);
}

// Render the last-run line and both buttons' enabled state from storage.
async function showLast() {
  const { token } = await storage.getSettings();
  $('sync').disabled = syncing || !token;
  $('pull').disabled = syncing || !token;
  const last = await storage.getLastRun();
  if (!token) { setStatus($('last'), 'Set your token in Settings', 'err'); return; }
  if (!last) { setStatus($('last'), 'No sync yet.'); return; }
  setStatus($('last'), `${last.message} · ${timeAgo(last.at)}`, last.ok ? 'ok' : 'err');
}

async function finishSync() {
  syncing = false;
  $('sync').textContent = SYNC_LABEL;
  $('pull').textContent = PULL_LABEL;
  $('progress').textContent = '';
  await showLast();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'sync-start') {
    if (!syncing) enterSyncingUI();
  } else if (msg.type === 'progress') {
    if (!syncing) enterSyncingUI(msg.stage === 'mirroring' ? 'pull' : 'sync');
    setStatus($('progress'), stageText(msg.stage, msg.detail));
  } else if (msg.type === 'synced') {
    if (syncing) finishSync(); else showLast();
  }
});

async function runRequest(active, message) {
  if (syncing || $(active).disabled) return;
  enterSyncingUI(active);
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // channel closed before a response — stored state is authoritative
  }
  if (syncing) await finishSync();
}

$('sync').addEventListener('click', () => runRequest('sync', { type: 'sync-now' }));

$('pull').addEventListener('click', () => {
  // Full mirror writes to Chrome and can DELETE bookmarks not in Raindrop.
  const ok = confirm(
    'Sync from Raindrop will make Chrome match your Raindrop collections, '
    + 'including deleting Chrome bookmarks that are not in Raindrop. Continue?',
  );
  if (ok) runRequest('pull', { type: 'reverse-sync' });
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

// On open, learn whether a sync is already running so the buttons start disabled.
async function init() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'get-state' });
    if (state?.running) { enterSyncingUI('sync', 'Syncing…'); return; }
  } catch {
    // service worker asleep / no response — fall through to stored state
  }
  await showLast();
}

init();
