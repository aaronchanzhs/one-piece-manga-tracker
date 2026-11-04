// English prices from TCGplayer, read through tcgcsv.com, a free daily mirror of
// TCGplayer's catalog and price data (no API key). One Piece is category 68.
//
// What the prices mean (USD):
//   market: TCGplayer "Market Price", based on recent completed sales. It is null
//           when a card has not sold recently, which is common for $1,000+ cards.
//   low:    lowest current listing.

import { fetchJSON, mapLimit, UA } from './http.mjs';

const BASE = 'https://tcgcsv.com/tcgplayer/68';

export async function fetchGroups() {
  return (await fetchJSON(`${BASE}/groups`)).results;
}

export async function fetchProducts(groupId) {
  return (await fetchJSON(`${BASE}/${groupId}/products`)).results;
}

export async function fetchPrices(groupId) {
  return (await fetchJSON(`${BASE}/${groupId}/prices`)).results;
}

export async function fetchLastUpdated() {
  const res = await fetch('https://tcgcsv.com/last-updated.txt', { headers: { 'User-Agent': UA } });
  return res.ok ? (await res.text()).trim() : null;
}

export const ext = (p, key) => p.extendedData?.find((e) => e.name === key)?.value ?? null;

// Pull every product in every set (~90 requests, run 6 at a time).
export async function fetchAllProducts(groups) {
  const lists = await mapLimit(groups, 6, async (g) => {
    const products = await fetchProducts(g.groupId);
    return products.map((p) => ({ ...p, group: g }));
  });
  return lists.flat();
}

// Pick the price row for a product. Manga cards only come in Foil, but be defensive.
export function pickPrice(rows) {
  if (!rows?.length) return null;
  const row = rows.find((r) => r.subTypeName === 'Foil') ?? rows[0];
  return { market: row.marketPrice ?? null, low: row.lowPrice ?? null, mid: row.midPrice ?? null };
}

// Turn "Monkey.D.Luffy (119) (Alternate Art) (Manga)" or "Sanji - OP06-119 (Manga)" into "Monkey.D.Luffy" / "Sanji".
export function baseName(name) {
  return name.replace(/\s+-\s+[A-Z]{2,4}\d{2}-\d{3}.*$/, '').replace(/\s*\(.*$/, '').trim();
}

export function largeImage(url) {
  // tcgcsv gives ..._200w.jpg; TCGplayer's CDN also serves a larger rendition.
  return url ? url.replace(/_200w\.jpg$/, '_in_1000x1000.jpg') : null;
}
