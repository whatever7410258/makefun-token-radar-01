// The token radar's model: a sealed snapshot in, a ranked board out.
//
// The board ranks protocols that record no token yet by the implied value a
// token would have if the protocol's record stayed as it is. It covers every
// slug on the snapshot's watchlist (the floor, never a ceiling), adds the
// strongest pre-token protocols below the floor, and carries a dozen
// live-token comparables, chosen by market cap near the board's own median
// implied value, so a reader can calibrate the model against the market.
//
// Implied value follows only from the snapshot's own figures:
//
//   implied = tvl_usd x categoryMultiple x growth x maturity x breadth
//
//   categoryMultiple  what a dollar of TVL is worth depends on what the
//                     protocol does: lending and derivatives capture more
//                     value per dollar of TVL than plain yield. An ordered
//                     table in CATEGORY_MULTIPLES; anything unlisted takes
//                     the default. No protocol name is ever special-cased.
//   growth            1 + clamp(change_7d, -50, 150) / 100 x 0.6
//   maturity          0.7 + 0.3 x (1 - exp(-age_days / 365)); age unknown
//                     counts as 180 days. A long track record with no token
//                     is worth more, but the curve saturates.
//   breadth           1 + 0.03 x min(chains, 10): a protocol on more chains
//                     reaches more users per dollar of TVL.
//
// A live-token comparable is not modelled: its implied value is its market
// cap, the market's own number, and its token_status says so, so the board
// never mixes a model's claim with a market price.

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

/** The model's tunable numbers, stated in the dashboard. */
export interface ModelParams {
  default_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_halflife_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelParams = {
  default_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_halflife_days: 365,
  unknown_age_days: 180,
  breadth_per_chain: 0.03,
  breadth_max_chains: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the board carries, by TVL. */
export const EARLY_ROWS = 148;
/** How many live-token comparables the board carries, by market cap near the median implied value. */
export const COMPARABLE_ROWS = 12;
/** How many live-token protocols the dashboard's Live market section carries, by market cap. */
export const LIVE_ROWS = 20;

/**
 * Value per dollar of TVL by what the protocol does. The first substring that
 * matches the lowercased category wins; the order below puts the specific
 * before the general ('yield aggregator' before 'yield').
 */
export const CATEGORY_MULTIPLES: Array<[string, number]> = [
  ['yield aggregator', 0.28],
  ['derivatives', 0.4],
  ['perpetual', 0.4],
  ['lending', 0.35],
  ['cdp', 0.35],
  ['prediction', 0.35],
  ['dex', 0.3],
  ['rwa', 0.3],
  ['insurance', 0.3],
  ['risk curator', 0.28],
  ['onchain capital allocator', 0.28],
  ['liquid staking', 0.22],
  ['restaking', 0.22],
  ['yield', 0.25],
  ['stablecoin', 0.2],
  ['stable', 0.2],
  ['bridge', 0.15],
];

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
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
  token_status: 'pre-token' | 'live';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, farm plan included so the page and board.json agree. */
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
  token_status: 'pre-token' | 'live';
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol for the dashboard's Live market section. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  comparable_size: number;
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
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category's value multiple: first table substring that matches, else the default. */
export function categoryMultiple(category: string | null, params: ModelParams): number {
  const c = (category ?? '').toLowerCase();
  for (const [needle, multiple] of CATEGORY_MULTIPLES) {
    if (c.includes(needle)) return multiple;
  }
  return params.default_multiple;
}

/** The multipliers and the implied value one pre-token protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  params: ModelParams,
): { implied: number; baseMultiple: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const baseMultiple = categoryMultiple(protocol.category, params);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + params.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / params.maturity_halflife_days));
  const breadthMult = 1 + params.breadth_per_chain * Math.min(protocol.chains.length, params.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * baseMultiple * growthMult * maturityMult * breadthMult));
  return { implied, baseMultiple, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank as pre-token: no token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a protocol may stand as a live comparable: it trades, has a sane market cap, is not an exchange or a versioned pool. */
export function isComparable(p: SnapshotProtocol): boolean {
  return (
    !isPreToken(p) &&
    p.category !== 'CEX' &&
    !VERSIONED.test(p.name) &&
    typeof p.mcap_usd === 'number' &&
    Number.isFinite(p.mcap_usd) &&
    p.mcap_usd > 0
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Score the pre-token rows; their median implied value sets the comparables' band.
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, params);
    return { p, ...v, token_status: 'pre-token' as const };
  });
  const values = scored.map((s) => s.implied).sort((a, b) => a - b);
  const medianImplied = values[Math.floor(values.length / 2)] ?? 1;
  const logMedian = Math.log(Math.max(medianImplied, 1));

