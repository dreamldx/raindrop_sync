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
| Direction | One-way: Chrome → Raindrop |
| Auth | Raindrop developer **test token** (single user) |
| Trigger | **Periodic** (`chrome.alarms`) **+ manual** ("Sync now" button) **+ event-driven** (immediate single-op sync on bookmark create/remove) |
| Folder mapping | **Mirror** Chrome folder tree as Raindrop nested collections |
| Dedup | Bookmark identity = **URL within its folder** |
| Deletions/moves | **Full mirror** — add, move, and delete to match Chrome |
| Mirror scope | Confined to a single **root collection** (`Chrome`); the rest of the Raindrop account is never touched |
| Source scope | Always sync the **whole** Chrome tree |
| Sync algorithm | **Stateless reconciliation** — diff live Chrome tree vs live Raindrop subtree each run; no persisted mapping |

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
│   └── sync.js            # orchestrates a run, reports results
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

- **Sync now** button — runs `sync.run()` immediately; disabled with spinner while running.
- **Last-run status** — e.g. "Synced 12 added, 3 deleted · 2 min ago" / "Failed: invalid token".
- **Live progress** — messages from the service worker: "Reading bookmarks… / Fetching Raindrop… / Applying 15 changes…".
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
   collection; fetch its full nested collection subtree + all raindrops within;
   normalize to the same tree shape as step 1.
3. **Diff (`reconcile.js`, pure).** Walk both trees by path → ordered op list:
   - `createCollection(path)` — parent-before-child.
   - `deleteCollection(id)` — child-before-parent.
   - `createRaindrop(url, title, collectionId)`.
   - `moveRaindrop(id, newCollectionId)` — URL under root but in wrong collection.
   - `deleteRaindrop(id)` — raindrop under root with no matching Chrome bookmark.
4. **Apply (`applyOps.js`).** Safe order: create collections → create/move
   raindrops → delete raindrops → delete empty collections. (Deletes last so a
   move never transiently loses data.)
5. **Report.** Tally counts, write `lastRun` to storage, message the popup.

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

## Raindrop API

Base: `https://api.raindrop.io/rest/v1`. Auth: `Authorization: Bearer <token>`.

| Need | Endpoint |
|---|---|
| Verify token / user | `GET /user` |
| Root + nested collections | `GET /collections`, `GET /collections/childrens` |
| Create collection | `POST /collection` (`{ title, parent: { $id } }`) |
| Delete collection | `DELETE /collection/{id}` |
| List raindrops in a collection | `GET /raindrops/{collectionId}` (paged, `perpage=50`, `page`) |
| Create raindrop | `POST /raindrop` (`{ link, title, collection: { $id } }`) |
| Move raindrop | `PUT /raindrop/{id}` (`{ collection: { $id } }`) |
| Delete raindrop | `DELETE /raindrop/{id}` |
| Batch create | `POST /raindrops` (array) where helpful |

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

- **Duplicate sibling folder names** under the same parent are disambiguated by
  order; flagged as a known limitation.
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
