# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dayromadhon/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dayromadhon/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: 226 pre-token protocols ranked by implied value, each with a seven-step farm plan.

[Enter the token-radar-01 bounty on make.fun](https://make.fun/bounty/token-radar-01)

## The model (radar-2)

One function scores every protocol from the snapshot's own figures — no name is special-cased:

```
implied = round(tvl_usd × tiered base × growth × maturity × breadth)
```

- **Base, tiered by TVL:** 0.30 below $100M, 0.25 to $1B, 0.20 above — a large TVL is worth more in dollars but less per dollar.
- **Growth:** `1 + clamp(change_7d, −40, 150) / 100 × weight`, weight 0.6 on gains and 0.9 on losses — a fall is punished harder than a rise is rewarded.
- **Maturity:** `0.55 + 0.45 × sqrt(min(age_days, 1460) / 1460)` — longevity with no token counts, with diminishing returns. Unknown age uses 365 days.
- **Breadth:** `1 + 0.03 × extra chains`, capped at 1.12.

The board covers all 40 watchlist protocols (TVL ≥ $50M, no token on record) plus every rankable pre-token protocol below the floor — 186 of them on this snapshot, for 226 rows in all. Protocols whose token already trades are set aside in a separate Live-token view with their market caps — the board never mixes a market price with a model estimate. Implied value is a model, not a price, and never a prediction that a token will launch.

## The dashboard

Static, no network, no framework: `dashboard/index.html` + `app.css` + `app.js`, fed by `data.js` written beside it. It has a sortable, filterable board (search, category, chain), a top-three spotlight, a detail view per protocol showing every model input and the page's recomputation of its implied value, and a model tuner — move a slider and the board recomputes with the same formula, without touching `board.json`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. `main.ts` reads the sealed snapshot, writes `board.json` (226 rows), `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored make.fun library. Two runs write identical bytes.

## Farm plans

Every row carries seven steps, derived from its category, chains, TVL and age: a main position, a second qualifying action, a weekly cadence, a hold period, a claim-safety check and a tested exit — each with its cost and time.

---

Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) — try make.fun yourself: https://make.fun/?ref=sf3mmt2f&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01
