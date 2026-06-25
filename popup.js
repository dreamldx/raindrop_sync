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

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'md-status' + (kind ? ` md-status--${kind}` : '');
}

function timeAgo(at) {
  if (!at) return '';
  const mins = Math.round((Date.now() - at) / 60000);
  return mins <= 0 ? 'just now' : `${mins} min ago`;
}

async function showLast() {
  const last = await storage.getLastRun();
  const { token } = await storage.getSettings();
  if (!token) { setStatus($('last'), 'Set your token in Settings', 'err'); $('sync').disabled = true; return; }
  if (!last) { setStatus($('last'), 'No sync yet.'); return; }
  setStatus($('last'), `${last.message} · ${timeAgo(last.at)}`, last.ok ? 'ok' : 'err');
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') $('progress').textContent = STAGE_TEXT[msg.stage] ?? msg.stage;
});

$('sync').addEventListener('click', async () => {
  $('sync').disabled = true;
  $('sync').innerHTML = '<span class="md-spinner"></span> Syncing…';
  const res = await chrome.runtime.sendMessage({ type: 'sync-now' });
  $('sync').textContent = 'Sync now';
  $('progress').textContent = '';
  if (res) setStatus($('last'), `${res.message} · just now`, res.ok ? 'ok' : 'err');
  $('sync').disabled = false;
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

showLast();
