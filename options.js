// options.js
import { createStorage } from './src/storage.js';
import { createRaindropApi } from './src/raindropApi.js';

const storage = createStorage();
const $ = (id) => document.getElementById(id);

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'md-status' + (kind ? ` md-status--${kind}` : '');
}

async function load() {
  const s = await storage.getSettings();
  $('token').value = s.token;
  $('root').value = s.rootCollection;
  $('interval').value = String(s.intervalMinutes);
}

$('toggle').addEventListener('click', () => {
  const t = $('token');
  t.type = t.type === 'password' ? 'text' : 'password';
  $('toggle').textContent = t.type === 'password' ? 'Show' : 'Hide';
});

$('test').addEventListener('click', async () => {
  setStatus($('testResult'), 'Testing…');
  try {
    const api = createRaindropApi({ token: $('token').value.trim() });
    const user = await api.getUser();
    setStatus($('testResult'), `Connected as ${user.fullName}`, 'ok');
  } catch (err) {
    setStatus($('testResult'), err.message, 'err');
  }
});

$('save').addEventListener('click', async () => {
  try {
    await storage.saveSettings({
      token: $('token').value.trim(),
      rootCollection: $('root').value.trim() || 'Chrome',
      intervalMinutes: Number($('interval').value),
    });
    await chrome.runtime.sendMessage({ type: 'reschedule' });
    setStatus($('status'), 'Saved.', 'ok');
  } catch (err) {
    setStatus($('status'), `Save failed: ${err.message}`, 'err');
  }
});

load().catch((err) => setStatus($('status'), `Load failed: ${err.message}`, 'err'));
