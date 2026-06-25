# Raindrop Bookmark Sync

A Chrome (MV3) extension that mirrors your Chrome bookmark tree into raindrop.io.

## Install (unpacked)
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.

## Set up
1. Get a **test token**: raindrop.io → Settings → Integrations → create an app → **Test token**.
2. Click the extension icon → **Settings**.
3. Paste the token, click **Test connection** (should show "Connected as …").
4. Choose a sync interval, click **Save**.

## Use
- **Sync now** in the popup runs an immediate sync.
- Automatic sync runs on your chosen interval while Chrome is open.
- All bookmarks mirror under a single **Chrome** collection in Raindrop; bookmarks
  removed from Chrome are removed from that collection (full mirror). Collections
  outside **Chrome** are never touched.

## Develop / test
- `npm test` runs the unit tests (`node --test`).
