// ============================================================
// OPTIONS-DATA  Edge Function
// ------------------------------------------------------------
// Isolated, additive backend for the "Opciones" section of the terminal.
// Pulls option chains from Yahoo Finance and computes EVERY Greek and flow
// aggregation analytically in code (Black-Scholes-Merton) — never by an LLM.
//
// Mirrors the Python service that previously lived in options-service/, so the
// React client (src/lib/options-api.ts) and the TS types (src/types/options.ts)
// work unchanged. It does NOT touch the existing analyze-ticker function.
//
// Request:  POST { action, ticker, expiry?, window? }
//   actions: expiries | chain | aggregations | skew | surface |
//            term-structure | ivhv
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RISK_FREE_RATE = parseFloat(Deno.env.get("RISK_FREE_RATE") || "0.0525");
const CONTRACT_MULT = 100;
const MIN_IV = 0.01;
const MAX_IV = 5.0;

const YF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============================================================
// BLACK-SCHOLES-MERTON  —  ported verbatim from options-service/bsm.py
// All values computed analytically. Greeks operate on scalars per contract.
//   S spot · K strike · T years · r rate(frac) · q div-yield(frac) · sigma IV(frac)
// ============================================================

// erf via Abramowitz-Stegun 7.1.26 (max error ~1.5e-7) — ample for Greeks.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

const SQRT2 = Math.sqrt(2);
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
const normCdf = (x: number): number => 0.5 * (1 + erf(x / SQRT2));
const normPdf = (x: number): number => INV_SQRT_2PI * Math.exp(-0.5 * x * x);

interface D12 { d1: number; d2: number; valid: boolean; }

function d1d2(S: number, K: number, T: number, r: number, q: number, sigma: number): D12 {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) {
    return { d1: NaN, d2: NaN, valid: false };
  }
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / volSqrtT;
  const d2 = d1 - volSqrtT;
  return { d1, d2, valid: true };
}

interface Greeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null; // per calendar day
  vega: number | null;  // per 1 vol point
  rho: number | null;   // per 1 rate point
  vanna: number | null;
  charm: number | null;
}

// Trader-scaled Greeks (theta & charm per day, vega/rho/vanna per 1 point).
function greeks(
  S: number, K: number, T: number, r: number, q: number, sigma: number, isCall: boolean,
): Greeks {
  const { d1, d2, valid } = d1d2(S, K, T, r, q, sigma);
  if (!valid) {
    return { delta: null, gamma: null, theta: null, vega: null, rho: null, vanna: null, charm: null };
  }
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const pdf = normPdf(d1);

  const delta = isCall ? dq * normCdf(d1) : dq * (normCdf(d1) - 1);
  const gamma = (dq * pdf) / (S * sigma * sqrtT);
  const vega = S * dq * pdf * sqrtT; // per 1.00 vol

  const common = -(S * dq * pdf * sigma) / (2 * sqrtT);
  const thetaYr = isCall
    ? common - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1)
    : common + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1);

  const rhoRaw = isCall ? K * T * dr * normCdf(d2) : -K * T * dr * normCdf(-d2);
  const vannaRaw = (-dq * pdf * d2) / sigma;

  const charmCore = (dq * pdf * (2 * (r - q) * T - d2 * sigma * sqrtT)) / (2 * T * sigma * sqrtT);
  const charmYr = isCall
    ? q * dq * normCdf(d1) - charmCore
    : -q * dq * normCdf(-d1) - charmCore;

  const clean = (v: number): number | null => (Number.isFinite(v) ? v : null);
  return {
    delta: clean(delta),
    gamma: clean(gamma),
    theta: clean(thetaYr / 365),
    vega: clean(vega * 0.01),
    rho: clean(rhoRaw * 0.01),
    vanna: clean(vannaRaw * 0.01),
    charm: clean(charmYr / 365),
  };
}

// ============================================================
// TYPES (mirror src/types/options.ts)
// ============================================================
type OptType = "call" | "put";

interface Contract {
  contractSymbol: string;
  type: OptType;
  strike: number;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  vanna: number | null;
  charm: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
}

