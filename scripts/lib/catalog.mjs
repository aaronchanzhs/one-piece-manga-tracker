// Decides which cards are manga rares and pairs English and Japanese printings.
//
// English (TCGplayer) is a manga rare when:
//   1. its name contains "(Manga)" (DON!! cards excluded), or
//   2. it is a "Super Alternate Art" / "Red Super Alternate Art" / "Super Leader Alternate Art"
//      AND Yuyu-tei lists a manga super parallel for the same card number. TCGplayer
//      dropped the "(Manga)" label for these (OP13 Luffy/Ace/Sabo, OP17-079 Luffy,
//      EB05-010 Robin). The Yuyu-tei check keeps out non-manga super arts such as
//      OP17-118 Rocks, whose Japanese version is a 海賊団 (pirate-crew) super parallel.
//
// Pairing key: card number + variant (manga / red-manga) + print (original / reprint).
// "reprint" = Premium Booster (PRB-01 / PRB-02) printings. On Yuyu-tei those are the
// 刻印あり (stamped) versions or are listed under the prb01/prb02 set code.

import { baseName, ext, largeImage } from './tcgplayer.mjs';

export function isEnglishMangaName(name, rarity) {
  return rarity !== 'DON!!' && /\(Manga\)/i.test(name) && !/^DON!!/.test(name);
}

const SUPER_ART = /\((Red )?Super (Leader )?Alternate Art\)/;

export function enVariant(name) {
  return /Red Super Alternate Art|Red Manga/i.test(name) ? 'red-manga' : 'manga';
}

export function enPrint(group) {
  return /^PRB/i.test(group.abbreviation) ? 'reprint' : 'original';
}

export function jpPrint(card) {
  if (card.stamp === 'stamped') return 'reprint';
  if (card.stamp === 'unstamped') return 'original';
  return /^prb/.test(card.ver) ? 'reprint' : 'original';
}

export const cardId = (number, variant, print) =>
  [number, variant === 'red-manga' ? 'red' : null, print === 'reprint' ? 'prb' : null].filter(Boolean).join('-');

const setCode = (number) => number.split('-')[0];

/**
 * Build the list of tracked cards.
 * @param products all TCGplayer products, each with .group attached
 * @param jpCards Yuyu-tei manga listings (may be empty if Yuyu-tei failed)
 * @param previous previous catalog (array) so cards never silently disappear when a source has a bad day
 */
export function buildCatalog(products, jpCards, previous = []) {
  const jpKeys = new Set(jpCards.map((c) => `${c.number}|${c.variant}`));
  const prevEnIds = new Set(previous.filter((c) => c.en).map((c) => c.en.productId));

  // Set names come from the main English booster/deck set holding the most cards with
  // that prefix. Promo, pre-release, event and reprint groups ("OP-PR", "OP05 ANN",
  // "OP18 RE", "PRB-01") are skipped, or they would name sets like "Promotion Cards".
  const counts = {};
  for (const p of products) {
    const num = ext(p, 'Number');
    const abbr = p.group.abbreviation ?? '';
    if (!num || /\s/.test(abbr) || !/\d/.test(abbr) || /^PRB/.test(abbr)) continue;
    const code = setCode(num);
    const key = `${code}|${p.group.name}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const setNames = {};
  for (const [key, n] of Object.entries(counts)) {
    const [code, name] = key.split('|');
    if (!setNames[code] || n > setNames[code].n) setNames[code] = { name, n };
  }

  const cards = new Map();
  const get = (id, init) => {
    if (!cards.has(id)) cards.set(id, init());
    return cards.get(id);
  };

  // Several products can map to one card id (e.g. OP17-062 Kaido has both a "(Manga)"
  // and a separate non-manga "(Super Alternate Art)"). Keep the strongest match:
  // 1 = explicit "(Manga)", 2 = super art confirmed by Yuyu-tei, 3 = tracked before.
  const chosen = new Map();
  for (const p of products) {
    const number = ext(p, 'Number');
    const rarity = ext(p, 'Rarity');
    if (!number) continue;
    const variant = enVariant(p.name);
    const rank = isEnglishMangaName(p.name, rarity)
      ? 1
      : SUPER_ART.test(p.name) && jpKeys.has(`${number}|${variant}`)
        ? 2
        : prevEnIds.has(p.productId)
          ? 3
          : 0;
    if (!rank) continue;
    const id = cardId(number, variant, enPrint(p.group));
    const cur = chosen.get(id);
    if (!cur || rank < cur.rank) chosen.set(id, { rank, p, number, rarity, variant });
  }

  for (const [id, { p, number, rarity, variant }] of chosen) {
    const print = enPrint(p.group);
    const card = get(id, () => blankCard(id, number, variant, print, setNames));
    card.name = baseName(p.name);
    card.rarity = rarity;
    card.en = {
      productId: p.productId,
      productName: p.name,
      groupId: p.group.groupId,
      groupName: p.group.name,
      url: p.url,
      thumb: p.imageUrl,
      image: largeImage(p.imageUrl),
      released: p.group.publishedOn?.slice(0, 10) ?? null,
    };
  }

  for (const j of jpCards) {
    const print = jpPrint(j);
    const id = cardId(j.number, j.variant, print);
    const card = get(id, () => blankCard(id, j.number, j.variant, print, setNames));
    card.nameJa = j.baseNameJa;
    card.rarity ??= j.rarity.replace(/^P-/, '');
    card.jp = {
      ver: j.ver,
      yuyuteiId: j.yuyuteiId,
      listingName: j.nameJa,
      url: j.url,
      thumb: j.thumb,
      image: j.image,
    };
  }

  // Keep anything we tracked before, even if a source skipped it today.
  for (const prev of previous) {
    if (!cards.has(prev.id)) cards.set(prev.id, { ...prev, stale: true });
    else {
      const cur = cards.get(prev.id);
      cur.en ??= prev.en;
      cur.jp ??= prev.jp;
      cur.name ??= prev.name;
      cur.nameJa ??= prev.nameJa;
    }
  }

  return [...cards.values()].sort((a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
}

function blankCard(id, number, variant, print, setNames) {
  const code = setCode(number);
  return {
    id,
    number,
    variant,
    print,
    setCode: code,
    setName: setNames[code]?.name ?? code,
    name: null,
    nameJa: null,
    rarity: null,
    en: null,
    jp: null,
  };
}
