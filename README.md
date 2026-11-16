# Token Launch Radar

A token launch radar that ranks pre-token protocols by implied value, built for the make.fun bounty.

## What it does

Reads a snapshot of the protocol universe (758 protocols from DefiLlama), ranks every pre-token protocol by implied value using a category-benchmark model, and writes a dashboard showing which protocols are worth farming next and how to farm them.

## Model (radar-2)

Implied value is computed from the snapshot's own figures:

- **Benchmark**: median mcap/TVL of live-token protocols in the same category (min 5 peers, else global median 0.2138)
- **Haircut**: 0.75x for pre-token protocols
- **Growth**: 7-day TVL change, clamped to [-60, 120]%
- **Maturity**: 0.7 + 0.3 over 3 years since listing
- **Breadth**: 1 + 0.02 per extra chain, capped at 1.20

Board: 198 rows (40 watchlist + 158 early finds), all rankable pre-token protocols.

## Usage

```bash
node main.ts --input input/snapshot.json --output /output
```

Writes:
- `board.json` — ranked board with farm plans
- `data.js` — dashboard data
- `dashboard/` — static dashboard (HTML/CSS/JS)
- `screenshots/` — 3 dashboard screenshots
- `dossier.json` — judge dossier

## License

MIT
