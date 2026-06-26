# Chrome → Raindrop.io Bookmark Sync — Design

**Date:** 2026-06-25
**Status:** Approved (design)

## Summary

A Manifest V3 Chrome extension that mirrors the Chrome bookmark tree into
raindrop.io. Sync is **one-way** (Chrome → Raindrop), runs **periodically** (and
on demand via a manual button), and performs a **full mirror** scoped under a
single Raindrop **root collection** (`Chrome`). Authentication uses a personal
Raindrop **developer test token** (single user, no OAuth).

## Decisions

| Topic | Decision |
|---|---|
| Direction | Forward (automatic/live): Chrome → Raindrop. Plus an on-demand **reverse full-mirror** button: Raindrop → Chrome (writes Chrome bookmarks, mapping Raindrop containers back to Chrome's real Bookmarks Bar / Other / Mobile) |
| Auth | Raindrop developer **test token** (single user) |
| Trigger | **Periodic** (`chrome.alarms`) **+ manual** ("Sync now" button) **+ event-driven** (immediate single-op sync on bookmark create/remove) |
| Folder mapping | **Mirror** Chrome folder tree as Raindrop nested collections |
| Dedup | Bookmark identity = **URL within its folder** |
| Deletions/moves | **Full mirror** — add, move, and delete to match Chrome |
| Mirror scope | Confined to a single **root collection** (`Chrome`); the rest of the Raindrop account is never touched |
| Source scope | Always sync the **whole** Chrome tree |
| Sync algorithm | **Stateless reconciliation** for the full sync — diff live Chrome tree vs live Raindrop subtree each run. A `chromeFolderId → collectionId` **folder map** is persisted in `chrome.storage.local` (rebuilt every full sync) purely so live single-ops resolve the exact collection by folder id |

## Architecture

Manifest V3, plain JS ES modules, no build step.

```
RaindropBookmarkSync/
├── manifest.json          # MV3; permissions: bookmarks, alarms, storage
├── background.js          # service worker: alarm handler + sync orchestration
├── src/
│   ├── chromeTree.js      # read & normalize chrome.bookmarks tree
│   ├── raindropApi.js     # Raindrop REST client (auth, rate-limit, retry)
│   ├── raindropTree.js    # fetch & normalize Raindrop subtree under root
│   ├── reconcile.js       # PURE diff: desired (Chrome) vs actual (Raindrop) -> ops
│   ├── applyOps.js        # execute create/move/delete ops via the API
│   ├── incremental.js     # single-op handlers for bookmark create/remove events
│   ├── sync.js            # orchestrates a forward run, reports results
│   ├── chromeActual.js    # normalize live Chrome tree → model (for reverse sync)
│   ├── chromeAdapter.js   # chrome.bookmarks behind the Raindrop-API shape
│   └── reverseSync.js     # Raindrop → Chrome full mirror (reuses reconcile+applyOps)
├── material.css           # shared hand-rolled Material Design 3 styles (no deps)
├── options.html / options.js   # token, test connection, root collection, interval
├── popup.html / popup.js       # "Sync now", last-run status, live progress
└── test/                  # unit tests for reconcile (pure, no network)
```

Boundaries:
- **`reconcile.js` is pure** — two plain-object trees in, ordered op list out. No
  Chrome APIs, no network. The hardest logic, tested in isolation.
- **`raindropApi.js`** is the only module that performs HTTP.
- The service worker is thin glue: alarm/button/bookmark-event → enqueue work on a
  single serialized queue (`sync.run()` for full syncs, `incremental.js` handlers
  for single ops).

## UI styling — Material Design 3

Both pages share `material.css`, a hand-rolled Material Design 3 stylesheet: zero
dependencies, no build step, fully local (CSP-safe under `script-src 'self'`). It
provides MD3 color-role tokens with light **and** dark schemes
(`prefers-color-scheme`), elevation, filled/tonal/text buttons with state layers,
outlined text fields with floating labels, an outlined select, and a spinner.
Roboto leads the font stack with a `system-ui` fallback (no remote fonts; Roboto
can be vendored locally later). The official Material Web Components were rejected
because they require bundling (lit + `@material/web`), which conflicts with the
no-build-step principle.

## Settings UI (`options.html` / `options.js`)

| Field | Purpose | Default |
|---|---|---|
| Raindrop test token | From raindrop.io/settings/integrations. Stored in `chrome.storage.local` (not synced storage). Masked with show/hide toggle. | empty |
| Test connection | `GET /rest/v1/user`; shows "Connected as <name>" or error. | — |
| Root collection | Collection the Chrome tree mirrors under; auto-created if missing. | `Chrome` |
| Sync interval | Dropdown: Manual only, 5m, 10m, 30m (default), 1h, 6h, 12h. Stored as minutes. | 30m |
| Save | Persists settings, reschedules the alarm. | — |

- If no token is set, the popup shows "Set your token in Settings" and disables
  "Sync now".
- `chrome.alarms` is best-effort for short intervals: if Chrome is closed when an
  alarm is due, it fires once on next startup.

## Popup UI (`popup.html` / `popup.js`)

- **Sync to Raindrop** button — runs the forward `sync.run()` immediately; shows a
  spinner and is **disabled while *any* sync is running** — manual, alarm, or
  live-event fallback. The service worker broadcasts `sync-start`/`synced` and
  answers a `get-state` query, so a popup opened mid-sync starts disabled too.
- **Sync from Raindrop** button — runs the **reverse** full-mirror (Raindrop →
  Chrome) after a `confirm()` warning (it can delete Chrome bookmarks). Both
  buttons disable together while either direction runs.
- **Last-run status** — e.g. "Added 12, moved 3, deleted 1 · 2 min ago" / "Failed: invalid token".
- **Live progress** — staged messages from the service worker: "Reading Chrome
  bookmarks… → Fetching Raindrop collections… → Applying N changes… (or 'Already
  up to date…') → Finishing up…".
- **Settings** link → opens `options.html`.

Manual and periodic both funnel through the same `sync.run()` path.

## Data Flow — `sync.run()`

1. **Read desired state (Chrome).** `chrome.bookmarks.getTree()` → normalized
   tree: folders `{ path, title, children }`, bookmarks `{ url, title }`.
   - Folder identity = **path** (e.g. `Chrome / Bookmarks Bar / Dev`).
   - Bookmark identity = **URL within its folder**. Same URL in two folders → two
     raindrops. Duplicate URL in the same folder collapses to one.
   - **URL validation:** only parseable `http(s)` links are kept. Non-web bookmark
     URLs (`javascript:`, `chrome://`, `chrome-extension://`, `about:`, `file://`,
     `data:`, `ftp:`, malformed/empty) are **skipped** so they're never posted to
     Raindrop. Enforced by `isValidBookmarkUrl` (`src/url.js`) at both post entry
     points: `buildDesiredTree` (periodic) and `applyBookmarkCreated` (event-driven).
2. **Read actual state (Raindrop).** Locate (or create) the `Chrome` root
   collection; fetch its full nested collection subtree; fetch **all** raindrops
   in one batch sweep (`GET /raindrops/0`) and bucket by `collectionId`;
   normalize to the same tree shape as step 1. (Batch fetch keeps request count
   independent of the number of collections, easing the 120 req/min limit.)
3. **Diff (`reconcile.js`, pure).** Walk both trees by path → ordered op list:
   - `createCollection(path)` — parent-before-child.
   - `deleteCollection(id)` — child-before-parent.
   - `createRaindrop(url, title, collectionId)`.
   - `moveRaindrop(id, newCollectionId)` — URL under root but in wrong collection.
   - `deleteRaindrop(id)` — raindrop under root with no matching Chrome bookmark.
4. **Apply (`applyOps.js`).** Safe order: create collections → create/move
   raindrops → delete raindrops → delete empty collections. (Deletes last so a
   move never transiently loses data.) Collections are created sequentially
   (parent before child); raindrop ops are **batched** to cut request count:
   creates via `POST /raindrops` (chunks of 100), moves grouped by source→target
   collection via `PUT /raindrops/{source}`, deletes grouped by source collection
   via `DELETE /raindrops/{source}`.
5. **Report.** Tally counts, write `lastRun` to storage, **rebuild the folder map**
   (see below), and message the popup.

### Collection icons

Every collection the sync creates inherits the **root collection's `cover`** (its
icon). `findOrCreateRoot` returns the root's `cover` array and `applyOps` passes it
to each `createCollection`, so the mirrored tree shares one consistent icon. (Only
applied at creation time; existing collections keep their covers.)

### Folder map (`chromeFolderId → collectionId`)

After applying ops, `applyOps` returns its `pathKey → collectionId` map; `sync.js`
walks the desired tree (whose folder nodes carry `chromeId`) to build a
`{ [chromeFolderId]: collectionId }` map and the service worker persists it in
`chrome.storage.local`. This is the one piece of persisted state. The full sync
remains stateless (it's derived fresh each run and is the source of truth); the
map exists so **live single-ops can resolve the exact collection by Chrome folder
id**, which makes duplicate-named folders unambiguous without title/order
guessing. A stale map just causes a one-time fallback to full sync, which rebuilds
it.

## Event-Driven Incremental Sync (`incremental.js`)

For immediacy, the extension also listens to Chrome bookmark events and performs a
single targeted Raindrop op per event — no full tree read. Scope (per user
decision): **create** and **remove** only. **Changed/moved** are intentionally not
event-handled; they reconcile on the next periodic full sync.

- **`onCreated`** (bookmark): resolve the bookmark's folder path from its parent
  chain, find-or-create that collection chain under the root, then create the
  raindrop (deduped by URL within the collection). Folder-only creates are ignored
  — collections are created lazily when a bookmark lands in them.
- **`onRemoved`** (bookmark): resolve the collection (without creating), find the
  raindrop by URL, delete it. **(folder):** resolve and delete that collection
  (Raindrop cascades nested raindrops).
- Like the full sync, these handlers resolve the Raindrop side live (stateless — no
  persisted id map).

**Serialization & bursts.** The service worker funnels *all* work — full syncs and
single ops — through one serialized queue, so they never overlap or race the rate
limiter. During a **bulk import** (`onImportBegan`/`onImportEnded`) per-event
handling is suspended; one full `sync.run()` runs when the import ends. A failed
single op is harmless: the next periodic full sync re-reconciles and self-heals.

**Collection resolution via the folder map.** A live op resolves its target
collection by `folderMap[node.parentId]` — the exact Chrome-folder-id →
collection-id mapping rebuilt by each full sync. This makes duplicate-named
folders unambiguous (the folder id, not the title, picks the collection). If the
folder isn't in the map yet (a brand-new folder), or a *folder* was removed, the
handler returns `{ fallback: true }` and the service worker runs a full
`sync.run()` instead (which creates/deletes the collection and refreshes the map).

## Reverse Sync (Raindrop → Chrome), on demand

A **Sync from Raindrop** button performs a **full mirror** in the other direction:
make the Chrome bookmark tree match the Raindrop tree under the root collection.
It reuses the same engine by flipping the roles:

- `chromeActual.js` normalizes the live Chrome tree into the model shape (folders
  carry `collectionId` = Chrome folder id, bookmarks carry `raindropId` = Chrome
  bookmark id), with the same id-sort/disambiguation and URL filtering as the
  forward direction (so non-web bookmarks are left untouched, never deleted).
- `reconcile(raindropTree, chromeActual)` — Raindrop is **desired**, Chrome is
  **actual** — yields the op list to bring Chrome in line.
- `applyOps` drives those ops through `chromeAdapter.js`, which implements the
  Raindrop-API shape against `chrome.bookmarks`. Two Chrome rules: the rootless
  root (`'0'`) can't hold children, so folders destined for it go under **Other
  Bookmarks**; and the root containers (`'0'`/`'1'`/`'2'`/`'3'`) are **never
  deleted** (their stray bookmarks still are, per full mirror).
- Afterwards the **folder map is rebuilt** (chromeFolderId → collectionId) from
  the Raindrop tree + resolved paths, so the forward/live paths recognize the
  folders just written.
- While it runs, live forward events are **suppressed** (`suppressEvents`) so the
  writes don't bounce back as Chrome→Raindrop ops. The popup `confirm()`s first
  because it can delete Chrome bookmarks.

## Raindrop API

Base: `https://api.raindrop.io/rest/v1`. Auth: `Authorization: Bearer <token>`.

| Need | Endpoint |
|---|---|
| Verify token / user | `GET /user` |
| Root + nested collections | `GET /collections`, `GET /collections/childrens` |
| Create collection | `POST /collection` (`{ title, parent: { $id } }`) |
| Delete collection | `DELETE /collection/{id}` |
| List raindrops in a collection | `GET /raindrops/{collectionId}` (paged, `perpage=50`, `page`) — used by incremental single-op lookups |
| List ALL raindrops (batch) | `GET /raindrops/0` (the "all" meta-collection, paged) — full sync fetches every raindrop in one sweep and buckets by `collectionId`, so request count is independent of collection count |
| Create raindrop (single) | `POST /raindrop` (`{ link, title, collection: { $id } }`) — used by live add |
| Delete raindrop (single) | `DELETE /raindrop/{id}` — used by live remove |
| **Batch create** | `POST /raindrops` (`{ items: [...] }`, ≤100) — full sync |
| **Batch move** | `PUT /raindrops/{sourceCollectionId}` (`{ ids, collection: { $id } }`) — full sync |
| **Batch delete** | `DELETE /raindrops/{sourceCollectionId}` (`{ ids }`) — full sync |

### Rate limiting & retry
- `raindropApi.js` applies **two** client-side controls before every request:
  - a **50 req/sec token bucket** as a hard burst ceiling, and
  - a **500 ms minimum spacing** (≤ **120 requests/minute**, the binding limit per
    Raindrop's docs).
  In normal operation the per-minute spacing binds; the token bucket only guards
  against accidental bursts.
- On HTTP **429**, honor `Retry-After` and back off.
- Transient 5xx → exponential backoff, capped retries.
- Prefer batch/paged reads to minimize request count.

## Error Handling

- **No / invalid token** → surface in popup and options ("Test connection"
  catches it early); skip the run, don't throw uncaught.
- **Partial failure mid-apply** → because sync is stateless, the next run
  re-reconciles and self-heals; ops are ordered so a failure can't delete data
  that hasn't been re-created. Log which op failed.
- **Network offline** → mark run failed with a clear message; alarm retries next interval.
- **Reconciliation is computed before any destructive op**, so deletes only ever
  target items confirmed absent from Chrome and present under the root collection.

## Known Edge Cases

- **Duplicate sibling folder names** under the same parent are supported: each
  becomes its own Raindrop collection (keeping the real name). The full sync gives
  them distinct identities via a disambiguated path component (`Work`, `Work (2)`,
  …, `disambiguateNames` in `src/treeModel.js`) computed the same way on both
  sides — Chrome siblings sorted by node `id`, Raindrop siblings by collection
  `_id`. Live single-ops sidestep the ambiguity entirely by resolving the
  collection through the persisted **folder map** (Chrome folder id → collection
  id), so an add/remove always hits the right one of the same-named collections.
- **Very deep nesting** — Raindrop nested collections are supported but deep trees
  may hit practical limits; document if encountered.
- **Title-only edits are not synced.** Bookmark identity is URL-within-folder, so
  changing only a bookmark's title (URL and folder unchanged) produces no diff op
  and is not propagated. URL changes are handled as delete+create; folder moves as
  a move op. Adding an in-place `updateRaindrop` op would close this gap if needed.
- `chrome.alarms` timing is best-effort (see Settings note).

## Testing

- **`reconcile.js` unit tests** (pure, no network) are the priority — cover: empty
  → populated, add/move/delete bookmarks, create/delete collections, nested
  moves, duplicate URLs, op ordering invariants.
- **`raindropApi.js`** tested against a mocked `fetch` (throttle, 429 backoff,
  pagination).
- Manual end-to-end check against a real test token and a throwaway `Chrome`
  collection.

## Non-Goals (YAGNI)

- Two-way sync / pulling Raindrop changes back into Chrome.
- OAuth / multi-user.
- Syncing tags, notes, highlights, or favicons beyond title + URL.
- Mirroring outside the root collection.
