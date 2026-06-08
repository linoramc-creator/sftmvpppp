"""Pydantic response/request models — the public contract of the service.

Every shape here has a 1:1 TypeScript mirror in
`Terminal_Export/src/types/options.ts`. Keep them in sync.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

OptionType = Literal["call", "put"]


# ── Single enriched contract ───────────────────────────────────────────
class OptionContract(BaseModel):
    contractSymbol: str
    type: OptionType
    strike: float
    lastPrice: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    mid: Optional[float] = None
    volume: Optional[int] = None
    openInterest: Optional[int] = None
    impliedVolatility: Optional[float] = None  # fraction (0.32 = 32%)
    inTheMoney: bool = False
    # Greeks — computed in code via bsm.py, never by an LLM.
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None   # per calendar day
    vega: Optional[float] = None    # per 1 vol point
    rho: Optional[float] = None     # per 1 rate point
    vanna: Optional[float] = None
    charm: Optional[float] = None
    intrinsic: Optional[float] = None
    extrinsic: Optional[float] = None


# ── /chain ──────────────────────────────────────────────────────────────
class ChainResponse(BaseModel):
    ticker: str
    expiry: str
    spot: float
    riskFreeRate: float
    dividendYield: float
    daysToExpiry: int
    T: float  # years
    calls: list[OptionContract]
    puts: list[OptionContract]
    cached: bool = False
    fetchedAt: str


# ── /expiries ─────────────────────────────────────────────────────────
class ExpiriesResponse(BaseModel):
    ticker: str
    spot: float
    expiries: list[str]
    dividendYield: float
    riskFreeRate: float


# ── /aggregations ─────────────────────────────────────────────────────
class StrikeExposure(BaseModel):
    strike: float
    gex: float       # net dealer gamma exposure ($ / 1% spot move)
    callGex: float
    putGex: float
    dex: float       # net dollar-delta ($)
    vex: float       # net dealer vega exposure ($ / 1 vol point)
    callOI: int
    putOI: int
    callVolume: int
    putVolume: int


class OIWall(BaseModel):
    strike: float
    openInterest: int
    type: OptionType


class AggregationsResponse(BaseModel):
    ticker: str
    expiry: str
    spot: float
    perStrike: list[StrikeExposure]
    totalGex: float
    totalDex: float
    totalVex: float
    gammaFlip: Optional[float] = None      # approx zero-gamma strike
    maxPain: Optional[float] = None
    putCallRatioOI: Optional[float] = None
    putCallRatioVol: Optional[float] = None
    expectedMovePct: Optional[float] = None   # ±1σ as fraction
    expectedMoveAbs: Optional[float] = None    # ±1σ in $
    expectedMoveStraddle: Optional[float] = None  # from ATM straddle mid
    atmIV: Optional[float] = None
    callWalls: list[OIWall]
    putWalls: list[OIWall]
    cached: bool = False
    fetchedAt: str


# ── /surface ──────────────────────────────────────────────────────────
class SurfacePoint(BaseModel):
    strike: float
    expiry: str
    daysToExpiry: int
    moneyness: float  # strike / spot
    iv: float         # fraction
    type: OptionType


class SurfaceResponse(BaseModel):
    ticker: str
    spot: float
    expiries: list[str]
    points: list[SurfacePoint]
    cached: bool = False
    fetchedAt: str


# ── /skew ─────────────────────────────────────────────────────────────
class SkewPoint(BaseModel):
    strike: float
    moneyness: float
    callIV: Optional[float] = None
    putIV: Optional[float] = None
    iv: Optional[float] = None  # OTM-side blended smile


class SkewResponse(BaseModel):
    ticker: str
    expiry: str
    spot: float
    points: list[SkewPoint]
    cached: bool = False
    fetchedAt: str


# ── /term-structure ───────────────────────────────────────────────────
class TermPoint(BaseModel):
    expiry: str
    daysToExpiry: int
    atmIV: Optional[float] = None
    expectedMovePct: Optional[float] = None


class TermStructureResponse(BaseModel):
    ticker: str
    spot: float
    points: list[TermPoint]
    cached: bool = False
    fetchedAt: str


# ── /ivhv ─────────────────────────────────────────────────────────────
class IVHVPoint(BaseModel):
    date: str
    hv: Optional[float] = None     # annualized realized vol (fraction)
    close: Optional[float] = None


class IVHVResponse(BaseModel):
    ticker: str
    window: int
    currentIV30: Optional[float] = None
    currentHV: Optional[float] = None
    variancePremium: Optional[float] = None  # IV30 − HV
    series: list[IVHVPoint]
    # IV rank / percentile need a history of IV snapshots we don't have yet.
    # See README → "TODO: IV rank". null until daily snapshots are populated.
    ivRank: Optional[float] = None
    ivPercentile: Optional[float] = None
    cached: bool = False
    fetchedAt: str


class ErrorResponse(BaseModel):
    error: str = Field(..., description="Human-readable error message")
    detail: Optional[str] = None
