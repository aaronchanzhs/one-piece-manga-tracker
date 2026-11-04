// Manga Rare Tracker front end. Reads data/cards.json and data/history.json,
// both written by `npm run update`. No framework, no build step.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  data: null,
  history: { fx: {}, cards: {} },
  q: '',
  market: 'all', // all | en | jp
  cur: 'USD', // USD | JPY
  set: '',
  sort: 'price-desc',
  view: 'grid',
  range: 365,
};

// ---------- preferences (per browser; optional) ----------
const PREF_KEY = 'manga-tracker-prefs';
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    for (const k of ['market', 'cur', 'sort', 'view']) if (p[k]) state[k] = p[k];
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ market: state.market, cur: state.cur, sort: state.sort, view: state.view }));
  } catch {}
}

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function fmtMoney(value, cur = state.cur) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (cur === 'JPY') return '¥' + Math.round(value).toLocaleString('en-US');
  const digits = value >= 100 ? 0 : 2;
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const usdTo = (usd, cur = state.cur, rate = state.data.usdJpy) => (usd == null ? null : cur === 'JPY' ? usd * rate : usd);
const jpyTo = (jpy, cur = state.cur, rate = state.data.usdJpy) => (jpy == null ? null : cur === 'USD' ? jpy / rate : jpy);

function fxOn(date) {
  const fx = state.history.fx;
  if (fx[date]) return fx[date];
  // Nearest earlier rate (ECB publishes on business days only).
  const dates = Object.keys(fx).sort();
  let best = null;
  for (const d of dates) if (d <= date) best = d;
  return best ? fx[best] : state.data.usdJpy;
}

const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86400000;

// Changes compare like with like: English market price only (a lowest listing is not a
// sale, and mixing the two produced fake ±90% moves), Japanese sell price only.
const enPointValue = (p) => p[1];
const jpPointValue = (p) => p[1];

// Percent change from the point closest to `days` ago (needs at least ~70% of the window).
function changeOver(series, valueOf, days) {
  const latestDate = series?.at(-1)?.[0];
  series = series?.filter((p) => valueOf(p) != null);
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1];
  // The end point must be current: a card with no sales today has no current price to compare.
  if (last[0] !== latestDate) return null;
  const target = new Date(last[0]);
  target.setUTCDate(target.getUTCDate() - days);
  const t = target.toISOString().slice(0, 10);
  let base = null;
  for (const p of series) if (p[0] <= t) base = p;
  // A "30-day" change must start near 30 days ago, not from a sale months earlier.
  if (base && daysBetween(base[0], t) > Math.max(10, days * 0.5)) return null;
  if (!base) {
    const first = series[0];
    if (daysBetween(first[0], last[0]) < days * 0.7) return null;
    base = first;
  }
  const a = valueOf(base);
  const b = valueOf(last);
  if (!a || b == null) return null;
  return ((b - a) / a) * 100;
}

function chgHtml(pct, label = '30d') {
  if (pct == null) return `<span class="chg flat" title="Not enough price history yet">—</span>`;
  const cls = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  const arrow = pct > 0.5 ? '▲' : pct < -0.5 ? '▼' : '';
  return `<span class="chg ${cls}" title="${label} change">${arrow}${Math.abs(pct).toFixed(1)}%</span>`;
}

// ---------- derived card model ----------
function enrich(c) {
  const h = state.history.cards[c.id] ?? { en: [], jp: [] };
  const en = c.price?.en;
  const jp = c.price?.jp;
  const enUsd = en ? (en.market ?? en.low) : null;
  const enListed = en && en.market == null && en.low != null;
  return {
    ...c,
    h,
    enUsd,
    enListed,
    jpSell: jp?.sell ?? null,
    jpBuy: jp?.buy ?? null,
    jpStock: jp?.stock ?? null,
    enChg: changeOver(h.en, enPointValue, 30),
    jpChg: changeOver(h.jp, jpPointValue, 30),
    released: c.en?.released ?? null,
    searchText: [c.name, c.nameJa, c.number, c.setCode, c.setName, c.en?.productName, c.jp?.listingName, c.variant === 'red-manga' ? 'red' : '', c.print === 'reprint' ? 'prb reprint premium' : '']
      .join(' ')
      .toLowerCase(),
  };
}

