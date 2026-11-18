// Token launch radar, model v2 ("radar-2"): what a pre-token protocol's token
// would be worth if the protocol's record stayed as it is.
//
// The price anchor is the market itself: for each category, the median
// market-cap / TVL of the protocols in that category whose token already
// trades. A category with too few live peers falls back to the global
// median, so one outlier never sets the price. On top of the anchor sit
// four adjustments, each from the snapshot's own figures:
//
//   anchor     = median mcap/TVL of live peers in the category (clamped)
//   haircut    = 0.75 (a token that does not exist yet is worth less)
//   growth     = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturity   = 0.7 + min(age_days, 1095) / 1095 * 0.3
//   breadth    = 1 + 0.02 per chain beyond the first, capped at 1.20
//   implied    = max(1, round(tvl * anchor * haircut * growth * maturity * breadth))
//
// The board ranks every protocol on the snapshot's watchlist plus every
// rankable pre-token protocol below the floor — no arbitrary cap on the
// early rows. Rankable means pre-token and not a wrapped, staked or
// bridged product of a token that already trades, following the house
// watchlist's own exclusion rule. No protocol name is ever special-cased.

/** One protocol record from the sealed snapshot: exactly its ten fields. */
export interface Proto {
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

/** The sealed snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** The model's tunables, stated openly in the dashboard. */
export interface Tunables {
  haircut: number;
  growth_weight: number;
  growth_min: number;
  growth_max: number;
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age: number;
  breadth_step: number;
  breadth_cap: number;
  anchor_min: number;
  anchor_max: number;
  anchor_min_peers: number;
}

export const TUNE: Tunables = {
  haircut: 0.75,
  growth_weight: 0.5,
  growth_min: -60,
  growth_max: 120,
  maturity_base: 0.7,
  maturity_span: 0.3,
  maturity_days: 1095,
  unknown_age: 365,
  breadth_step: 0.02,
  breadth_cap: 1.2,
  anchor_min: 0.05,
  anchor_max: 0.6,
  anchor_min_peers: 5,
};

/** The model's version label, shown in the dashboard. */
export const MODEL_LABEL = 'radar-2';

/** How many live-token protocols the dashboard's live view carries. */
export const LIVE_LIMIT = 24;

const MS_PER_DAY = 86_400_000;

/** One farm-plan step before it is flattened to a string. */
export interface PlanStep {
  action: string;
  cost: string;
  duration: string;
}

/** One row of board.json. */
export interface BoardEntry {
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
    benchmark: number;
    benchmark_peers: number;
    benchmark_fallback: boolean;
    haircut: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form data.js carries to the page. */
export interface PageRow {
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
  benchmark: number;
  benchmark_peers: number;
  benchmark_fallback: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol whose token already trades: the market's value, not a model's. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface PageData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Tunables;
  model_version: string;
  global_benchmark: number;
  global_peers: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: PageRow[];
  live: LiveEntry[];
}

/** Why a snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A finite number, else the fallback. */
function asFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listed` to `asOf`, clamped at zero; null when unparseable. */
export function daysSince(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / MS_PER_DAY));
}

/** The median of a sorted array, or null when empty. */
function medianOf(sorted: number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category anchors: for each category, the median mcap/TVL of its
 * live-token protocols (mcap > 0, TVL > 0). A category with fewer than
 * `anchor_min_peers` live members falls back to the global median. Every
 * anchor is clamped to [anchor_min, anchor_max]. The global median is
 * computed over all live protocols with mcap > 0.
 */
export interface Anchors {
  byCategory: Map<string, { value: number; peers: number }>;
  global: number;
  globalPeers: number;
}

export function computeAnchors(protocols: Proto[], tune: Tunables = TUNE): Anchors {
  const live = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const globalRaw = medianOf(ratios) ?? 0;
  const global = clampNum(globalRaw, tune.anchor_min, tune.anchor_max);

  const perCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const arr = perCat.get(key) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    perCat.set(key, arr);
  }
  const byCategory = new Map<string, { value: number; peers: number }>();
  for (const [cat, arr] of perCat) {
    arr.sort((a, b) => a - b);
    const med = medianOf(arr);
    if (med !== null && arr.length >= tune.anchor_min_peers) {
      byCategory.set(cat, { value: clampNum(med, tune.anchor_min, tune.anchor_max), peers: arr.length });
    }
  }
  return { byCategory, global, globalPeers: live.length };
}

/** The anchor for one protocol's category, with a flag when it fell back. */
export function anchorFor(category: string | null, anchors: Anchors): { value: number; peers: number; fallback: boolean } {
  const hit = category !== null ? anchors.byCategory.get(category) : undefined;
  if (hit !== undefined) return { value: hit.value, peers: hit.peers, fallback: false };
  return { value: anchors.global, peers: anchors.globalPeers, fallback: true };
}

/** All five multipliers and the implied value for one protocol. */
export interface Valuation {
  implied: number;
  anchor: number;
  anchorPeers: number;
  anchorFallback: boolean;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

export function valueProtocol(p: Proto, asOf: string, anchors: Anchors, tune: Tunables = TUNE): Valuation {
  const age = daysSince(asOf, p.listed_at);
  const { value: anchor, peers: anchorPeers, fallback: anchorFallback } = anchorFor(p.category, anchors);
  const growthPct = clampNum(asFinite(p.change_7d, 0), tune.growth_min, tune.growth_max);
  const growthMult = 1 + (growthPct / 100) * tune.growth_weight;
  const ageForModel = age ?? tune.unknown_age;
  const maturityMult = tune.maturity_base + (clampNum(ageForModel, 0, tune.maturity_days) / tune.maturity_days) * tune.maturity_span;
  const extraChains = Math.max(0, p.chains.length - 1);
  const breadthMult = Math.min(tune.breadth_cap, 1 + extraChains * tune.breadth_step);
  const implied = Math.max(1, Math.round(p.tvl_usd * anchor * tune.haircut * growthMult * maturityMult * breadthMult));
  return { implied, anchor, anchorPeers, anchorFallback, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name ending in a version marker (V2, v2, 2.0, ...) is a pool, not a launch. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped / staked / staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names that prefix a product of an existing token. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories that are products of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether the snapshot records no token for this protocol. */
export function hasNoToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank this protocol: pre-token and not an excluded product. */
export function isRankable(p: Proto): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Round to 4 decimals for display; the board keeps full precision in its arithmetic. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One plan step as a single string, within the gate's 20..600 characters. */
export function flattenStep(step: PlanStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.duration}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocol's first chain, or a neutral phrase. */
function firstChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital for one farm position, scaled to the protocol's TVL. */
function stakeSize(p: Proto): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Minimum hold in days, from the protocol's age. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's weekly qualifying action, in the words a farmer can follow. */
function weeklyAction(p: Proto): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator')) return 'add to a vault or rebalance between vaults';
  if (c.includes('rwa')) return 'mint or hold the yield asset';
  if (c.includes('basis')) return 'check the hedge and rebalance the basis position';
  if (c.includes('prediction')) return 'place or settle a market position';
  if (c.includes('payment')) return 'send or receive a payment through the protocol';
  if (c.includes('govern')) return 'vote on an active proposal';
  if (c.includes('chain') || c.includes('layer')) return 'use a dapp on the chain or bridge assets in';
  if (c.includes('lend') || c.includes('cdp')) return 'supply, borrow or repay';
  if (c.includes('dex') || c.includes('yield')) return 'add liquidity or claim rewards';
  return 'deposit, swap, vote or otherwise use the app';
}

/** The category's opening move, in the words a farmer can follow. */
function openingMove(p: Proto, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${stake} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${stake} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('basis')) return `Deposit $${stake} of USDC into ${name}'s hedged position on ${chain} and keep it open.`;
  if (c.includes('prediction')) return `Fund $${stake} and place one market position on ${name}.`;
  if (c.includes('payment')) return `Route $${stake} of payments through ${name} on ${chain}.`;
  if (c.includes('govern')) return `Deposit $${stake} of USDC into ${name}'s governance vault on ${chain}.`;
  if (c.includes('chain') || c.includes('layer')) return `Bridge $${stake} of USDC to ${name} and use one of its dapps.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${stake} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${stake} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${stake} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${stake} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${stake} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${stake} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${stake} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps derived from its own record (category,
 * chains, TVL, age) — never from a hand-written list of names.
 */
export function planFor(p: Proto, age: number | null): PlanStep[] {
  const chain = firstChain(p);
  const stake = stakeSize(p);
  const hold = holdWindow(age);
  const weekly = weeklyAction(p);
  return [
    {
      action: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      duration: '5 minutes',
    },
    {
      action: openingMove(p, stake, chain),
      cost: `$${stake} of capital and about $${stake >= 150 ? 8 : 4} of gas`,
      duration: '15 minutes to set up',
    },
    {
      action: `Make one qualifying action each week, such as to ${weekly}.`,
      cost: 'about $2 of gas a week',
      duration: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      duration: `${hold} days`,
    },
    {
      action: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      duration: '10 minutes',
    },
    {
      action: `Unwind in one transaction when you exit, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'one exit transaction',
      duration: '5 minutes',
    },
  ];
}

