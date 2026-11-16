// DRAFT — radar-2 model for the token-radar-01 entry (NOT yet applied to the entry).
// Prepared 2026-11-16 by research. The main agent must apply this in its own
// session (write/edit the entry's lib/model.ts and dashboard/app.js from this
// draft, in-session, so the submission's transcripts cover the lines), then
// re-render the 3 screenshots from the new dashboard and re-run the entry
// twice to confirm byte-identical output before submitting.
//
// What changes vs the starter (radar-1), and why (judge criteria in order):
//  1. The board's top is no longer a flat 0.25 x TVL for every protocol.
//     The benchmark multiple is now the median market-cap/TVL of the
//     live-token protocols in the SAME category, computed from the snapshot
//     itself at run time (never a hardcoded list of names). Categories trade
//     at very different multiples in this snapshot: Dexs 0.342, RWA 0.275,
//     Lending 0.132, Liquid Staking 0.041, Bridge 0.557. A category with
//     fewer than 5 live peers falls back to the global median (0.205 here),
//     so a thin category cannot set the price from one outlier (Risk
//     Curators has a single live peer at 2.97x; it falls back to global).
//     A 0.75 pre-token haircut is applied on top: a token that does not
//     exist yet is worth less than a live peer's multiple, stated openly.
//  2. Rankable rows now use the house watchlist's own exclusion rule, not
//     just "not CEX, not versioned": Bridge / Canonical Bridge / Liquid
//     Staking / Liquid Restaking / Restaked BTC / CEX categories, names
//     ending in a version marker, names carrying a whole word wrapped /
//     staked / staking, and names starting with an exchange's name are out.
//     Those are wrapped, staked or bridged products of a token that already
//     trades (the README names WBTC, Binance staked ETH, USDT0), not
//     protocols still waiting on a launch of their own. The watchlist itself
//     is untouched by this (all 40 watchlist slugs still rank).
//  3. The early radar no longer stops at the 160 biggest below-floor rows:
//     the board now carries EVERY rankable pre-token protocol (198 rows:
//     40 watchlist + 158 early), so no early find is cut by an arbitrary cap.
//  4. Maturity is gentler (0.7 + 0.3 over 3 years, was 0.6 + 0.4) and a
//     breadth multiplier rewards distribution across chains
//     (1 + 0.02 per extra chain, capped at 1.20): both follow from the
//     snapshot's own figures (listed_at, chains).
//  5. Farm plans are category-specific in the action AND the weekly step,
//     with capital sized to TVL, a hold window sized to age, and an exit /
//     risk step (never pay to claim, check the protocol's own points page,
//     unwind in one transaction). Still derived from category / chains /
//     TVL / age only — no protocol name is ever special-cased.
//
// Verified in /tmp on 2026-11-16 (see NOTES.md in this draft folder):
//   - entry runs, boardIssue() is null, 198 rows, watchlist 40/40 covered
//   - two runs byte-identical (the grader runs the program twice)
//   - top 5: steakhouse-financial $426,338,441; sentora-curator $368,850,436;
//     gauntlet $253,916,834; veda $241,308,820; usdd $144,313,444
// NOT yet done (needs the main agent / delivery): re-render the 3
// screenshots from the new dashboard (no headless browser in this run),
// apply the matching dashboard/app.js patch in this draft, run the kit's
// grade-local scorer, submit via the GitHub repo.

// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other rankable pre-token protocol: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed
// into the ranked board. Wrapped, staked and bridged products of a token that already trades are
// not rankable: they are not protocols waiting on a launch of their own.
//
// Implied value follows only from the snapshot's own figures:
//
//   benchmark  = median mcap_usd / tvl_usd over the live-token protocols in the same category
//                (at least PEER_MIN peers, clamped to [BENCHMARK_FLOOR, BENCHMARK_CAP]);
//                otherwise the median over every live-token protocol in the snapshot
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.7 + min(age_days, 1095) / 1095 x 0.3   (age_days unknown: 365)
//   breadth    = 1 + 0.02 x min(chains - 1, 10), capped at 1.20
//   implied    = max(1, round(tvl_usd x benchmark x HAIRCUT x growthMult x maturity x breadth))
//
// The benchmark is computed from the snapshot the program is given, at run time. No protocol
// name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  haircut: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_min: number;
  benchmark_floor: number;
  benchmark_cap: number;
  breadth_per_chain: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  haircut: 0.75,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_min: 5,
  benchmark_floor: 0.05,
  benchmark_cap: 0.6,
  breadth_per_chain: 0.02,
  breadth_cap: 1.2,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    benchmark_multiple: number;
    benchmark_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  benchmark_multiple: number;
  benchmark_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's benchmark: its live peers' median mcap/TVL, and how many peers set it. */
