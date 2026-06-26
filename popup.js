// popup.js
import { createStorage } from './src/storage.js';

const storage = createStorage();
const $ = (id) => document.getElementById(id);

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
      if (n === 0) return 'Already up to date…';
      return `Applying ${n} change${n === 1 ? '' : 's'}…`;
    }
    case 'done': return 'Finishing up…';
    default: return String(stage);
  }
}

// Put the popup into the "syncing" visual state (spinner + disabled button).
function enterSyncingUI(text = 'Starting…') {
  syncing = true;
  $('sync').disabled = true;
  $('sync').innerHTML = '<span class="md-spinner"></span> Syncing…';
  setStatus($('progress'), text);
}

// Render the last-run line and the Sync button's enabled state from storage.
// Storage is the source of truth — the service worker writes it at the end of
// every run, so the popup never has to depend on a live message response.
async function showLast() {
  const { token } = await storage.getSettings();
  $('sync').disabled = syncing || !token;
  const last = await storage.getLastRun();
  if (!token) { setStatus($('last'), 'Set your token in Settings', 'err'); return; }
  if (!last) { setStatus($('last'), 'No sync yet.'); return; }
  setStatus($('last'), `${last.message} · ${timeAgo(last.at)}`, last.ok ? 'ok' : 'err');
}

async function finishSync() {
  syncing = false;
  $('sync').textContent = 'Sync now';
  $('progress').textContent = '';
  await showLast();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'sync-start') {
    // A sync began (manual, alarm, or live-event fallback) — reflect it.
    if (!syncing) enterSyncingUI();
  } else if (msg.type === 'progress') {
    if (!syncing) enterSyncingUI();
    setStatus($('progress'), stageText(msg.stage, msg.detail));
  } else if (msg.type === 'synced') {
    if (syncing) finishSync(); else showLast();
  }
});

$('sync').addEventListener('click', async () => {
  if (syncing || $('sync').disabled) return;
  enterSyncingUI();
  try {
    // Best-effort: a full sync can outlive the popup (it closes on blur) or the
    // service worker, which closes the channel. We don't depend on this response —
    // completion arrives via the 'synced' broadcast and storage. The catch only
    // prevents an uncaught rejection when the channel closes early.
    await chrome.runtime.sendMessage({ type: 'sync-now' });
  } catch {
    // channel closed before a response — stored state (below) is authoritative
  }
  if (syncing) await finishSync();
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

// On open, learn whether a sync is already running so the button starts disabled.
async function init() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'get-state' });
    if (state?.running) { enterSyncingUI('Syncing…'); return; }
  } catch {
    // service worker asleep / no response — fall through to stored state
  }
  await showLast();
}

init();