  // The comparables: live-token protocols whose market cap sits nearest the
  // board's median implied value, in log space, so they calibrate the model
  // instead of towering over it. Their implied value is their market cap.
  const comparables = snapshot.protocols
    .filter((p) => isComparable(p))
    .map((p) => ({ p, distance: Math.abs(Math.log(p.mcap_usd!) - logMedian) }))
    .sort((a, b) => a.distance - b.distance || b.p.mcap_usd! - a.p.mcap_usd! || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, COMPARABLE_ROWS)
    .map(({ p }) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      return {
        p,
        implied: p.mcap_usd!,
        baseMultiple: 0,
        growthPct: 0,
        growthMult: 1,
        maturityMult: 1,
        breadthMult: 1,
        age,
        token_status: 'live' as const,
      };
    });

  const all = [...scored, ...comparables];
  all.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return all.map((s, i) => ({
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
    token_status: s.token_status,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.baseMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.token_status).map(stepText),
  }));
}

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

/** A rough gas price for one transaction on a chain, in dollars, from the chain's name. */
function gasFor(chain: string): number {
  const table: Record<string, number> = {
    ethereum: 9,
    bitcoin: 3,
    tron: 1,
    avalanche: 0.5,
    arbitrum: 0.6,
    optimism: 0.4,
    binance: 0.3,
    base: 0.15,
    polygon: 0.1,
    hyperliquid: 0.1,
    solana: 0.05,
    monad: 0.05,
  };
  const c = chain.toLowerCase();
  for (const [needle, price] of Object.entries(table)) {
    if (c.includes(needle)) return price;
  }
  return 2;
}

/** A gas figure in words: "$0.15" for cents, "$9" for whole dollars. */
function gasWords(price: number): string {
  return price < 1 ? `$${price.toFixed(2)}` : `$${Math.round(price)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 100_000_000) return 200;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Lend $${capital} of USDC on ${chain} through ${name}: deposit into the main lending market and leave the position supplied.`;
  if (c.includes('dex'))
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} (a USDC pair if one exists) and keep the LP position.`;
  if (c.includes('yield aggregator') || c.includes('yield'))
    return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and hold the vault shares.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} with ${name}, then use the bridged funds inside its app instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of ${chain}'s staking asset through ${name} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position; close it only after the hold window.`;
  if (c.includes('prediction')) return `Fund the account with $${capital} and take one small position on ${name}'s nearest market.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares through the hold window.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age, token status), never from a hand-written list of names. A live-token
 * protocol's plan farms after issuance: buy, stake, vote.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, status: 'pre-token' | 'live'): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const gw = gasWords(gas);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  if (status === 'live') {
    const token = p.symbol !== null ? p.symbol : `${p.name}'s token`;
    return [
      {
        text: `Buy $${capital} of ${token} on ${chain} through the protocol's deepest pool; check the token address in the protocol's own app first.`,
        cost: `$${capital} of capital and about ${gw} of gas`,
        time: '15 minutes to set up',
      },
      {
        text: `Stake the tokens, or add them to a liquidity pool on ${chain}, and hold the receipt through the next rewards epoch.`,
        cost: `about ${gw} of gas to stake`,
        time: '10 minutes',
      },
      {
        text: `Vote in one governance proposal a month, and read the proposal text before you vote.`,
        cost: `about ${gw} of gas a vote`,
        time: '15 minutes a month',
      },
      {
        text: `Hold the staked position for at least ${hold} days so the rewards compound instead of being eaten by entry and exit fees.`,
        cost: `the $${capital} stays staked`,
        time: `${hold} days`,
      },
      {
        text: `Claim staking rewards from the protocol's own rewards page only, and restake them while the position is open.`,
        cost: `about ${gw} of gas a claim`,
        time: '10 minutes',
      },
      {
        text: `Log the wallet, the dates and every transaction hash, then unwind in the reverse order you entered and confirm the funds land back.`,
        cost: `about ${gw} of gas to exit`,
        time: '15 minutes',
      },
    ];
  }
  return [
    {
      text: `Set up a fresh wallet that holds only this farm's funds, and fund it with $${capital + 10} on ${chain}.`,
      cost: `about ${gw} of gas to fund and approve`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gw} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Return once a week and make one real action: a deposit, a swap, a vote, or a claim, whichever the app rewards.`,
      cost: `about ${gw} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When the protocol announces points or a claim, open the rewards page from the protocol's own app and claim only there, never from a link in a message.`,
      cost: 'nothing to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash, then unwind in the reverse order you entered and confirm the funds land back.`,
      cost: `about ${gw} of gas to exit`,
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live market section. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isComparable(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
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

/** A board row's form for data.js: the same farm plan board.json carries. */
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
    token_status: row.token_status,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, params);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => r.token_status === 'pre-token' && !watchlist.has(r.slug)).length;
  const comparable = board.filter((r) => r.token_status === 'live').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: params,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    comparable_size: comparable,
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
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
