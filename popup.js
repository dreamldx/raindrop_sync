// popup.js
import { createStorage } from './src/storage.js';

const storage = createStorage();
const $ = (id) => document.getElementById(id);
const STAGE_TEXT = {
  'reading-chrome': 'Reading bookmarks…',
  'reading-raindrop': 'Fetching Raindrop…',
  'applying': 'Applying changes…',
  'done': 'Done.',
};

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
  if (msg.type === 'progress') {
    $('progress').textContent = STAGE_TEXT[msg.stage] ?? msg.stage;
  } else if (msg.type === 'synced') {
    // Service worker finished a run and wrote the result to storage.
    if (syncing) finishSync(); else showLast();
  }
});

$('sync').addEventListener('click', async () => {
  if (syncing || $('sync').disabled) return;
  syncing = true;
  $('sync').disabled = true;
  $('sync').innerHTML = '<span class="md-spinner"></span> Syncing…';
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

showLast();
