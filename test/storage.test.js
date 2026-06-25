import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/storage.js';

function memArea() {
  let data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === 'string') return { [keys]: data[keys] };
      const out = {}; for (const k of keys) out[k] = data[k]; return out;
    },
    async set(obj) { data = { ...data, ...obj }; },
  };
}

test('getSettings returns defaults when empty', async () => {
  const s = createStorage(memArea());
  assert.deepEqual(await s.getSettings(), { token: '', rootCollection: 'Chrome', intervalMinutes: 30 });
});

test('saveSettings merges over defaults', async () => {
  const s = createStorage(memArea());
  await s.saveSettings({ token: 'T', intervalMinutes: 60 });
  assert.deepEqual(await s.getSettings(), { token: 'T', rootCollection: 'Chrome', intervalMinutes: 60 });
});

test('last run round-trips', async () => {
  const s = createStorage(memArea());
  await s.setLastRun({ ok: true, message: 'done', at: 123 });
  assert.deepEqual(await s.getLastRun(), { ok: true, message: 'done', at: 123 });
});
