// Decide whether a fired periodic-sync alarm should trigger a real sync.
//
// chrome.alarms persist across restarts, so a periodic alarm that came due while
// Chrome was closed fires the instant Chrome reopens, with `scheduledTime` well
// in the past. We must NOT sync on that overdue startup firing. A normally
// scheduled alarm fires within a second or two of its `scheduledTime`, so any
// firing that is more than `toleranceMs` late is an overdue catch-up we drop.
//
// This is order-independent: it relies only on the alarm's own scheduledTime,
// not on whether chrome.runtime.onStartup happened to run first.
export function isOverdueAlarm(scheduledTime, now, toleranceMs = 30_000) {
  return now - scheduledTime > toleranceMs;
}
