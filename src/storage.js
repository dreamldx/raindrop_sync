const DEFAULTS = { token: '', rootCollection: 'Chrome', intervalMinutes: 30 };
const SETTINGS_KEY = 'settings';
const LAST_RUN_KEY = 'lastRun';

export function createStorage(area = chrome.storage.local) {
  return {
    async getSettings() {
      const got = await area.get(SETTINGS_KEY);
      return { ...DEFAULTS, ...(got[SETTINGS_KEY] ?? {}) };
    },
    async saveSettings(partial) {
      const current = await this.getSettings();
      await area.set({ [SETTINGS_KEY]: { ...current, ...partial } });
    },
    async getLastRun() {
      const got = await area.get(LAST_RUN_KEY);
      return got[LAST_RUN_KEY] ?? null;
    },
    async setLastRun(value) {
      await area.set({ [LAST_RUN_KEY]: value });
    },
  };
}
