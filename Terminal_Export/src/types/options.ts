// TypeScript mirrors of the Python service Pydantic models
// (options-service/models.py). Keep the two in sync.

export type OptionType = "call" | "put";

export interface OptionContract {
  contractSymbol: string;
  type: OptionType;
  strike: number;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null; // fraction (0.32 = 32%)
  inTheMoney: boolean;
  // Greeks — computed in code (BSM), never by an LLM
  delta: number | null;
  gamma: number | null;
  theta: number | null;  // per calendar day
  vega: number | null;   // per 1 vol point
  rho: number | null;    // per 1 rate point
  vanna: number | null;
  charm: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
}

export interface ChainResponse {
  ticker: string;
  expiry: string;
  spot: number;
  riskFreeRate: number;
  dividendYield: number;
  daysToExpiry: number;
  T: number;
  calls: OptionContract[];
  puts: OptionContract[];
  cached: boolean;
  fetchedAt: string;
}

export interface ExpiriesResponse {
  ticker: string;
  spot: number;
  expiries: string[];
  dividendYield: number;
  riskFreeRate: number;
}

export interface StrikeExposure {
  strike: number;
  gex: number;      // net dealer gamma ($ / 1% spot move)
  callGex: number;
  putGex: number;
  dex: number;      // net dollar-delta ($)
  vex: number;      // net dealer vega ($ / vol point)
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
}

export interface OIWall {
  strike: number;
  openInterest: number;
  type: OptionType;
}

export interface AggregationsResponse {
  ticker: string;
  expiry: string;
  spot: number;
  perStrike: StrikeExposure[];
  totalGex: number;
  totalDex: number;
  totalVex: number;
  gammaFlip: number | null;
  maxPain: number | null;
  putCallRatioOI: number | null;
  putCallRatioVol: number | null;
  expectedMovePct: number | null;
  expectedMoveAbs: number | null;
  expectedMoveStraddle: number | null;
  atmIV: number | null;
  callWalls: OIWall[];
  putWalls: OIWall[];
  cached: boolean;
  fetchedAt: string;
}

export interface SurfacePoint {
  strike: number;
  expiry: string;
  daysToExpiry: number;
  moneyness: number;
  iv: number;
  type: OptionType;
}

export interface SurfaceResponse {
  ticker: string;
  spot: number;
  expiries: string[];
  points: SurfacePoint[];
  cached: boolean;
  fetchedAt: string;
}

export interface SkewPoint {
  strike: number;
  moneyness: number;
  callIV: number | null;
  putIV: number | null;
  iv: number | null;
}

export interface SkewResponse {
  ticker: string;
  expiry: string;
  spot: number;
  points: SkewPoint[];
  cached: boolean;
  fetchedAt: string;
}

export interface TermPoint {
  expiry: string;
  daysToExpiry: number;
  atmIV: number | null;
  expectedMovePct: number | null;
}

export interface TermStructureResponse {
  ticker: string;
  spot: number;
  points: TermPoint[];
  cached: boolean;
  fetchedAt: string;
}

export interface IVHVPoint {
  date: string;
  hv: number | null;
  close: number | null;
}

export interface IVHVResponse {
  ticker: string;
  window: number;
  currentIV30: number | null;
  currentHV: number | null;
  variancePremium: number | null;
  series: IVHVPoint[];
  ivRank: number | null;       // null until daily IV snapshots exist (see service README)
  ivPercentile: number | null; // idem
  cached: boolean;
  fetchedAt: string;
}