// ============================================================
// small numeric helpers
// ============================================================
const f = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => f(v) ?? 0; // for summable quantities
const iInt = (v: unknown): number | null => {
  const n = f(v);
  return n === null ? null : Math.trunc(n);
};

function nowIso(): string {
  return new Date().toISOString();
}

// (days_to_expiry, T years). Floors T at half a day to keep Greeks finite.
function yearFraction(expiry: string): { days: number; T: number } {
  const exp = Date.parse(`${expiry}T00:00:00Z`);
  const today = Date.now();
  const days = Math.floor((exp - today) / 86_400_000);
  let T = Math.max(days, 0) / 365;
  if (T <= 0) T = 0.5 / 365;
  return { days, T };
}

function isoFromEpoch(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

// ============================================================
// YAHOO FINANCE access (cookie + crumb, same approach as analyze-ticker)
// ============================================================
let yfAuth: { cookie: string; crumb: string; ts: number } | null = null;
const YF_AUTH_TTL = 25 * 60 * 1000;

async function yfGetAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (yfAuth && Date.now() - yfAuth.ts < YF_AUTH_TTL) return yfAuth;
  try {
    const readCookies = (r: Response | null): string => {
      if (!r) return "";
      const multi = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (multi.length) return multi.map((c) => c.split(";")[0]).join("; ");
      const one = r.headers.get("set-cookie");
      return one ? one.split(";")[0] : "";
    };
    let cookie = readCookies(
      await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": YF_UA }, signal: AbortSignal.timeout(8_000) }).catch(() => null),
    );
    if (!cookie) {
      cookie = readCookies(
        await fetch("https://finance.yahoo.com/quote/AAPL", { headers: { "User-Agent": YF_UA }, signal: AbortSignal.timeout(8_000) }).catch(() => null),
      );
    }
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YF_UA, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const crumb = r2 && r2.ok ? (await r2.text()).trim() : "";
    if (crumb) { yfAuth = { cookie, crumb, ts: Date.now() }; return yfAuth; }
    return cookie ? { cookie, crumb: "" } : null;
  } catch (_) { return null; }
}

// in-memory cache (per warm instance) so multi-expiry views stay cheap
interface CacheEntry { ts: number; data: unknown; }
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4h, matches the old Python TTL

function cacheGet<T>(key: string): T | undefined {
  const e = CACHE.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL) { CACHE.delete(key); return undefined; }
  return e.data as T;
}
function cacheSet(key: string, data: unknown): void {
  CACHE.set(key, { ts: Date.now(), data });
  if (CACHE.size > 200) {
    let oldest: string | null = null; let oldestTs = Infinity;
    for (const [k, v] of CACHE) if (v.ts < oldestTs) { oldestTs = v.ts; oldest = k; }
    if (oldest) CACHE.delete(oldest);
  }
}

interface YahooOptionResult {
  spot: number;
  dividendYield: number;
  expirationDates: number[]; // epoch seconds
  // present only when a specific (or default) expiry is returned:
  rawCalls: Record<string, unknown>[];
  rawPuts: Record<string, unknown>[];
}