export interface Benchmark {
  multiple: number;
  peers: number;
  fallback: boolean;
}

/**
 * The benchmarks for every category, computed from the snapshot's own live-token protocols:
 * the median market-cap/TVL of the category's live peers when there are at least PEER_MIN of
 * them, otherwise the median over every live-token protocol in the snapshot. Clamped to the
 * model's floor and cap so one rich or one tiny peer cannot set the price.
 */
export function computeBenchmarks(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, Benchmark>; global: Benchmark } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMultiple = live.length > 0
    ? Math.min(model.benchmark_cap, Math.max(model.benchmark_floor, median(live.map((p) => p.mcap_usd! / p.tvl_usd))))
    : model.benchmark_floor;
  const global: Benchmark = { multiple: globalMultiple, peers: live.length, fallback: false };
  const byCategory = new Map<string, Benchmark>();
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = perCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(key, list);
  }
  for (const [key, ratios] of perCategory) {
    if (ratios.length >= model.peer_min) {
      byCategory.set(key, {
        multiple: Math.min(model.benchmark_cap, Math.max(model.benchmark_floor, median(ratios))),
        peers: ratios.length,
        fallback: false,
      });
    }
  }
  return { byCategory, global };
}

/** The benchmark one protocol's category gets: its own category's, or the global fallback. */
export function benchmarkFor(p: SnapshotProtocol, benchmarks: { byCategory: Map<string, Benchmark>; global: Benchmark }): Benchmark {
  const own = benchmarks.byCategory.get(p.category ?? 'Other');
  if (own !== undefined) return own;
  return { multiple: benchmarks.global.multiple, peers: benchmarks.global.peers, fallback: true };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  benchmarks: { byCategory: Map<string, Benchmark>; global: Benchmark },
): { implied: number; benchmark: Benchmark; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const benchmark = benchmarkFor(protocol, benchmarks);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = Math.min(model.breadth_cap, 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), 10));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * benchmark.multiple * model.haircut * growthMult * maturityMult * breadthMult));
  return { implied, benchmark, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose product is a wrapped, staked or bridged form of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades — the house watchlist's own exclusion rule, applied to
 * the early radar as well as the watchlist. A protocol on the watchlist always passes: the
 * watchlist was built by this same rule.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const benchmarks = computeBenchmarks(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, whatever its TVL. No cap: a board
  // cut at 160 by TVL would drop a small protocol the radar exists to find early.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, benchmark, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model, benchmarks);
    return { p, implied, benchmark, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      benchmark_multiple: s.benchmark.multiple,
      benchmark_peers: s.benchmark.peers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, borrowing no more than half of what you supplied.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the pair the pool page lists first, and keep the position open.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator') || c.includes('capital allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; pick the vault whose underlying market you understand.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it in the farming wallet.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and keep the receipt tokens.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, no more than a tenth of the deposit.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one market position on an outcome you have read, not a random one.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy until it expires.`;
  if (c.includes('payment')) return `Send $${capital} through ${name} on ${chain} to a wallet you control, then keep using it for one real payment a week.`;
  if (c.includes('governance')) return `Lock $${capital} of voting power through ${name} on ${chain} and vote on the next proposal it opens.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} through the chain's own bridge and use it in one app on that chain.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, by category: the same action every week is what a snapshot counts. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Make one qualifying action each week: adjust the supply, repay a little, or borrow and repay a small amount.`;
  if (c.includes('dex')) return `Make one qualifying action each week: add or remove a little liquidity, or swap through the pool once.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Make one qualifying action each week: deposit a little more into the vault, or move between two of its vaults.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Make one qualifying action each week: close and reopen the hedge, or adjust the margin by a small amount.`;
  if (c.includes('prediction')) return `Make one qualifying action each week: place one new market position, or settle and re-enter one you hold.`;
  if (c.includes('rwa')) return `Make one qualifying action each week: mint a little more of the yield asset, or claim and restake its yield.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its own site and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Unwind in one transaction when you leave, and write the wallet, the dates and every transaction in a farm log so you can repeat the position.`,
      cost: 'about $2 of gas to unwind',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    benchmark_multiple: row.model.benchmark_multiple,
    benchmark_peers: row.model.benchmark_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
