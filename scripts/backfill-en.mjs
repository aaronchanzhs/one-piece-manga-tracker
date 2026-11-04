#!/usr/bin/env node
// One-time backfill of English price history from tcgcsv.com's daily archives
// (https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z, ~3 MB each,
// available from 2024-02-08). Japanese history cannot be backfilled: Yuyu-tei has no
// archive, so Japanese history starts the first day you run `npm run update`.
//
// Usage:
//   npm run backfill                 weekly points for the last 52 weeks
//   npm run backfill -- --weeks 104  go back further
//   npm run backfill -- --step 1 --weeks 8   daily points for the last 8 weeks
//
// Run `npm run update` first so public/data/cards.json exists.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sevenBin from '7zip-bin';
import { fetchJSON, mapLimit, UA } from './lib/http.mjs';
import { pickPrice } from './lib/tcgplayer.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS_FILE = path.join(ROOT, 'public', 'data', 'cards.json');
const HISTORY_FILE = path.join(ROOT, 'public', 'data', 'history.json');
const FIRST_ARCHIVE = '2024-02-08';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const weeks = arg('weeks', 52);
const step = arg('step', 7); // days between points

async function main() {
  const cards = JSON.parse(await fs.readFile(CARDS_FILE, 'utf8')).cards;
  const history = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
  const tracked = cards.filter((c) => c.en);
  const groupIds = [...new Set(tracked.map((c) => c.en.groupId))];

  const dates = [];
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // archives appear a day later
  for (let d = new Date(end); dates.length < Math.ceil((weeks * 7) / step); d.setUTCDate(d.getUTCDate() - step)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso < FIRST_ARCHIVE) break;
    dates.push(iso);
  }
  // Skip dates we already have for every tracked card.
  const todo = dates.filter((date) => tracked.some((c) => !history.cards[c.id]?.en?.some((p) => p[0] === date)));
  console.log(`Backfilling ${todo.length} dates (${todo.at(-1)} … ${todo[0]}) for ${tracked.length} English cards.`);

  await fs.chmod(sevenBin.path7za, 0o755).catch(() => {});
  let done = 0;

  await mapLimit(todo, 3, async (date) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `op-archive-${date}-`));
    try {
      const file = path.join(dir, 'prices.7z');
      const res = await fetch(`https://tcgcsv.com/archive/tcgplayer/prices-${date}.ppmd.7z`, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
      const patterns = groupIds.map((g) => `${date}/68/${g}/prices`);
      await run(sevenBin.path7za, ['x', '-y', `-o${dir}`, file, ...patterns], { maxBuffer: 1 << 24 });

      const rowsByProduct = new Map();
      for (const g of groupIds) {
        let json;
        try {
          json = JSON.parse(await fs.readFile(path.join(dir, date, '68', String(g), 'prices'), 'utf8'));
        } catch {
          continue; // set did not exist yet on this date
        }
        for (const r of json.results ?? json) {
          if (!rowsByProduct.has(r.productId)) rowsByProduct.set(r.productId, []);
          rowsByProduct.get(r.productId).push(r);
        }
      }
      for (const c of tracked) {
        const price = pickPrice(rowsByProduct.get(c.en.productId));
        if (!price || (price.market == null && price.low == null)) continue;
        const h = (history.cards[c.id] ??= { en: [], jp: [] });
        if (!h.en.some((p) => p[0] === date)) h.en.push([date, price.market, price.low]);
      }
      console.log(`  ${date} ok (${++done}/${todo.length})`);
    } catch (err) {
      console.warn(`  ${date} skipped: ${err.message}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  for (const h of Object.values(history.cards)) h.en.sort((a, b) => a[0].localeCompare(b[0]));

  // Exchange-rate history for the same window (ECB reference rates).
  if (todo.length) {
    try {
      const fx = await fetchJSON(`https://api.frankfurter.dev/v1/${todo.at(-1)}..?base=USD&symbols=JPY`);
      for (const [d, r] of Object.entries(fx.rates)) history.fx[d] ??= r.JPY;
    } catch (err) {
      console.warn('Exchange-rate history skipped:', err.message);
    }
  }

  await fs.writeFile(HISTORY_FILE, JSON.stringify(history));
  console.log('History saved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