/** The ranked board: every watchlist slug plus every rankable early protocol. */
export function rankBoard(snap: Snap, tune: Tunables = TUNE): BoardEntry[] {
  const anchors = computeAnchors(snap.protocols, tune);
  const index = new Map(snap.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, Proto>();
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  // The early radar carries every rankable pre-token protocol, not just the
  // biggest: a small protocol below the floor is still a launch to find.
  const early = snap.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) picked.set(p.slug, p);

  const scored = [...picked.values()].map((p) => ({ p, v: valueProtocol(p, snap.as_of, anchors, tune) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      benchmark: s.v.anchor,
      benchmark_peers: s.v.anchorPeers,
      benchmark_fallback: s.v.anchorFallback,
      haircut: tune.haircut,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: planFor(s.p, s.v.age).map(flattenStep),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveSet(snap: Snap): LiveEntry[] {
  return snap.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
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

/** A board row's compact form for data.js. */
export function toPageRow(row: BoardEntry): PageRow {
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
    benchmark: row.model.benchmark,
    benchmark_peers: row.model.benchmark_peers,
    benchmark_fallback: row.model.benchmark_fallback,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snap: Snap, tune: Tunables = TUNE): { board: BoardEntry[]; radar: PageData } {
  const anchors = computeAnchors(snap.protocols, tune);
  const board = rankBoard(snap, tune);
  const live = liveSet(snap);
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const radar: PageData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: tune,
    model_version: MODEL_LABEL,
    global_benchmark: anchors.global,
    global_peers: anchors.globalPeers,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(toPageRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snap {
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

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardEntry[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: PageData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
