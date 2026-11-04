# Manga Rare Tracker

A website that tracks prices for every One Piece Card Game **manga rare**, in English and in Japanese.

- **English prices:** TCGplayer, via [tcgcsv.com](https://tcgcsv.com) (a free daily mirror of TCGplayer data, no API key needed).
- **Japanese prices:** [Yuyu-tei (遊々亭)](https://yuyu-tei.jp), a large Japanese card shop. The tracker records its sell price, its buy price, and its stock.
- **Exchange rate:** the daily ECB reference rate, via [frankfurter.dev](https://frankfurter.dev).

There are no dependencies to run it, and no build step.

## Quick start

```bash
npm run update     # fetch today's prices → public/data/
npm run serve      # open http://localhost:4173
```

To fill in about a year of English price history (one point per week, from tcgcsv's archives), run this once:

```bash
npm install        # installs 7zip-bin, needed only for the backfill
npm run backfill   # options: -- --weeks 104, or -- --step 1 --weeks 8 for daily points
```

Japanese history can't be backfilled because Yuyu-tei keeps no price archive. It builds up one point each day that `npm run update` runs.

## Keeping it updated

Two jobs keep the site current, and each one covers something the other can't:

1. **GitHub Actions** (`.github/workflows/update-and-deploy.yml`) runs at 21:30 UTC every day. It refreshes **English prices only**, commits them, and publishes the site to GitHub Pages. Yuyu-tei blocks GitHub's servers (HTTP 403), so this run keeps the previous Japanese prices and the site marks them "as of" their date.
2. **Your Mac** runs [`scripts/daily-local.sh`](scripts/daily-local.sh) every morning. It pulls, runs the update with **both** sources, then commits and pushes; the push redeploys the site. A LaunchAgent (macOS's per-user scheduler) at `~/Library/LaunchAgents/com.onepiece.manga-tracker.plist` schedules it for 09:00. If the Mac is asleep at 09:00, macOS runs the job on wake. If the Mac is off, that day's Japanese prices are skipped.

```bash
tail -n 20 ~/Library/Logs/one-piece-manga-tracker.log                    # see recent runs
launchctl kickstart gui/$(id -u)/com.onepiece.manga-tracker               # run it now
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.onepiece.manga-tracker.plist   # turn it off
```

## Which cards count as manga rares

The rules live in [`scripts/lib/catalog.mjs`](scripts/lib/catalog.mjs) and are covered by `npm test`.

| Source | Counted as manga | Not counted |
|---|---|---|
| TCGplayer | Product names with `(Manga)`. Also `Super Alternate Art`, `Red Super Alternate Art`, and `Super Leader Alternate Art` products, but only when Yuyu-tei lists a manga super parallel for the same card number. This covers OP13 Luffy/Ace/Sabo, the OP17-079 Luffy leader, and the EB05-010 Robin leader. | Manga DON!! cards. OP17-118 Rocks, whose Super Alternate Art is pirate-crew art. |
| Yuyu-tei | `スーパーパラレル` (super parallel) and `レッドスーパーパラレル` (red super parallel). | `海賊団スーパーパラレル` (pirate-crew super parallel). |

**Premium Booster reprints** (PRB-01, PRB-02) are tracked as separate cards with a `-prb` suffix. On Yuyu-tei the reprints are the `刻印あり` (stamped) listings, or listings under the `prb01`/`prb02` set code.

The EB05-010 Robin leader is counted as manga because it follows the same naming pattern as OP17-079. I haven't confirmed it against a card image.

## What the numbers mean

- **EN market:** TCGplayer's Market Price, based on recent completed sales. Many expensive manga rares rarely sell. When there's no Market Price, the site shows the lowest current listing, marked "listed" or `*`. Listings are left out of 30-day changes, "Top English", sorting, and the Japan premium, because placeholder listings like $99,999 aren't real prices.
- **JP sell:** Yuyu-tei's asking price. Nearly every manga rare is sold out, and the shop keeps showing its last asking price, so this number can be stale.
- **JP buy:** what Yuyu-tei pays to buy the card from you. This stays current, so it's the most reliable live Japanese number.
- **Japan premium:** Yuyu-tei's sell price, converted to USD at today's rate, compared with the English market price.

## Files

```
scripts/update.mjs        daily fetch → public/data/cards.json + history.json
scripts/backfill-en.mjs   one-time English history from tcgcsv archives
scripts/serve.mjs         local static server
scripts/lib/              tcgplayer.mjs, yuyutei.mjs, catalog.mjs (matching rules)
public/                   the website (index.html, app.js, styles.css, data/)
tests/                    npm test
```

## Things that can break

- **Yuyu-tei changes its page layout.** The update then logs `WARNING: Yuyu-tei returned no manga listings` and keeps every card it already tracks. Fix the patterns in `scripts/lib/yuyutei.mjs`.
- **Yuyu-tei blocks GitHub's servers.** I haven't tested it from GitHub Actions. If Japanese prices stop updating there, run the update from your Mac instead.
- **TCGplayer renames a variant.** For example, if a future set labels manga as something other than `(Manga)`, the card won't be picked up. Add the new pattern in `catalog.mjs`.