// Japan premium: Yuyu-tei sell (in USD) vs English price.
function premium(c) {
  if (c.enUsd == null || c.enListed || c.jpSell == null) return null; // needs a real English sale price
  const jpUsd = c.jpSell / state.data.usdJpy;
  return ((jpUsd - c.enUsd) / c.enUsd) * 100;
}

// Sort on real prices first. A lone placeholder listing ($29,995 with no sales) only
// counts when the card has no other price at all, so it can't jump to the top.
function sortValue(c) {
  const enSale = c.enListed ? null : usdTo(c.enUsd);
  const jp = jpyTo(c.jpSell);
  const fallback = usdTo(c.enUsd);
  if (state.market === 'en') return enSale ?? (fallback != null ? fallback / 1e6 : null);
  if (state.market === 'jp') return jp;
  const best = Math.max(enSale ?? -Infinity, jp ?? -Infinity);
  return Number.isFinite(best) ? best : fallback != null ? fallback / 1e6 : null;
}

// ---------- rendering ----------
let cards = [];

function visibleCards() {
  const q = state.q.trim().toLowerCase();
  let list = cards.filter((c) => {
    if (state.market === 'en' && !c.en) return false;
    if (state.market === 'jp' && !c.jp) return false;
    if (state.set && c.setCode !== state.set) return false;
    if (q && !q.split(/\s+/).every((w) => c.searchText.includes(w))) return false;
    return true;
  });
  const by = {
    'price-desc': (a, b) => (sortValue(b) ?? -1) - (sortValue(a) ?? -1),
    'price-asc': (a, b) => (sortValue(a) ?? Infinity) - (sortValue(b) ?? Infinity),
    'chg-desc': (a, b) => (pickChg(b) ?? -Infinity) - (pickChg(a) ?? -Infinity),
    'chg-asc': (a, b) => (pickChg(a) ?? Infinity) - (pickChg(b) ?? Infinity),
    'premium-desc': (a, b) => (premium(b) ?? -Infinity) - (premium(a) ?? -Infinity),
    number: (a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id),
    newest: (a, b) => (b.released ?? '').localeCompare(a.released ?? '') || a.number.localeCompare(b.number),
  };
  return list.sort(by[state.sort] ?? by['price-desc']);
}
const pickChg = (c) => (state.market === 'jp' ? c.jpChg : (c.enChg ?? (state.market === 'all' ? c.jpChg : null)));

function badges(c) {
  const b = [];
  if (c.variant === 'red-manga') b.push('<span class="badge red">Red manga</span>');
  else b.push('<span class="badge">Manga</span>');
  if (c.print === 'reprint') b.push('<span class="badge prb" title="Premium Booster reprint">PRB</span>');
  if (c.rarity === 'L') b.push('<span class="badge lead">Leader</span>');
  return `<div class="badges">${b.join('')}</div>`;
}

const setLabel = (c) => (c.print === 'reprint' ? `${c.en?.groupName?.replace(/ -The Best-/, '') ?? 'Premium Booster'}` : c.setName);

function thumbOf(c) {
  return safeUrl(c.en?.thumb) ?? safeUrl(c.jp?.thumb);
}

function enRow(c) {
  if (!c.en) return `<div class="prow"><span class="flag en">EN</span><span class="na">Not on TCGplayer</span></div>`;
  if (c.enUsd == null)
    return `<div class="prow"><span class="flag en">EN</span><span class="na">${c.released > state.data.date ? 'Releases ' + esc(c.released) : 'No price data'}</span></div>`;
  const conv = state.cur === 'JPY' ? `<small>${fmtMoney(c.enUsd, 'USD')}</small>` : '';
  return `<div class="prow"><span class="flag en">EN</span><span class="pval">${fmtMoney(usdTo(c.enUsd))}${conv}</span>${chgHtml(c.enChg)}
    ${c.enListed ? '<span class="psub">lowest listing, no recent sales</span>' : ''}</div>`;
}

