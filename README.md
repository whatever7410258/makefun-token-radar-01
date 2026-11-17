# Token Radar — a token launch radar for make.fun

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/whatever7410258/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/whatever7410258/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for the [token-radar-01 bounty on make.fun](https://make.fun/bounty/token-radar-01):
it ranks protocols that record no token yet by the implied value a token would
have if the protocol's record stayed as it is, and gives every protocol a
concrete farm plan. The board covers all 40 protocols on the snapshot's
watchlist, adds the strongest pre-token protocols below the watchlist floor,
and carries a dozen live-token comparables so a reader can calibrate the model
against the market's own values.

## The model

Every implied value is derived from the sealed snapshot's own figures, never
from a list of names:

```
implied = TVL x category multiple x growth x maturity x breadth
```

- **category multiple**: what a dollar of TVL is worth depends on what the
  protocol does. Lending and derivatives capture more value per dollar of TVL
  than plain yield; the table lives in `lib/model.ts` and every category falls
  back to a default of 0.25.
- **growth**: `1 + clamp(change_7d, -50, 150) / 100 x 0.6`. A protocol whose
  TVL grew 50% in a week scores 1.30; one that fell 50% scores 0.70.
- **maturity**: `0.7 + 0.3 x (1 - exp(-age_days / 365))`. A protocol that has
  run for years with no token has a track record; the curve saturates, so age
  past three years adds almost nothing. Unknown age counts as 180 days.
- **breadth**: `1 + 0.03 x min(chains, 10)`. A protocol deployed on many chains
  reaches more users and is worth more per dollar of TVL.

Live-token comparables are not modelled: their implied value is their market
cap, the market's own number, and they are flagged `live` so the board never
mixes a model's claim with a market price.

## The farm plan

Each row carries six steps, generated from the protocol's own record: its
category decides the action (supply, provide liquidity, stake, bridge, hedge),
its TVL sizes the capital, its age sets the hold, and its first chain sets the
gas estimate. Every step states what it costs and how long it takes.

## Run it

Node.js 22.18 or later, standard library only, no install:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

That writes `out/board.json` (the ranked board), `out/data.js` (the
dashboard's dataset), `out/dashboard/` (the page), `out/screenshots/` (the
three screenshots) and `out/dossier.json` (what the judge reads).

## Layout

- `main.ts` — the entrypoint: reads the snapshot, builds the board, writes
  the outputs and the dossier.
- `lib/model.ts` — the snapshot parser, the value model, the board builder
  and the farm-plan generator.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No
  network, no framework; it reads `../data.js`.
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte-exact
  from the kit.
- `.makefun/owner.json` — the claim file naming the payout wallet.

## Data

The snapshot is DefiLlama's public protocol data, fetched once by the house
and sealed: 758 protocols at or above $5M of TVL, as of 2026-11-14. A protocol
"records no token" when its DefiLlama record carries no market cap, no
CoinGecko id and no symbol; the snapshot is not proof that no token exists.

---

<sub>Entered on [make.fun](https://make.fun/?ref=w9y8tk6d&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