async function yahooOptions(ticker: string, dateEpoch?: number): Promise<YahooOptionResult> {
  const auth = await yfGetAuth();
  const sym = encodeURIComponent(ticker.toUpperCase());
  let url = `https://query2.finance.yahoo.com/v7/finance/options/${sym}`;
  const qp: string[] = [];
  if (dateEpoch) qp.push(`date=${dateEpoch}`);
  if (auth?.crumb) qp.push(`crumb=${encodeURIComponent(auth.crumb)}`);
  if (qp.length) url += `?${qp.join("&")}`;

  const r = await fetch(url, {
    headers: { "User-Agent": YF_UA, ...(auth?.cookie ? { Cookie: auth.cookie } : {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new ApiError(`Yahoo respondió ${r.status} para ${ticker}`, 502);
  const j = await r.json();
  const res = j?.optionChain?.result?.[0];
  if (!res) {
    const errMsg = j?.optionChain?.error?.description || `Sin datos de opciones para ${ticker}`;
    throw new ApiError(errMsg, 404);
  }
  const quote = res.quote ?? {};
  const spot =
    f(quote.regularMarketPrice) ??
    f(quote.postMarketPrice) ??
    f(quote.regularMarketPreviousClose) ??
    0;
  if (!spot) throw new ApiError(`Sin precio spot para ${ticker}`, 404);

  // Yahoo: trailingAnnualDividendYield is a fraction; dividendYield is percent.
  let q = f(quote.trailingAnnualDividendYield);
  if (q === null) {
    const dyPct = f(quote.dividendYield);
    q = dyPct === null ? 0 : (dyPct > 1 ? dyPct / 100 : dyPct);
  }
  q = Math.max(0, Math.min(q ?? 0, 0.25));

  const opt = res.options?.[0] ?? {};
  return {
    spot,
    dividendYield: q,
    expirationDates: (res.expirationDates ?? []).map((e: unknown) => Number(e)).filter((e: number) => e > 0),
    rawCalls: opt.calls ?? [],
    rawPuts: opt.puts ?? [],
  };
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

// ============================================================
// ENRICH raw rows with BSM Greeks (port of fetcher.enrich_records)
// ============================================================
function enrich(
  rows: Record<string, unknown>[], type: OptType, S: number, T: number, r: number, q: number,
): Contract[] {
  const isCall = type === "call";
  return rows.map((rec) => {
    const k = f(rec.strike);
    const bid = f(rec.bid);
    const ask = f(rec.ask);
    const last = f(rec.lastPrice);
    let iv = f(rec.impliedVolatility);
    const badIv = iv === null || iv < MIN_IV || iv > MAX_IV;
    if (badIv) iv = null;

    let mid: number | null = null;
    if (bid !== null && ask !== null && bid > 0 && ask > 0) mid = (bid + ask) / 2;
    else if (last !== null && last > 0) mid = last;

    let intrinsic: number | null = null;
    if (k !== null) intrinsic = isCall ? Math.max(S - k, 0) : Math.max(k - S, 0);
    const extrinsic = mid !== null && intrinsic !== null ? mid - intrinsic : null;

    let itm = rec.inTheMoney as boolean | undefined;
    if (itm === undefined && k !== null) itm = isCall ? S > k : S < k;

    const g = !badIv && k !== null && iv !== null
      ? greeks(S, k, T, r, q, iv, isCall)
      : { delta: null, gamma: null, theta: null, vega: null, rho: null, vanna: null, charm: null };

    return {
      contractSymbol: String(rec.contractSymbol ?? `${type}-${k}`),
      type,
      strike: k ?? 0,
      lastPrice: last,
      bid,
      ask,
      mid,
      volume: iInt(rec.volume),
      openInterest: iInt(rec.openInterest),
      impliedVolatility: iv,
      inTheMoney: Boolean(itm),
      ...g,
      intrinsic,
      extrinsic,
    };
  });
}

// ============================================================
// AGGREGATIONS (port of options-service/aggregations.py)
// ============================================================
interface StrikeRow {
  strike: number; gex: number; callGex: number; putGex: number;
  dex: number; vex: number; callOI: number; putOI: number;
  callVolume: number; putVolume: number;
}

function exposuresPerStrike(calls: Contract[], puts: Contract[], spot: number, mult = CONTRACT_MULT) {
  const strikeSet = new Set<number>();
  calls.forEach((c) => strikeSet.add(c.strike));
  puts.forEach((p) => strikeSet.add(p.strike));
  const strikes = [...strikeSet].sort((a, b) => a - b);
  const table = new Map<number, StrikeRow>();
  for (const k of strikes) {
    table.set(k, { strike: k, gex: 0, callGex: 0, putGex: 0, dex: 0, vex: 0, callOI: 0, putOI: 0, callVolume: 0, putVolume: 0 });
  }
  const s2 = spot * spot * 0.01; // dollar-gamma per 1% spot move

  for (const c of calls) {
    const row = table.get(c.strike)!;
    const oi = Math.trunc(num(c.openInterest));
    row.callOI += oi;
    row.callVolume += Math.trunc(num(c.volume));
    if (c.gamma !== null) { const cg = c.gamma * oi * mult * s2; row.callGex += cg; row.gex += cg; }
    if (c.delta !== null) row.dex += c.delta * oi * mult * spot;
    if (c.vega !== null) row.vex += c.vega * oi * mult;
  }
  for (const p of puts) {
    const row = table.get(p.strike)!;
    const oi = Math.trunc(num(p.openInterest));
    row.putOI += oi;
    row.putVolume += Math.trunc(num(p.volume));
    if (p.gamma !== null) { const pg = -p.gamma * oi * mult * s2; row.putGex += pg; row.gex += pg; }
    if (p.delta !== null) row.dex += p.delta * oi * mult * spot; // put delta already negative
    if (p.vega !== null) row.vex += -p.vega * oi * mult;          // dealer short puts → negative vega
  }

  const perStrike = strikes.map((k) => table.get(k)!);
  const totals = {
    totalGex: perStrike.reduce((s, r) => s + r.gex, 0),
    totalDex: perStrike.reduce((s, r) => s + r.dex, 0),
    totalVex: perStrike.reduce((s, r) => s + r.vex, 0),
  };
  return { perStrike, totals };
}

function gammaFlip(perStrike: StrikeRow[]): number | null {
  const pts = [...perStrike].sort((a, b) => a.strike - b.strike);
  let cum = 0;
  let prevCum: number | null = null;
  let prevStrike = 0;
  for (const p of pts) {
    cum += p.gex;
    if (prevCum !== null && ((prevCum <= 0 && cum > 0) || (prevCum >= 0 && cum < 0))) {
      if (cum !== prevCum) {
        const frac = -prevCum / (cum - prevCum);
        return prevStrike + frac * (p.strike - prevStrike);
      }
      return p.strike;
    }
    prevCum = cum;
    prevStrike = p.strike;
  }
  return null;
}

function maxPain(calls: Contract[], puts: Contract[]): number | null {
  const strikeSet = new Set<number>();
  calls.forEach((c) => strikeSet.add(c.strike));
  puts.forEach((p) => strikeSet.add(p.strike));
  const strikes = [...strikeSet].sort((a, b) => a - b);
  if (!strikes.length) return null;
  let bestK: number | null = null;
  let bestVal = Infinity;
  for (const kt of strikes) {
    let total = 0;
    for (const c of calls) if (kt > c.strike) total += (kt - c.strike) * num(c.openInterest);
    for (const p of puts) if (kt < p.strike) total += (p.strike - kt) * num(p.openInterest);
    if (total < bestVal) { bestVal = total; bestK = kt; }
  }
  return bestK;
}

function putCallRatio(calls: Contract[], puts: Contract[]) {
  const callOI = calls.reduce((s, c) => s + num(c.openInterest), 0);
  const putOI = puts.reduce((s, p) => s + num(p.openInterest), 0);
  const callVol = calls.reduce((s, c) => s + num(c.volume), 0);
  const putVol = puts.reduce((s, p) => s + num(p.volume), 0);
  return {
    oi: callOI > 0 ? putOI / callOI : null,
    vol: callVol > 0 ? putVol / callVol : null,
  };
}

function oiWalls(calls: Contract[], puts: Contract[], n = 5) {
  const cw = calls
    .filter((c) => num(c.openInterest) > 0)
    .map((c) => ({ strike: c.strike, openInterest: Math.trunc(num(c.openInterest)), type: "call" as OptType }))
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, n);
  const pw = puts
    .filter((p) => num(p.openInterest) > 0)
    .map((p) => ({ strike: p.strike, openInterest: Math.trunc(num(p.openInterest)), type: "put" as OptType }))
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, n);
  return { cw, pw };
}

function atmIv(calls: Contract[], puts: Contract[], spot: number): number | null {
  const nearest = (rows: Contract[]): number | null => {
    const valid = rows
      .map((r) => ({ d: Math.abs(r.strike - spot), iv: r.impliedVolatility }))
      .filter((x) => x.iv !== null && x.iv > 0)
      .sort((a, b) => a.d - b.d);
    return valid.length ? valid[0].iv : null;
  };
  const civ = nearest(calls);
  const piv = nearest(puts);
  const vals = [civ, piv].filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function atmStraddleMid(calls: Contract[], puts: Contract[], spot: number): number | null {
  const nearestMid = (rows: Contract[]): number | null => {
    const cand = rows
      .map((r) => ({ d: Math.abs(r.strike - spot), m: r.mid }))
      .filter((x) => x.m !== null && x.m > 0)
      .sort((a, b) => a.d - b.d);
    return cand.length ? cand[0].m : null;
  };
  const cm = nearestMid(calls);
  const pm = nearestMid(puts);
  if (cm === null || pm === null) return null;
  return cm + pm;
}

function expectedMove(spot: number, iv: number | null, T: number) {
  const pct = iv !== null && iv > 0 && T > 0 ? iv * Math.sqrt(T) : null;
  const abs = pct !== null ? spot * pct : null;
  return { pct, abs };
}

// Rolling annualized realized vol from daily closes (√252).
function hvSeries(closes: number[], window = 30): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < window + 1) return out;
  const logRet: number[] = [];
  for (let i = 1; i < n; i++) logRet.push(Math.log(closes[i] / closes[i - 1]));
  // logRet[i-1] aligns to close index i
  for (let i = window; i < n; i++) {
    const win = logRet.slice(i - window, i);
    if (win.length === window && win.every((x) => Number.isFinite(x))) {
      const mean = win.reduce((s, x) => s + x, 0) / window;
      const variance = win.reduce((s, x) => s + (x - mean) ** 2, 0) / (window - 1);
      out[i] = Math.sqrt(variance) * Math.sqrt(252);
    }
  }
  return out;
}

// ============================================================
// Yahoo daily history (v8 chart) for realized vol
// ============================================================
async function yahooHistory(ticker: string, range = "1y"): Promise<{ dates: string[]; closes: number[] }> {
  const sym = encodeURIComponent(ticker.toUpperCase());
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": YF_UA }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return { dates: [], closes: [] };
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts: number[] | undefined = res?.timestamp;
  const rawCloses: (number | null)[] | undefined = res?.indicators?.quote?.[0]?.close;
  if (!ts || !rawCloses) return { dates: [], closes: [] };
  const dates: string[] = [];
  const closes: number[] = [];
  let last: number | null = null;
  for (let i = 0; i < ts.length; i++) {
    const c = rawCloses[i] ?? last;
    if (c === null || c === undefined) continue;
    last = c;
    dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    closes.push(c);
  }
  return { dates, closes };
}

// ============================================================
// HIGH-LEVEL BUILDERS
// ============================================================
async function getMeta(ticker: string) {
  const key = `meta:${ticker}`;
  const cached = cacheGet<YahooOptionResult>(key);
  const res = cached ?? (await yahooOptions(ticker));
  if (!cached) cacheSet(key, res);
  return res;
}

// Resolve a "YYYY-MM-DD" expiry to the matching Yahoo epoch.
function expiryToEpoch(dateStr: string, epochs: number[]): number | undefined {
  return epochs.find((e) => isoFromEpoch(e) === dateStr);
}

async function buildChain(ticker: string, expiry: string) {
  const key = `chain:${ticker}:${expiry}`;
  const cached = cacheGet<{ spot: number; q: number; calls: Contract[]; puts: Contract[]; days: number; T: number }>(key);
  if (cached) return cached;

  const meta = await getMeta(ticker);
  const epoch = expiryToEpoch(expiry, meta.expirationDates);
  const data = await yahooOptions(ticker, epoch);
  const { days, T } = yearFraction(expiry);
  const r = RISK_FREE_RATE;
  const q = data.dividendYield;
  const calls = enrich(data.rawCalls, "call", data.spot, T, r, q);
  const puts = enrich(data.rawPuts, "put", data.spot, T, r, q);
  const result = { spot: data.spot, q, calls, puts, days, T };
  cacheSet(key, result);
  return result;
}

// ============================================================
// ACTION HANDLERS — return shapes matching src/types/options.ts
// ============================================================
async function handleExpiries(ticker: string) {
  const meta = await getMeta(ticker);
  return {
    ticker: ticker.toUpperCase(),
    spot: meta.spot,
    expiries: meta.expirationDates.map(isoFromEpoch),
    dividendYield: meta.dividendYield,
    riskFreeRate: RISK_FREE_RATE,
  };
}

async function handleChain(ticker: string, expiry: string) {
  const c = await buildChain(ticker, expiry);
  return {
    ticker: ticker.toUpperCase(),
    expiry,
    spot: c.spot,
    riskFreeRate: RISK_FREE_RATE,
    dividendYield: c.q,
    daysToExpiry: c.days,
    T: c.T,
    calls: c.calls,
    puts: c.puts,
    cached: false,
    fetchedAt: nowIso(),
  };
}

async function handleAggregations(ticker: string, expiry: string) {
  const c = await buildChain(ticker, expiry);
  const { perStrike, totals } = exposuresPerStrike(c.calls, c.puts, c.spot);
  const { cw, pw } = oiWalls(c.calls, c.puts);
  const pcr = putCallRatio(c.calls, c.puts);
  const iv = atmIv(c.calls, c.puts, c.spot);
  const straddle = atmStraddleMid(c.calls, c.puts, c.spot);
  const em = expectedMove(c.spot, iv, c.T);
  return {
    ticker: ticker.toUpperCase(),
    expiry,
    spot: c.spot,
    perStrike,
    totalGex: totals.totalGex,
    totalDex: totals.totalDex,
    totalVex: totals.totalVex,
    gammaFlip: gammaFlip(perStrike),
    maxPain: maxPain(c.calls, c.puts),
    putCallRatioOI: pcr.oi,
    putCallRatioVol: pcr.vol,
    expectedMovePct: em.pct,
    expectedMoveAbs: em.abs,
    expectedMoveStraddle: straddle,
    atmIV: iv,
    callWalls: cw,
    putWalls: pw,
    cached: false,
    fetchedAt: nowIso(),
  };
}

async function handleSkew(ticker: string, expiry: string) {
  const c = await buildChain(ticker, expiry);
  const callMap = new Map<number, Contract>();
  const putMap = new Map<number, Contract>();
  c.calls.forEach((x) => callMap.set(x.strike, x));
  c.puts.forEach((x) => putMap.set(x.strike, x));
  const strikes = [...new Set([...callMap.keys(), ...putMap.keys()])].sort((a, b) => a - b);
  const points = strikes.map((k) => {
    const callIV = callMap.get(k)?.impliedVolatility ?? null;
    const putIV = putMap.get(k)?.impliedVolatility ?? null;
    // OTM-side smile: OTM calls above spot, OTM puts below.
    const smile = k >= c.spot ? callIV : putIV;
    return { strike: k, moneyness: k / c.spot, callIV, putIV, iv: smile };
  });
  return {
    ticker: ticker.toUpperCase(),
    expiry,
    spot: c.spot,
    points,
    cached: false,
    fetchedAt: nowIso(),
  };
}

async function handleTermStructure(ticker: string, maxExpiries = 8) {
  const meta = await getMeta(ticker);
  const expiries = meta.expirationDates.slice(0, maxExpiries).map(isoFromEpoch);
  const points = [];
  for (const expiry of expiries) {
    try {
      const c = await buildChain(ticker, expiry);
      const iv = atmIv(c.calls, c.puts, c.spot);
      const em = expectedMove(c.spot, iv, c.T);
      points.push({ expiry, daysToExpiry: c.days, atmIV: iv, expectedMovePct: em.pct });
    } catch (_) { /* skip an expiry that fails to load */ }
  }
  return {
    ticker: ticker.toUpperCase(),
    spot: meta.spot,
    points,
    cached: false,
    fetchedAt: nowIso(),
  };
}

async function handleSurface(ticker: string, maxExpiries = 8, mMin = 0.7, mMax = 1.3) {
  const meta = await getMeta(ticker);
  const expiries = meta.expirationDates.slice(0, maxExpiries).map(isoFromEpoch);
  const points = [];
  const used: string[] = [];
  for (const expiry of expiries) {
    try {
      const c = await buildChain(ticker, expiry);
      used.push(expiry);
      const add = (rows: Contract[], type: OptType) => {
        for (const r of rows) {
          const m = r.strike / c.spot;
          if (r.impliedVolatility === null || m < mMin || m > mMax) continue;
          // OTM side only: OTM calls (m>=1) and OTM puts (m<1) for a clean surface
          if ((type === "call" && m >= 1) || (type === "put" && m < 1)) {
            points.push({ strike: r.strike, expiry, daysToExpiry: c.days, moneyness: m, iv: r.impliedVolatility, type });
          }
        }
      };
      add(c.calls, "call");
      add(c.puts, "put");
    } catch (_) { /* skip */ }
  }
  return {
    ticker: ticker.toUpperCase(),
    spot: meta.spot,
    expiries: used,
    points,
    cached: false,
    fetchedAt: nowIso(),
  };
}

async function handleIvHv(ticker: string, window = 30) {
  const meta = await getMeta(ticker);
  const { dates, closes } = await yahooHistory(ticker, "1y");
  const series = hvSeries(closes, window);
  const out = dates.map((d, i) => ({ date: d, hv: series[i], close: closes[i] ?? null }));

  // currentIV30: ATM IV of the expiry nearest 30 DTE.
  let currentIV30: number | null = null;
  try {
    const expiries = meta.expirationDates.map(isoFromEpoch);
    let best: string | null = null;
    let bestDiff = Infinity;
    for (const e of expiries) {
      const { days } = yearFraction(e);
      const diff = Math.abs(days - 30);
      if (diff < bestDiff) { bestDiff = diff; best = e; }
    }
    if (best) {
      const c = await buildChain(ticker, best);
      currentIV30 = atmIv(c.calls, c.puts, c.spot);
    }
  } catch (_) { /* leave null */ }

  let currentHV: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) { if (series[i] !== null) { currentHV = series[i]; break; } }

  const variancePremium = currentIV30 !== null && currentHV !== null ? currentIV30 - currentHV : null;

  return {
    ticker: ticker.toUpperCase(),
    window,
    currentIV30,
    currentHV,
    variancePremium,
    series: out,
    ivRank: null,       // needs daily IV snapshots (see options-service README)
    ivPercentile: null, // idem
    cached: false,
    fetchedAt: nowIso(),
  };
}

// ============================================================
// HTTP entrypoint
// ============================================================
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const expiry = body.expiry ? String(body.expiry) : "";
    const window = body.window ? Number(body.window) : 30;

    if (!ticker || !/^[A-Z0-9.\-^]{1,12}$/.test(ticker)) {
      return json({ error: "Ticker inválido" }, 400);
    }
    const needsExpiry = ["chain", "aggregations", "skew"];
    if (needsExpiry.includes(action) && !expiry) {
      return json({ error: `La acción '${action}' requiere 'expiry'` }, 400);
    }

    let result: unknown;
    switch (action) {
      case "expiries":       result = await handleExpiries(ticker); break;
      case "chain":          result = await handleChain(ticker, expiry); break;
      case "aggregations":   result = await handleAggregations(ticker, expiry); break;
      case "skew":           result = await handleSkew(ticker, expiry); break;
      case "term-structure": result = await handleTermStructure(ticker); break;
      case "surface":        result = await handleSurface(ticker); break;
      case "ivhv":           result = await handleIvHv(ticker, window); break;
      default:
        return json({ error: `Acción desconocida: '${action}'` }, 400);
    }
    return json(result);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error("[options-data] error:", e);
    return json({ error: (e as Error).message || "Error interno" }, 500);
  }
});