function jpRow(c) {
  if (!c.jp) return `<div class="prow"><span class="flag jp">JP</span><span class="na">Not listed on Yuyu-tei</span></div>`;
  if (c.jpSell == null && c.jpBuy == null) return `<div class="prow"><span class="flag jp">JP</span><span class="na">No price data</span></div>`;
  const conv = state.cur === 'USD' && c.jpSell != null ? `<small>${fmtMoney(c.jpSell, 'JPY')}</small>` : '';
  const stock = c.jpStock === 0 ? 'sold out' : c.jpStock ? `${c.jpStock} in stock` : '';
  const buy = c.jpBuy != null ? `buy ${fmtMoney(jpyTo(c.jpBuy))}` : '';
  return `<div class="prow"><span class="flag jp">JP</span><span class="pval">${fmtMoney(jpyTo(c.jpSell))}${conv}</span>${chgHtml(c.jpChg)}
    <span class="psub">${[stock, buy].filter(Boolean).join(' · ')}</span></div>`;
}

function tileHtml(c) {
  const img = thumbOf(c);
  return `<button class="tile" data-id="${esc(c.id)}" aria-label="${esc(c.name)} ${esc(c.number)}">
    <div class="art">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="noimg">${esc(c.number)}</span>`}${badges(c)}</div>
    <div class="tile-body">
      <div>
        <div class="tile-title">${esc(c.name ?? c.nameJa ?? c.number)}</div>
        <div class="tile-sub"><span class="num">${esc(c.number)}</span><span>${esc(setLabel(c))}</span></div>
        ${c.nameJa ? `<div class="ja" lang="ja">${esc(c.nameJa)}</div>` : ''}
      </div>
      <div class="prices">${state.market !== 'jp' ? enRow(c) : ''}${state.market !== 'en' ? jpRow(c) : ''}</div>
    </div>
  </button>`;
}

function tableHtml(list) {
  const showEn = state.market !== 'jp';
  const showJp = state.market !== 'en';
  const rows = list
    .map((c) => {
      const img = thumbOf(c);
      const prem = premium(c);
      return `<tr data-id="${esc(c.id)}" tabindex="0">
      <td><div class="tcard">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span></span>'}<div><b>${esc(c.name ?? c.nameJa)}</b><span class="ja" lang="ja">${esc(c.nameJa ?? '')}</span></div></div></td>
      <td class="num">${esc(c.number)}</td>
      <td>${esc(setLabel(c))}</td>
      <td>${c.variant === 'red-manga' ? 'Red manga' : 'Manga'}${c.print === 'reprint' ? ' · PRB' : ''}</td>
      ${showEn ? `<td class="r num">${c.enUsd != null ? fmtMoney(usdTo(c.enUsd)) + (c.enListed ? '*' : '') : '—'}</td><td class="r">${chgHtml(c.enChg)}</td>` : ''}
      ${showJp ? `<td class="r num">${fmtMoney(jpyTo(c.jpSell))}</td><td class="r num">${fmtMoney(jpyTo(c.jpBuy))}</td><td class="r">${c.jpStock == null ? '—' : c.jpStock === 0 ? 'Sold out' : c.jpStock}</td>` : ''}
      ${showEn && showJp ? `<td class="r num">${prem == null ? '—' : (prem > 0 ? '+' : '') + prem.toFixed(0) + '%'}</td>` : ''}
    </tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Card</th><th>No.</th><th>Set</th><th>Variant</th>
      ${showEn ? '<th class="r">EN price</th><th class="r">EN 30d</th>' : ''}
      ${showJp ? '<th class="r">JP sell</th><th class="r">JP buy</th><th class="r">JP stock</th>' : ''}
      ${showEn && showJp ? '<th class="r" title="Yuyu-tei sell vs English price">JP premium</th>' : ''}
    </tr></thead><tbody>${rows}</tbody></table></div>
    ${showEn ? '<p class="chart-note">* lowest current listing; TCGplayer has no recent sales for this card.</p>' : ''}`;
}

function renderList() {
  const list = visibleCards();
  const el = $('#list');
  el.className = state.view === 'grid' ? 'grid' : '';
  el.innerHTML = state.view === 'grid' ? list.map(tileHtml).join('') : tableHtml(list);
  $('#empty').hidden = list.length > 0;
  $('#count').textContent = `${list.length} of ${cards.length} manga rare printings`;
}

function renderStats() {
  const withEn = cards.filter((c) => c.enUsd != null);
  const withJp = cards.filter((c) => c.jpSell != null);
  // Rank by real sales only: a lone $30k listing with no sales is not a "top price".
  const topEn = withEn.filter((c) => !c.enListed).sort((a, b) => b.enUsd - a.enUsd)[0];
  const listedCount = withEn.filter((c) => c.enListed).length;
  const topJp = [...withJp].sort((a, b) => b.jpSell - a.jpSell)[0];
  const movers = cards.filter((c) => c.enChg != null).sort((a, b) => b.enChg - a.enChg);
  const up = movers[0];
  const down = movers.at(-1);
  const sumEn = withEn.reduce((s, c) => s + c.enUsd, 0);
  const sumJp = withJp.reduce((s, c) => s + c.jpSell, 0);
  const link = (c, text) => (c ? `<button class="detail" data-id="${esc(c.id)}">${text}</button>` : '<div class="detail">—</div>');
  $('#stats').innerHTML = `
    <div class="stat"><div class="label">Tracked</div><div class="value">${cards.length}</div><div class="detail">${cards.filter((c) => c.en).length} English · ${cards.filter((c) => c.jp).length} Japanese</div></div>
    <div class="stat"><div class="label">Top English</div><div class="value">${topEn ? fmtMoney(usdTo(topEn.enUsd)) : '—'}</div>${link(topEn, topEn ? `${esc(topEn.name)} ${esc(topEn.number)}${topEn.variant === 'red-manga' ? ' (red)' : ''}` : '')}</div>
    <div class="stat"><div class="label">Top Japanese</div><div class="value">${topJp ? fmtMoney(jpyTo(topJp.jpSell)) : '—'}</div>${link(topJp, topJp ? `${esc(topJp.name ?? topJp.nameJa)} ${esc(topJp.number)}${topJp.variant === 'red-manga' ? ' (red)' : ''}` : '')}</div>
    <div class="stat"><div class="label">Best 30 days (EN)</div><div class="value">${up ? chgHtml(up.enChg) : '—'}</div>${link(up, up ? `${esc(up.name)} ${esc(up.number)}` : '')}</div>
    <div class="stat"><div class="label">Worst 30 days (EN)</div><div class="value">${down && down !== up ? chgHtml(down.enChg) : '—'}</div>${link(down !== up ? down : null, down ? `${esc(down.name)} ${esc(down.number)}` : '')}</div>
    <div class="stat"><div class="label">One of each (EN)</div><div class="value">${fmtMoney(usdTo(sumEn))}</div><div class="detail" title="${listedCount} cards have no recent sales and are counted at their lowest listing">${listedCount} at listing price · JP ${fmtMoney(jpyTo(sumJp))}</div></div>`;
}

function renderMeta() {
  const d = state.data;
  const updated = new Date(d.updatedAt);
  const tcg = d.sources?.tcgplayer?.lastUpdated ? new Date(d.sources.tcgplayer.lastUpdated) : null;
  $('#meta').innerHTML = `
    <dt>Updated</dt><dd>${esc(updated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</dd>
    ${tcg ? `<dt>TCGplayer data</dt><dd>${esc(tcg.toLocaleDateString(undefined, { dateStyle: 'medium' }))}</dd>` : ''}
    <dt>USD / JPY</dt><dd>${d.usdJpy?.toFixed(2) ?? '—'}</dd>
    ${d.warnings?.length ? `<dt>Warnings</dt><dd title="${esc(d.warnings.join('\n'))}">${d.warnings.length} ⚠</dd>` : ''}`;
}

function renderSetOptions() {
  const sets = new Map();
  for (const c of cards) if (!sets.has(c.setCode)) sets.set(c.setCode, c.setName);
  const opts = [...sets.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  $('#set').innerHTML =
    '<option value="">All sets</option>' + opts.map(([code, name]) => `<option value="${esc(code)}">${esc(code)} · ${esc(name)}</option>`).join('');
  $('#set').value = state.set;
}

function syncControls() {
  for (const b of $$('[data-market]')) b.setAttribute('aria-pressed', String(b.dataset.market === state.market));
  for (const b of $$('[data-cur]')) b.setAttribute('aria-pressed', String(b.dataset.cur === state.cur));
  for (const b of $$('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  $('#sort').value = state.sort;
}

function renderAll() {
  syncControls();
  renderStats();
  renderList();
}

// ---------- detail dialog ----------
function openDetail(id) {
  const c = cards.find((x) => x.id === id);
  if (!c) return;
  const dlg = $('#detail');
  const enImg = safeUrl(c.en?.image);
  const jpImg = safeUrl(c.jp?.image) ?? safeUrl(c.jp?.thumb);
  const enUrl = safeUrl(c.en?.url);
  const jpUrl = safeUrl(c.jp?.url);
  const prem = premium(c);
  const images = [
    enImg ? `<figure><img src="${esc(enImg)}" alt="English printing of ${esc(c.name)}" referrerpolicy="no-referrer"><figcaption><span class="flag en">EN</span> TCGplayer</figcaption></figure>` : '',
    jpImg ? `<figure><img src="${esc(jpImg)}" alt="Japanese printing of ${esc(c.nameJa ?? c.name)}" referrerpolicy="no-referrer"><figcaption><span class="flag jp">JP</span> Yuyu-tei</figcaption></figure>` : '',
  ].filter(Boolean);

  $('#d-body').innerHTML = `
    <div class="d-head">
      <div>
        <h2 id="d-title">${esc(c.name ?? c.nameJa)}</h2>
        <div class="tile-sub"><span class="num">${esc(c.number)}</span><span>${esc(setLabel(c))}</span><span>${c.variant === 'red-manga' ? 'Red manga' : 'Manga'}${c.print === 'reprint' ? ' · Premium Booster reprint' : ''}</span>${c.rarity ? `<span>${esc(c.rarity)}</span>` : ''}</div>
        ${c.nameJa ? `<div class="ja" lang="ja">${esc(c.jp?.listingName ?? c.nameJa)}</div>` : ''}
      </div>
      <button class="close" aria-label="Close">×</button>
    </div>
    <div class="d-grid">
      <div class="d-images">${images.length === 2 ? `<div class="pair">${images.join('')}</div>` : images.join('') || '<p class="na">No image</p>'}</div>
      <div>
        <div class="pcards">
          <section class="pcard">
            <h3><span><span class="flag en">EN</span> English</span>${enUrl ? `<a href="${esc(enUrl)}" target="_blank" rel="noopener">TCGplayer ↗</a>` : ''}</h3>
            ${
              c.en
                ? `<dl class="kv">
                <dt>Market</dt><dd class="big">${fmtMoney(usdTo(c.price.en?.market))}</dd>
                <dt>Lowest listing</dt><dd>${fmtMoney(usdTo(c.price.en?.low))}</dd>
                <dt>Mid listing</dt><dd>${fmtMoney(usdTo(c.price.en?.mid))}</dd>
                <dt>30 days</dt><dd>${chgHtml(c.enChg)}</dd>
                <dt>90 days</dt><dd>${chgHtml(changeOver(c.h.en, enPointValue, 90), '90d')}</dd>
              </dl>${c.price.en?.market == null && c.price.en ? '<p class="chart-note">No Market Price: no recent completed sales on TCGplayer.</p>' : ''}`
                : '<p class="na">No English printing tracked.</p>'
            }
          </section>
          <section class="pcard">
            <h3><span><span class="flag jp">JP</span> Japanese</span>${jpUrl ? `<a href="${esc(jpUrl)}" target="_blank" rel="noopener">Yuyu-tei ↗</a>` : ''}</h3>
            ${
              c.jp
                ? `<dl class="kv">
                <dt>Sell (asking)</dt><dd class="big">${fmtMoney(jpyTo(c.jpSell))}</dd>
                <dt>Buy (shop pays)</dt><dd>${fmtMoney(jpyTo(c.jpBuy))}</dd>
                <dt>In yen</dt><dd>${fmtMoney(c.jpSell, 'JPY')} / ${fmtMoney(c.jpBuy, 'JPY')}</dd>
                <dt>Stock</dt><dd>${c.jpStock == null ? '—' : c.jpStock === 0 ? 'Sold out' : c.jpStock}</dd>
                <dt>30 days</dt><dd>${chgHtml(c.jpChg)}</dd>
              </dl>${c.jpStock === 0 ? '<p class="chart-note">Sold out: the sell price is Yuyu-tei\'s last asking price. The buy price is current.</p>' : ''}`
                : '<p class="na">No Japanese listing on Yuyu-tei.</p>'
            }
          </section>
        </div>
        ${prem != null ? `<p class="premium">Japan premium: the Japanese copy costs <strong>${Math.abs(prem).toFixed(0)}% ${prem >= 0 ? 'more' : 'less'}</strong> than the English one (Yuyu-tei sell at today's rate vs TCGplayer).</p>` : ''}
        <div class="chart-box">
          <div class="chart-head">
            <h3>Price history (${state.cur})</h3>
            <div class="seg" role="group" aria-label="Range">
              ${[[90, '3M'], [180, '6M'], [365, '1Y'], [99999, 'All']].map(([d, l]) => `<button data-range="${d}" aria-pressed="${state.range === d}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="legend">
            <span><i style="background:var(--en)"></i>English market</span>
            <span><i style="background:repeating-linear-gradient(90deg,var(--en) 0 2px,transparent 2px 5px);opacity:.6"></i>English lowest listing</span>
            <span><i style="background:var(--jp)"></i>Japanese sell</span>
            <span><i style="background:repeating-linear-gradient(90deg,var(--jp) 0 4px,transparent 4px 7px)"></i>Japanese buy</span>
          </div>
          <div class="chart" id="chart"></div>
          <p class="chart-note" id="chart-note"></p>
        </div>
      </div>
    </div>`;

  drawChart(c);
  $('.close', dlg).onclick = () => dlg.close();
  for (const b of $$('[data-range]', dlg))
    b.onclick = () => {
      state.range = Number(b.dataset.range);
      for (const x of $$('[data-range]', dlg)) x.setAttribute('aria-pressed', String(x === b));
      drawChart(c);
    };
  if (!dlg.open) dlg.showModal();
  history.replaceState(null, '', `#card=${encodeURIComponent(c.id)}`);
}

function drawChart(c) {
  const box = $('#chart');
  const note = $('#chart-note');
  const lastDate = state.data.date;
  const from = new Date(lastDate);
  from.setUTCDate(from.getUTCDate() - state.range);
  const fromIso = from.toISOString().slice(0, 10);

  const series = [];
  if (c.h.en?.length) {
    const inRange = c.h.en.filter((p) => p[0] >= fromIso);
    series.push({ key: 'en', color: 'var(--en)', pts: inRange.filter((p) => p[1] != null).map((p) => [p[0], usdTo(p[1], state.cur, fxOn(p[0]))]) });
    series.push({ key: 'enl', color: 'var(--en)', dash: '2 4', faint: true, pts: inRange.filter((p) => p[2] != null).map((p) => [p[0], usdTo(p[2], state.cur, fxOn(p[0]))]) });
  }
  if (c.h.jp?.length) {
    series.push({ key: 'jp', color: 'var(--jp)', pts: c.h.jp.filter((p) => p[0] >= fromIso && p[1] != null).map((p) => [p[0], jpyTo(p[1], state.cur, fxOn(p[0]))]) });
    series.push({ key: 'jpb', color: 'var(--jp)', dash: '5 4', pts: c.h.jp.filter((p) => p[0] >= fromIso && p[2] != null).map((p) => [p[0], jpyTo(p[2], state.cur, fxOn(p[0]))]) });
  }
  const all = series.flatMap((s) => s.pts);
  const jpDays = c.h.jp?.length ?? 0;
  note.textContent =
    jpDays && jpDays < 14
      ? `Japanese history started ${c.h.jp[0][0]}: Yuyu-tei keeps no price archive, so it builds up one point per daily update.`
      : '';
  if (all.length === 0) {
    box.innerHTML = '<p class="na" style="padding:24px 0">No price history yet.</p>';
    return;
  }

  const W = 640, H = 240, L = 62, R = 12, T = 12, B = 26;
  const xs = all.map((p) => +new Date(p[0]));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
  // Scale to real prices (market, JP sell/buy). The lowest-listing line often has
  // $99,999 placeholder listings that would flatten everything, so it is clipped instead.
  const main = series.filter((s) => !s.faint).flatMap((s) => s.pts);
  const scalePts = main.length ? main : all;
  let y0 = Math.min(...scalePts.map((p) => p[1])), y1 = Math.max(...scalePts.map((p) => p[1]));
  const pad = (y1 - y0) * 0.1 || y1 * 0.1 || 1;
  y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = (d) => L + ((+new Date(d) - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = y0 + ((y1 - y0) * i) / ticks;
    grid += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(compact(v))}</text>`;
  }
  const xt = 4;
  for (let i = 0; i <= xt; i++) {
    const t = new Date(x0 + ((x1 - x0) * i) / xt);
    grid += `<text class="axis" x="${L + ((W - L - R) * i) / xt}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === xt ? 'end' : 'middle'}">${esc(t.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }))}</text>`;
  }
  const lines = series
    .filter((s) => s.pts.length)
    .map((s) => {
      // Lift the pen across gaps of 3+ weeks (no sales recorded) instead of implying a trend.
      const d = s.pts.map((p, i) => `${i && daysBetween(s.pts[i - 1][0], p[0]) <= 21 ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
      const dots = s.pts.length <= 3 ? s.pts.map((p) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.5" fill="${s.color}"/>`).join('') : '';
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.faint ? 1.6 : 2.2}" ${s.faint ? 'opacity="0.55"' : ''} ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    })
    .join('');

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history chart"><defs><clipPath id="plot"><rect x="${L}" y="${T - 4}" width="${W - L - R + 4}" height="${H - T - B + 8}"/></clipPath></defs>${grid}<g clip-path="url(#plot)">${lines}</g><line id="cursor" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="tip" hidden></div>`;

  const svg = $('svg', box);
  const tip = $('.tip', box);
  const cursor = $('#cursor', box);
  const dates = [...new Set(all.map((p) => p[0]))].sort();
  const valueAt = (s, d) => s.pts.find((p) => p[0] === d)?.[1];
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = dates[0];
    for (const d of dates) if (Math.abs(X(d) - x) < Math.abs(X(best) - x)) best = d;
    const labels = { en: 'EN market', enl: 'EN low', jp: 'JP sell', jpb: 'JP buy' };
    const rows = series.map((s) => [labels[s.key], valueAt(s, best)]).filter(([, v]) => v != null);
    if (!rows.length) return;
    cursor.setAttribute('x1', X(best));
    cursor.setAttribute('x2', X(best));
    cursor.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `${esc(best)}<br>${rows.map(([k, v]) => `${k} ${esc(fmtMoney(v))}`).join('<br>')}`;
    tip.style.left = `${Math.min(Math.max((X(best) / W) * r.width, 70), r.width - 70)}px`;
    tip.style.top = `${(T / H) * r.height + 4}px`;
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cursor.setAttribute('visibility', 'hidden');
  });
}

function compact(v) {
  const sym = state.cur === 'JPY' ? '¥' : '$';
  if (v >= 1e6) return sym + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e3) return sym + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k';
  return sym + Math.round(v);
}

// ---------- events ----------
function bind() {
  $('#q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderList();
  });
  $('#set').addEventListener('change', (e) => {
    state.set = e.target.value;
    renderList();
  });
  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    savePrefs();
    renderList();
  });
  for (const b of $$('[data-market]')) b.addEventListener('click', () => { state.market = b.dataset.market; savePrefs(); renderAll(); });
  for (const b of $$('[data-cur]')) b.addEventListener('click', () => { state.cur = b.dataset.cur; savePrefs(); renderAll(); });
  for (const b of $$('[data-view]')) b.addEventListener('click', () => { state.view = b.dataset.view; savePrefs(); renderAll(); });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-id]');
    if (t && !t.closest('dialog')) openDetail(t.dataset.id);
  });
  document.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('tr[data-id]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openDetail(row.dataset.id);
    }
  });
  const dlg = $('#detail');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));
}

// ---------- boot ----------
async function boot() {
  loadPrefs();
  try {
    const [data, hist] = await Promise.all([
      fetch('data/cards.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/history.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { fx: {}, cards: {} })).catch(() => ({ fx: {}, cards: {} })),
    ]);
    state.data = data;
    state.history = hist;
  } catch (err) {
    $('#list').innerHTML = `<p class="empty">Couldn't load price data (${esc(err.message)}). Run <code>npm run update</code>, then open the site with <code>npm run serve</code> instead of opening the file directly.</p>`;
    return;
  }
  cards = state.data.cards.map(enrich);
  renderMeta();
  renderSetOptions();
  bind();
  renderAll();
  const m = location.hash.match(/^#card=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));
}

boot();
