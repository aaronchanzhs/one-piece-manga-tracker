// Small fetch helpers shared by the data scripts. Node 18+ has fetch built in.

export const UA = 'OnePieceMangaTracker/1.0 (+personal price tracker)';

export async function fetchText(url, { retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchJSON(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run async fn over items with a fixed number in flight at once.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
