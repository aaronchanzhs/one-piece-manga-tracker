// Tests for the rules that decide what counts as a manga rare and how English and
// Japanese printings are paired. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, cardId } from '../scripts/lib/catalog.mjs';
import { parseYuyuteiList, mergeSellBuy } from '../scripts/lib/yuyutei.mjs';
import { baseName } from '../scripts/lib/tcgplayer.mjs';

const group = (groupId, abbreviation, name) => ({ groupId, abbreviation, name, publishedOn: '2025-01-01T00:00:00' });
const OP05 = group(1, 'OP05', 'Awakening of the New Era');
const OP13 = group(2, 'OP13', 'Carrying On His Will');
const OP17 = group(3, 'OP17', "The World's Strongest Warriors");
const PRB = group(4, 'PRB-01', 'Premium Booster -The Best-');
const PROMO = group(5, 'OP-PR', 'One Piece Promotion Cards');

let pid = 100;
const product = (g, name, number, rarity = 'SEC') => ({
  productId: pid++,
  name,
  url: `https://www.tcgplayer.com/product/${pid}`,
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_200w.jpg`,
  extendedData: [
    { name: 'Number', value: number },
    { name: 'Rarity', value: rarity },
  ],
  group: g,
});

const jp = (number, variant, ver, extra = {}) => ({
  number, variant, ver, yuyuteiId: String(pid++), stamp: null, rarity: 'P-SEC', baseNameJa: 'テスト', nameJa: 'テスト', ...extra,
});

test('explicit (Manga) products are tracked; DON!! and plain arts are not', () => {
  const products = [
    product(OP05, 'Monkey.D.Luffy (119) (Alternate Art) (Manga)', 'OP05-119'),
    product(OP05, 'Monkey.D.Luffy (119) (Alternate Art)', 'OP05-119'),
    product(OP05, 'DON!! Card (Manga) (Double Pack Set Volume 2)', 'OP05-DON', 'DON!!'),
  ];
  const cards = buildCatalog(products, []);
  assert.deepEqual(cards.map((c) => c.id), ['OP05-119']);
  assert.equal(cards[0].name, 'Monkey.D.Luffy');
});

test('OP13 super alt arts count as manga only when Yuyu-tei confirms a super parallel', () => {
  const products = [
    product(OP13, 'Monkey.D.Luffy (118) (Super Alternate Art)', 'OP13-118'),
    product(OP13, 'Monkey.D.Luffy (118) (Red Super Alternate Art)', 'OP13-118'),
    product(OP17, 'Rocks.D.Xebec (118) (Super Alternate Art)', 'OP17-118'), // pirate-crew art, not manga
  ];
  const jpCards = [jp('OP13-118', 'manga', 'op13'), jp('OP13-118', 'red-manga', 'op13')];
  const ids = buildCatalog(products, jpCards).map((c) => c.id);
  assert.deepEqual(ids, ['OP13-118', 'OP13-118-red']);
});

test('an explicit (Manga) product beats a same-number Super Alternate Art (OP17-062 Kaido)', () => {
  const manga = product(OP17, 'Kaido (062) (Manga)', 'OP17-062', 'SR');
  const superArt = product(OP17, 'Kaido (062) (Super Alternate Art)', 'OP17-062', 'SR');
  for (const order of [[manga, superArt], [superArt, manga]]) {
    const cards = buildCatalog(order, [jp('OP17-062', 'manga', 'op17')]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].en.productId, manga.productId);
  }
});

test('Premium Booster reprints are separate cards and pair with stamped / prb Japanese listings', () => {
  const products = [
    product(group(6, 'OP01', 'Romance Dawn'), 'Shanks (Parallel) (Manga) (Alternate Art)', 'OP01-120'),
    product(PRB, 'Shanks (Manga)', 'OP01-120'),
  ];
  const jpCards = [
    jp('OP01-120', 'manga', 'op01', { stamp: 'unstamped' }),
    jp('OP01-120', 'manga', 'prb01', { stamp: 'stamped' }),
  ];
  const cards = buildCatalog(products, jpCards);
  assert.deepEqual(cards.map((c) => c.id), ['OP01-120', 'OP01-120-prb']);
  assert.equal(cards[0].jp.ver, 'op01');
  assert.equal(cards[1].jp.ver, 'prb01');
});

test('set names ignore promo groups', () => {
  const products = [
    product(PROMO, 'Gol.D.Roger - OP09-118 (Promo)', 'OP09-118'),
    product(group(7, 'OP09', 'Emperors in the New World'), 'Gol.D.Roger (Manga)', 'OP09-118'),
    product(group(7, 'OP09', 'Emperors in the New World'), 'Buggy (051)', 'OP09-051'),
  ];
  assert.equal(buildCatalog(products, [])[0].setName, 'Emperors in the New World');
});

test('cards tracked before are kept when a source has a bad day', () => {
  const previous = [{ id: 'OP05-119', number: 'OP05-119', en: { productId: 1 }, jp: null, name: 'Monkey.D.Luffy' }];
  const cards = buildCatalog([], [], previous);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].stale, true);
});

test('cardId and baseName', () => {
  assert.equal(cardId('OP13-118', 'red-manga', 'original'), 'OP13-118-red');
  assert.equal(cardId('OP06-119', 'manga', 'reprint'), 'OP06-119-prb');
  assert.equal(baseName('Sanji - OP06-119 (Manga)'), 'Sanji');
  assert.equal(baseName('Eustass"Captain"Kid (Alternate Art) (Manga)'), 'Eustass"Captain"Kid');
});

// Synthetic markup shaped like Yuyu-tei's listing (line breaks inside tags included).
const yyt = (path, alt, price, stock) => `<div
 class="card-product position-relative mt-4 sold-out "><a href="https://yuyu-tei.jp/${path}"><div class="position-relative product-img"> <img
 src="https://card.yuyu-tei.jp/opc/100_140/${path.split('/').slice(-2).join('/')}.jpg" alt="${alt}" class="card img-fluid"/></div></a>
 <strong class="d-block text-end "> ${price} 円 </strong>${stock != null ? `<label class="cart_sell_zaiko"> 在庫 : ${stock} </label>` : ''}</div>`;

test('Yuyu-tei parser: sell + buy merge, pirate-crew variant excluded, stock parsed', () => {
  const sell =
    yyt('sell/opc/card/op05/10146', 'OP05-119 P-SEC モンキー・D・ルフィ(パラレル)(スーパーパラレル)', '598,000', '×') +
    yyt('sell/opc/card/op13/10154', 'OP13-118 P-SEC モンキー・D・ルフィ(パラレル)(レッドスーパーパラレル)', '1,280,000', '2 点') +
    yyt('sell/opc/card/op17/10156', 'OP17-118 P-SEC ロックス・D・ジーベック(パラレル)(海賊団スーパーパラレル)', '99,800', '×');
  const buy = yyt('buy/opc/card/op05/10146', 'OP05-119 P-SEC モンキー・D・ルフィ(パラレル)(スーパーパラレル)', '400,000', null);
  const cards = mergeSellBuy(parseYuyuteiList(sell, 'sell'), parseYuyuteiList(buy, 'buy'));
  assert.equal(cards.length, 2);
  const luffy = cards.find((c) => c.number === 'OP05-119');
  assert.equal(luffy.priceJpy, 598000);
  assert.equal(luffy.buyJpy, 400000);
  assert.equal(luffy.stock, 0);
  assert.equal(luffy.baseNameJa, 'モンキー・D・ルフィ');
  const red = cards.find((c) => c.number === 'OP13-118');
  assert.equal(red.variant, 'red-manga');
  assert.equal(red.stock, 2);
});
