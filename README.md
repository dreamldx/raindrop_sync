# Raindrop Bookmark Sync

A Chrome (Manifest V3) extension that syncs your Chrome bookmarks with
[raindrop.io](https://raindrop.io) — automatically pushing Chrome → Raindrop, with
an on-demand pull the other way.

## Features

- **Chrome → Raindrop (automatic).** Mirrors your whole Chrome bookmark tree under
  a single root collection (default **Chrome**). Folder hierarchy is preserved as
  nested collections; bookmarks become raindrops.
  - **Periodic** (configurable interval), **manual** ("Sync to Raindrop" button),
    and **live** — adds/removes sync the moment you make them.
  - **Full mirror**, confined to the root collection: bookmarks removed in Chrome
    are removed from Raindrop. Collections outside the root are never touched.
- **Raindrop → Chrome (on demand).** "Sync from Raindrop" makes Chrome match your
  Raindrop tree (full mirror), mapping Raindrop's containers back to Chrome's real
  **Bookmarks Bar / Other / Mobile**. Asks for confirmation first (it can delete
  Chrome bookmarks). Chrome's root folders are never deleted.
- **Robust to edge cases**:
  - Same-named sibling folders become distinct collections, matched by id order
    and pinned by a persisted `chromeFolderId → collectionId` map.
  - Non-web URLs (`javascript:`, `chrome://`, `file://`, …) are skipped.
  - Created collections inherit the root collection's icon.
- **Efficient**: batched create/move/delete and a single "all raindrops" fetch
  keep requests well under Raindrop's 120 req/min limit.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.

## Set up

1. Get a **test token**: raindrop.io → **Settings → Integrations** → create an app
   → **Test token**.
2. Click the extension icon → **Settings**.
3. Paste the token and click **Test connection** (should show "Connected as …").
4. Choose a **root collection** name and a **sync interval**, then **Save**.

## Use

- **Sync to Raindrop** — push Chrome → Raindrop now (also runs automatically on
  the interval and on live bookmark changes).
- **Sync from Raindrop** — pull Raindrop → Chrome (full mirror; confirms first).
- The popup shows live progress and the last run's result.

## Permissions

`bookmarks`, `alarms`, `storage`, and host access to `https://api.raindrop.io/*`.
The token is stored in `chrome.storage.local` (not synced storage).

## Develop / test

- `npm test` runs the unit tests (Node's built-in `node --test`; no network).
- Design notes live in `docs/superpowers/specs/`.

## License

Personal project — no license specified.
