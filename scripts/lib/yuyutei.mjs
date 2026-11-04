// Japanese prices from Yuyu-tei (遊々亭), a large Japanese card shop.
//
// A search for "スーパーパラレル" (super parallel, the Japanese name for manga rares)
// returns every manga printing. We read two lists:
//   - sell: the shop's asking price (JPY). Yuyu-tei keeps showing the last asking
//     price when a card is sold out (stock "×"), so stock is recorded with it.
//   - buy:  what the shop pays to buy the card from you (JPY). This stays current
//     even when the card is out of stock, so it is the better "live" signal.
//
// Excluded: "海賊団スーパーパラレル" (pirate-crew super parallel), which is a
// different, non-manga art treatment (e.g. OP17-118 Rocks, EB04-061 Luffy).

import { fetchText } from './http.mjs';

const WORD = encodeURIComponent('スーパーパラレル');
const BROWSER_UA = { 'User-Agent': 'Mozilla/5.0 (OnePieceMangaTracker)' };

export async function fetchYuyuteiManga() {
  const sellHtml = await fetchText(`https://yuyu-tei.jp/sell/opc/s/search?search_word=${WORD}`, { headers: BROWSER_UA });
  const buyHtml = await fetchText(`https://yuyu-tei.jp/buy/opc/s/search?search_word=${WORD}`, { headers: BROWSER_UA });
  return mergeSellBuy(parseYuyuteiList(sellHtml, 'sell'), parseYuyuteiList(buyHtml, 'buy'));
}

// Combine sell and buy listings by Yuyu-tei's own card id (ver + id).
export function mergeSellBuy(sell, buy) {
  const byKey = new Map();
  for (const c of sell) byKey.set(`${c.ver}/${c.yuyuteiId}`, { ...c, buyJpy: null });
  for (const b of buy) {
    const key = `${b.ver}/${b.yuyuteiId}`;
    const existing = byKey.get(key);
    if (existing) existing.buyJpy = b.priceJpy;
    else byKey.set(key, { ...b, priceJpy: null, stock: null, buyJpy: b.priceJpy });
  }
  return [...byKey.values()];
}

export function parseYuyuteiList(html, kind) {
  const cards = [];
  // Each product sits in a <div class="card-product ..."> block. The markup has line
  // breaks inside tags, so every pattern uses \s+ rather than literal spaces.
  const parts = html.split(/<div\s+class="card-product/).slice(1);
  for (const block of parts) {
    const link = block.match(/href="https:\/\/yuyu-tei\.jp\/(?:sell|buy)\/opc\/card\/([a-z0-9]+)\/(\d+)"/);
    const alt = block.match(/alt="([A-Z]{2,4}\d{2}-\d{3})\s+(\S+)\s+([^"]+)"/);
    if (!link || !alt) continue;
    const price = block.match(/<strong[^>]*>\s*([\d,]+)\s*円/);
    const stock = block.match(/在庫\s*:\s*(\d+|×)/);
    const img = block.match(/<img\s+src="(https:\/\/card\.yuyu-tei\.jp\/[^"]+)"/);
    const name = alt[3].replace(/）/g, ')').replace(/（/g, '(');

    if (!/スーパーパラレル/.test(name) || /海賊団スーパーパラレル/.test(name)) continue;

    const thumb = img && !/noimage/.test(img[1]) ? img[1] : null;
    cards.push({
      number: alt[1],
      rarity: alt[2],
      nameJa: name,
      baseNameJa: name.replace(/\(.*$/, '').trim(),
      variant: /レッドスーパーパラレル/.test(name) ? 'red-manga' : 'manga',
      // 刻印あり (stamped) = Premium Booster reprint, listed under prb01/prb02.
      stamp: /刻印あり/.test(name) ? 'stamped' : /刻印なし/.test(name) ? 'unstamped' : null,
      ver: link[1],
      yuyuteiId: link[2],
      url: `https://yuyu-tei.jp/sell/opc/card/${link[1]}/${link[2]}`,
      thumb,
      image: thumb ? thumb.replace('/100_140/', '/front/') : null,
      priceJpy: price ? Number(price[1].replace(/,/g, '')) : null,
      stock: kind === 'sell' && stock ? (stock[1] === '×' ? 0 : Number(stock[1])) : null,
    });
  }
  return cards;
}
