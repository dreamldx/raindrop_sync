import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdueAlarm } from '../src/alarmGate.js';

const MIN = 60_000;

test('an alarm firing at its scheduled time is not overdue', () => {
  const now = 1_000_000;
  assert.equal(isOverdueAlarm(now, now), false);
});

test('a slightly-late alarm (within tolerance) is not overdue', () => {
  const now = 1_000_000;
  assert.equal(isOverdueAlarm(now - 5_000, now), false);
});

test('an alarm that came due while Chrome was closed is overdue', () => {
  const now = 1_000_000;
  // Scheduled to fire 30 minutes ago, but only fires now at startup.
  assert.equal(isOverdueAlarm(now - 30 * MIN, now), true);
});

test('tolerance boundary is respected', () => {
  const now = 1_000_000;
  assert.equal(isOverdueAlarm(now - 30_000, now, 30_000), false);
  assert.equal(isOverdueAlarm(now - 30_001, now, 30_000), true);
});
