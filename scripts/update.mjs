#!/usr/bin/env node
// Daily update: fetch English (TCGplayer via tcgcsv) and Japanese (Yuyu-tei) prices
// for every manga rare, then write:
//   public/data/cards.json    current snapshot the website reads
//   public/data/history.json  one price point per card per day (appended)
//
// Run with: npm run update

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllProducts, fetchGroups, fetchLastUpdated, fetchPrices, pickPrice } from './lib/tcgplayer.mjs';
import { fetchYuyuteiManga } from './lib/yuyutei.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { mapLimit, fetchJSON } from './lib/http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CARDS_FILE = path.join(DATA, 'cards.json');
const HISTORY_FILE = path.join(DATA, 'history.json');

const today = new Date().toISOString().slice(0, 10);

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const previous = await readJSON(CARDS_FILE, { cards: [] });
  const history = await readJSON(HISTORY_FILE, { fx: {}, cards: {} });
  const warnings = [];

  // --- Japanese (fetched first: its list decides some English matches) ---
  let jpCards = [];
  try {
    jpCards = await fetchYuyuteiManga();
    console.log(`Yuyu-tei: ${jpCards.length} manga listings`);
    if (jpCards.length === 0) warnings.push('Yuyu-tei returned no manga listings (page layout may have changed).');
  } catch (err) {
    warnings.push(`Yuyu-tei fetch failed: ${err.message}`);
  }

  // --- English ---
  let products = [];
  let enPrices = new Map();
  let tcgUpdated = null;
  try {
    const groups = await fetchGroups();
    products = await fetchAllProducts(groups);
    tcgUpdated = await fetchLastUpdated();
    console.log(`TCGplayer: ${groups.length} sets, ${products.length} products`);
  } catch (err) {
    warnings.push(`TCGplayer catalog fetch failed: ${err.message}`);
  }

  const prevCatalog = previous.cards.map(({ price, ...c }) => c);
  const catalog = buildCatalog(products, jpCards, prevCatalog);

  // Prices only for the sets that hold a tracked card.
  const groupIds = [...new Set(catalog.map((c) => c.en?.groupId).filter(Boolean))];
  try {
    const priceLists = await mapLimit(groupIds, 6, async (gid) => [gid, await fetchPrices(gid)]);
    for (const [, rows] of priceLists) {
      for (const r of rows) {
        if (!enPrices.has(r.productId)) enPrices.set(r.productId, []);
        enPrices.get(r.productId).push(r);
      }
    }
  } catch (err) {
    warnings.push(`TCGplayer price fetch failed: ${err.message}`);
  }

  // --- Exchange rate (ECB reference rate via frankfurter) ---
  let usdJpy = null;
  try {
    const fx = await fetchJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY');
    usdJpy = fx.rates.JPY;
    history.fx[today] = usdJpy;
  } catch (err) {
    const dates = Object.keys(history.fx).sort();
    usdJpy = dates.length ? history.fx[dates.at(-1)] : 150;
    warnings.push(`Exchange rate fetch failed (${err.message}); using ${usdJpy}.`);
  }

  const jpById = new Map(jpCards.map((j) => [`${j.ver}/${j.yuyuteiId}`, j]));

  const cards = catalog.map((c) => {
    const en = c.en ? pickPrice(enPrices.get(c.en.productId)) : null;
    const jpListing = c.jp ? jpById.get(`${c.jp.ver}/${c.jp.yuyuteiId}`) : null;
    const jp = jpListing ? { sell: jpListing.priceJpy, buy: jpListing.buyJpy, stock: jpListing.stock } : null;

    const h = (history.cards[c.id] ??= { en: [], jp: [] });
    if (en && (en.market != null || en.low != null)) upsert(h.en, [today, en.market, en.low]);
    if (jp && (jp.sell != null || jp.buy != null)) upsert(h.jp, [today, jp.sell, jp.buy, jp.stock]);

    return { ...c, price: { en, jp } };
  });

  const out = {
    updatedAt: new Date().toISOString(),
    date: today,
    usdJpy,
    sources: {
      tcgplayer: { via: 'tcgcsv.com', lastUpdated: tcgUpdated },
      yuyutei: { fetched: jpCards.length > 0 },
    },
    warnings,
    cards,
  };

  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(CARDS_FILE, JSON.stringify(out, null, 1));
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history));

  const both = cards.filter((c) => c.en && c.jp).length;
  console.log(`Wrote ${cards.length} cards (${both} with both EN and JP) for ${today}. USD/JPY ${usdJpy}.`);
  for (const w of warnings) console.warn('WARNING:', w);
  if (products.length === 0 && jpCards.length === 0) process.exitCode = 1;
}

// One point per day: replace today's point if the script runs twice.
function upsert(series, point) {
  const i = series.findIndex((p) => p[0] === point[0]);
  if (i >= 0) series[i] = point;
  else {
    series.push(point);
    series.sort((a, b) => a[0].localeCompare(b[0]));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
