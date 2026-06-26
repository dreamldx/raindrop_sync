const DEFAULTS = { token: '', rootCollection: 'Chrome', intervalMinutes: 30 };
const SETTINGS_KEY = 'settings';
const LAST_RUN_KEY = 'lastRun';
const FOLDER_MAP_KEY = 'folderMap';

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
    // Persistent { [chromeFolderId]: raindropCollectionId } map, rebuilt by each
    // full sync and used by live single-ops to resolve the exact collection.
    async getFolderMap() {
      const got = await area.get(FOLDER_MAP_KEY);
      return got[FOLDER_MAP_KEY] ?? {};
    },
    async setFolderMap(map) {
      await area.set({ [FOLDER_MAP_KEY]: map });
    },
  };
}
