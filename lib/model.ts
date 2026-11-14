// Token Radar's scoring model, radar-2: a sealed snapshot in, a ranked board out.
//
// The board always covers the snapshot's whole watchlist (the floor, never the ceiling) and then
// adds the early radar: pre-token protocols below the watchlist floor, picked by TVL. A protocol
// counts as pre-token when its record shows no token at all: no market cap, no CoinGecko id, no
// symbol. Protocols whose token already trades are kept apart and shown with the market's own
// numbers, never ranked into the board.
//
// The implied value is one formula over the snapshot's own figures, in four visible factors:
//
//   base         = tvl_usd x BASE_MULTIPLE
//   growth       = clamp(change_7d, -80, 150) per cent
//   growthFactor = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity     = 0.55 + min(age_days, 1460) / 1460 x 0.45   (unknown age: 365)
//   reach        = 1 + 0.05 x min(chains - 1, 4)              (multi-chain reach, at most +20%)
//   implied      = max(1, round(base x growthFactor x maturity x reach))
//
// Growth is clamped wider up than down: a launch rewards momentum, while a shrinking protocol
// rarely launches at a premium. Reach rewards protocols live on several chains, where more users
// can farm. No protocol name is ever special-cased: one function scores every row, and the page
// recomputes each row from the same figures.

/** One protocol entry of the snapshot: exactly its ten fields. */
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

/** The snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunables, as the dashboard prints them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  growth_weight: 0.6,
  growth_floor: -80,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  reach_per_chain: 0.05,
  reach_max_chains: 4,
};

/** The model's version label, named by the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 320;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One board.json row: the ranked board's row. */
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
  signal: string;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row in the dashboard's compact form; the page builds the farm plan from it. */
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
  signal: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
}

/** A live-token protocol: it trades already, so the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, and the model behind them. */
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

/** Raised when the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const MS_PER_DAY = 86_400_000;

/** The number when it is finite, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is missing or bad. */
export function daysSinceListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const firstSeen = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(firstSeen)) return null;
  return Math.max(0, Math.floor((start - firstSeen) / MS_PER_DAY));
}

/** The four factors and the implied value one protocol gets under `model`. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const age = daysSinceListed(asOf, protocol.listed_at);
  const rawGrowth = numOr(protocol.change_7d, 0);
  const growthPct = Math.max(model.growth_floor, Math.min(model.growth_cap, rawGrowth));
  const growthRate = growthPct / 100;
  const growthMult = 1 + growthRate * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const cappedAge = Math.max(0, Math.min(ageUsed, model.maturity_days));
  const ageShare = cappedAge / model.maturity_days;
  const maturityMult = model.maturity_floor + ageShare * model.maturity_range;
  const extraChains = Math.max(protocol.chains.length - 1, 0);
  const cappedChains = Math.min(extraChains, model.reach_max_chains);
  const reachMult = 1 + model.reach_per_chain * cappedChains;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * reachMult));
  return { implied, growthPct, growthMult, maturityMult, reachMult, age };
}

/** A one-line read on a row, from its growth and age figures only. */
export function signalLabel(growthPct: number | null, age: number | null): string {
  if (growthPct !== null && growthPct >= 25) return 'Rising fast';
  if (growthPct !== null && growthPct >= 8) return 'Growing';
  if (growthPct !== null && growthPct <= -20) return 'Cooling off';
  if (age !== null && age < 180) return 'Early find';
  if (age !== null && age >= 1095) return 'Steady giant';
  return 'Worth watching';
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when a protocol records no token at all. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function canRank(p: SnapshotProtocol): boolean {
  return hasNoToken(p) && p.category !== 'CEX' && !VERSION_SUFFIX.test(p.name);
}

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: take every slug, even one the snapshot no longer carries (it
  // cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && canRank(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, reachMult, age } = scoreProtocol(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, reachMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    signal: signalLabel(s.p.change_7d, s.age),
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: roundTo4(s.growthMult),
      maturity_multiplier: roundTo4(s.maturityMult),
      reach_multiplier: roundTo4(s.reachMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(formatStep),
  }));
}

const roundTo4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function formatStep(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. ` +
    `Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalNeeded(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('money market'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and borrow ` +
      `a small amount against it, then repay.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} ` +
      `and keep the position open.`;
  if (c.includes('bridge') || c.includes('canonical bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} ` +
      `and use the bridged funds in its app.`;
  if (c.includes('restak')) return `Restake $${capital} of liquid staking tokens through ${name} ` +
    `on ${chain} and keep the receipt.`;
  if (c.includes('liquid staking') || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${name} ` +
      `and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, ` +
      `then close it.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, ` +
    `then settle it.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ` +
    `${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} ` +
    `and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} ` +
    `and keep the policy.`;
  if (c.includes('gaming') || c.includes('game')) return `Play ${name} on ${chain} with $${capital} ` +
    `of in-game assets and finish one quest line.`;
  if (c.includes('ai') || c.includes('data')) return `Run one ${name} job on ${chain} with $${capital} ` +
    `of credits and keep the receipt.`;
  if (c.includes('social')) return `Post and engage daily on ${name} for a week with a $${capital} ` +
    `starter balance.`;
  if (c.includes('nft')) return `Mint or trade one ${name} item on ${chain} for about $${capital} ` +
    `and list it once.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} ` +
    `and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly habit that keeps a position qualifying, matched to the category. */
function weeklyHabit(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'Adjust the borrow once a week, such as ' +
    'adding collateral or repaying a little.';
  if (c.includes('dex') || c.includes('yield')) return 'Claim or compound the pool rewards once a week ' +
    'and rebalance if the range drifts.';
  if (c.includes('bridge')) return 'Bridge a small amount back and forth once a week ' +
    'so the route stays active.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open and close one small position each week, ' +
    'never leaving a large trade open.';
  if (c.includes('prediction')) return 'Place one small market position each week ' +
    'and settle it before it expires.';
  if (c.includes('gaming') || c.includes('social')) return 'Finish one daily quest each week ' +
    'and keep the streak alive.';
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * One protocol's farm plan: eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalNeeded(p);
  const hold = holdDays(age);
  const action = mainAction(p, capital, chain);
  const weekly = weeklyHabit(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, ` +
        `and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Open the protocol's own points, quests or rewards page and finish ` +
        `every free task it lists.`,
      cost: 'no fee for the tasks themselves',
      time: '20 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted ` +
        `in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's announcements once a week for snapshot dates, ` +
        `and do not move funds the day before one.`,
      cost: 'nothing but the check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page ` +
        `and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log ` +
        `so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
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

/** A board row's compact form for data.js; the farm plan is generated in the page. */
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
    signal: row.signal,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
  };
}

/** Everything the dashboard renders, built from the snapshot. */
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

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json carries no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json carries no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json carries no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json carries no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json carries no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
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
