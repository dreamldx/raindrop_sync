// src/raindropApi.js
const BASE = 'https://api.raindrop.io/rest/v1';
const MIN_SPACING_MS = 500; // <=120 req/min (the binding Raindrop limit)
const MAX_PER_SEC = 50;     // hard burst ceiling
const MAX_RETRIES = 3;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Classic token bucket. Capacity = ratePerSec, refilled continuously at
 * ratePerSec tokens/sec. acquire() consumes one token, sleeping only if empty.
 */
export function createTokenBucket({ ratePerSec, now = () => Date.now(), sleep = defaultSleep }) {
  let tokens = ratePerSec;
  let lastRefill = now();

  function refill() {
    const nowMs = now();
    const elapsedSec = (nowMs - lastRefill) / 1000;
    tokens = Math.min(ratePerSec, tokens + elapsedSec * ratePerSec);
    lastRefill = nowMs;
  }

  return {
    async acquire() {
      refill();
      if (tokens < 1) {
        const waitMs = Math.ceil(((1 - tokens) / ratePerSec) * 1000);
        await sleep(waitMs);
        refill();
      }
      tokens -= 1;
    },
  };
}

export function createRaindropApi({ token, fetchImpl = fetch, now = () => Date.now(), sleep = defaultSleep }) {
  let lastRequestAt = 0;
  const bucket = createTokenBucket({ ratePerSec: MAX_PER_SEC, now, sleep });

  async function throttle() {
    const wait = lastRequestAt + MIN_SPACING_MS - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  async function request(method, path, body) {
    let attempt = 0;
    while (true) {
      await bucket.acquire(); // burst ceiling (50/sec)
      await throttle();       // pacing floor (<=120/min)
      const res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 1;
        await sleep(retryAfter * 1000);
        attempt += 1;
        continue;
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        attempt += 1;
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Raindrop ${method} ${path} failed: ${res.status} ${text}`);
      }
      if (res.status === 204) return null;
      return res.json();
    }
  }

  return {
    async getUser() {
      const data = await request('GET', '/user');
      return { fullName: data.user.fullName };
    },
    async getRootCollections() {
      const data = await request('GET', '/collections');
      return data.items;
    },
    async getChildCollections() {
      const data = await request('GET', '/collections/childrens');
      return data.items;
    },
    async createCollection(title, parentId) {
      const body = parentId ? { title, parent: { $id: parentId } } : { title };
      const data = await request('POST', '/collection', body);
      return data.item;
    },
    async deleteCollection(id) {
      await request('DELETE', `/collection/${id}`);
    },
    // Page through GET /raindrops/{collectionId} (perpage max is 50).
    async getRaindrops(collectionId) {
      const out = [];
      let page = 0;
      while (true) {
        const data = await request('GET', `/raindrops/${collectionId}?perpage=50&page=${page}`);
        const items = data.items ?? [];
        out.push(...items);
        if (items.length < 50) break;
        page += 1;
      }
      return out;
    },
    // Fetch ALL raindrops across the account in one paginated sweep (collection 0
    // is Raindrop's "all" meta-collection). Each item carries `collectionId`, so a
    // full sync can bucket locally instead of querying every collection separately.
    async getAllRaindrops() {
      return this.getRaindrops(0);
    },
    async createRaindrop({ link, title, collectionId }) {
      const data = await request('POST', '/raindrop', { link, title, collection: { $id: collectionId } });
      return data.item;
    },
    async moveRaindrop(id, collectionId) {
      await request('PUT', `/raindrop/${id}`, { collection: { $id: collectionId } });
    },
    async deleteRaindrop(id) {
      await request('DELETE', `/raindrop/${id}`);
    },
  };
}
