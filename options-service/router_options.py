"""FastAPI router exposing the options analytics endpoints.

Every endpoint is read-only GET. Chains are pulled through the two-tier cache;
all Greeks/aggregations are computed in code (bsm.py + aggregations.py).
"""
from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

import aggregations as agg
import fetcher
from cache import chain_cache
from config import settings
from models import (
    AggregationsResponse,
    ChainResponse,
    ExpiriesResponse,
    IVHVPoint,
    IVHVResponse,
    OIWall,
    SkewPoint,
    SkewResponse,
    StrikeExposure,
    SurfacePoint,
    SurfaceResponse,
    TermPoint,
    TermStructureResponse,
)

router = APIRouter(prefix="/api/options", tags=["options"])

_TICKER_RE = re.compile(r"^[A-Za-z0-9.\-^]{1,12}$")


def _clean_ticker(ticker: str) -> str:
    t = (ticker or "").strip().upper()
    if not _TICKER_RE.match(t):
        raise HTTPException(status_code=400, detail=f"Ticker inválido: {ticker!r}")
    return t


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _get_chain_cached(ticker: str, expiry: str) -> dict:
    cached = chain_cache.get(ticker, expiry, settings.ttl_price_seconds)
    if cached is not None:
        return cached
    try:
        payload = fetcher.build_chain(ticker, expiry)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"yfinance falló para {ticker} {expiry}: {exc}")
    chain_cache.set(ticker, expiry, payload)
    payload = dict(payload)
    payload["cached"] = False
    return payload


# ── /expiries ─────────────────────────────────────────────────────────
@router.get("/expiries", response_model=ExpiriesResponse)
def expiries(ticker: str = Query(..., description="Underlying symbol, e.g. AAPL")):
    t = _clean_ticker(ticker)
    try:
        meta = fetcher.get_meta(t)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"No hay datos para {t}: {exc}")
    return ExpiriesResponse(**meta)


# ── /chain ─────────────────────────────────────────────────────────────
@router.get("/chain", response_model=ChainResponse)
def chain(ticker: str = Query(...), expiry: str = Query(..., description="YYYY-MM-DD")):
    data = _get_chain_cached(_clean_ticker(ticker), expiry)
    return ChainResponse(**data)


# ── /aggregations ─────────────────────────────────────────────────────
@router.get("/aggregations", response_model=AggregationsResponse)
def aggregations_endpoint(ticker: str = Query(...), expiry: str = Query(...)):
    t = _clean_ticker(ticker)
    data = _get_chain_cached(t, expiry)
    calls, puts, spot = data["calls"], data["puts"], data["spot"]

    per_strike, totals = agg.exposures_per_strike(calls, puts, spot, settings.contract_multiplier)
    pcr_oi, pcr_vol = agg.put_call_ratio(calls, puts)
    cw, pw = agg.oi_walls(calls, puts, n=5)
    aiv = agg.atm_iv(calls, puts, spot)
    straddle = agg.atm_straddle_mid(calls, puts, spot)
    em = agg.expected_move(spot, aiv, data["T"], straddle)

    return AggregationsResponse(
        ticker=t,
        expiry=expiry,
        spot=spot,
        perStrike=[StrikeExposure(**r) for r in per_strike],
        totalGex=totals["totalGex"],
        totalDex=totals["totalDex"],
        totalVex=totals["totalVex"],
        gammaFlip=agg.gamma_flip(per_strike),
        maxPain=agg.max_pain(calls, puts),
        putCallRatioOI=pcr_oi,
        putCallRatioVol=pcr_vol,
        expectedMovePct=em["pct"],
        expectedMoveAbs=em["abs"],
        expectedMoveStraddle=em["straddle"],
        atmIV=aiv,
        callWalls=[OIWall(**w) for w in cw],
        putWalls=[OIWall(**w) for w in pw],
        cached=data.get("cached", False),
        fetchedAt=data.get("fetchedAt", _now()),
    )


# ── /skew ─────────────────────────────────────────────────────────────
@router.get("/skew", response_model=SkewResponse)
def skew(ticker: str = Query(...), expiry: str = Query(...)):
    t = _clean_ticker(ticker)
    data = _get_chain_cached(t, expiry)
    spot = data["spot"]

    by_strike: dict[float, dict] = {}
    for c in data["calls"]:
        if c["strike"] is not None:
            by_strike.setdefault(c["strike"], {})["callIV"] = c["impliedVolatility"]
    for p in data["puts"]:
        if p["strike"] is not None:
            by_strike.setdefault(p["strike"], {})["putIV"] = p["impliedVolatility"]

    points = []
    for k in sorted(by_strike):
        civ = by_strike[k].get("callIV")
        piv = by_strike[k].get("putIV")
        # OTM-side smile: below spot favour OTM puts, above spot favour OTM calls.
        otm = piv if k < spot else civ
        if otm is None:
            otm = civ if civ is not None else piv
        points.append(SkewPoint(strike=k, moneyness=k / spot, callIV=civ, putIV=piv, iv=otm))

    return SkewResponse(
        ticker=t, expiry=expiry, spot=spot, points=points,
        cached=data.get("cached", False), fetchedAt=data.get("fetchedAt", _now()),
    )


# ── /term-structure ───────────────────────────────────────────────────
@router.get("/term-structure", response_model=TermStructureResponse)
def term_structure(ticker: str = Query(...), max_expiries: int = Query(12, ge=1, le=24)):
    t = _clean_ticker(ticker)
    try:
        meta = fetcher.get_meta(t)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"No hay datos para {t}: {exc}")
    spot = meta["spot"]

    points = []
    for expiry in meta["expiries"][:max_expiries]:
        try:
            data = _get_chain_cached(t, expiry)
        except HTTPException:
            continue
        aiv = agg.atm_iv(data["calls"], data["puts"], spot)
        em = agg.expected_move(spot, aiv, data["T"])
        points.append(TermPoint(expiry=expiry, daysToExpiry=data["daysToExpiry"],
                                atmIV=aiv, expectedMovePct=em["pct"]))

    return TermStructureResponse(ticker=t, spot=spot, points=points,
                                 cached=False, fetchedAt=_now())


# ── /surface ──────────────────────────────────────────────────────────
@router.get("/surface", response_model=SurfaceResponse)
def surface(
    ticker: str = Query(...),
    max_expiries: int = Query(8, ge=1, le=16),
    moneyness_min: float = Query(0.7, gt=0, lt=1),
    moneyness_max: float = Query(1.3, gt=1, lt=3),
):
    t = _clean_ticker(ticker)
    try:
        meta = fetcher.get_meta(t)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"No hay datos para {t}: {exc}")
    spot = meta["spot"]
    lo, hi = spot * moneyness_min, spot * moneyness_max

    points, expiries_used = [], []
    for expiry in meta["expiries"][:max_expiries]:
        try:
            data = _get_chain_cached(t, expiry)
        except HTTPException:
            continue
        expiries_used.append(expiry)
        days = data["daysToExpiry"]
        # OTM-side surface: puts below spot, calls above spot (cleaner skew).
        for p in data["puts"]:
            k, iv = p["strike"], p["impliedVolatility"]
            if k and iv and lo <= k <= hi and k < spot:
                points.append(SurfacePoint(strike=k, expiry=expiry, daysToExpiry=days,
                                           moneyness=k / spot, iv=iv, type="put"))
        for c in data["calls"]:
            k, iv = c["strike"], c["impliedVolatility"]
            if k and iv and lo <= k <= hi and k >= spot:
                points.append(SurfacePoint(strike=k, expiry=expiry, daysToExpiry=days,
                                           moneyness=k / spot, iv=iv, type="call"))

    return SurfaceResponse(ticker=t, spot=spot, expiries=expiries_used, points=points,
                           cached=False, fetchedAt=_now())


# ── /ivhv ─────────────────────────────────────────────────────────────
@router.get("/ivhv", response_model=IVHVResponse)
def ivhv(ticker: str = Query(...), window: int = Query(30, ge=5, le=252)):
    t = _clean_ticker(ticker)
    try:
        spot, dates, closes = fetcher.load_history(t, "1y")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"No hay histórico para {t}: {exc}")

    hv_series = agg.historical_volatility_series(closes, window)
    series = [IVHVPoint(date=d, hv=hv, close=c) for d, hv, c in zip(dates, hv_series, closes)]
    current_hv = agg.latest_hv(closes, window)

    # IV30: ATM IV of the listed expiry whose DTE is closest to 30 days.
    iv30 = None
    try:
        meta = fetcher.get_meta(t)
        best = None
        for e in meta["expiries"][:12]:
            d, _ = fetcher.year_fraction(e)
            if d < 0:
                continue
            if best is None or abs(d - 30) < abs(best[0] - 30):
                best = (d, e)
        if best:
            data = _get_chain_cached(t, best[1])
            iv30 = agg.atm_iv(data["calls"], data["puts"], data["spot"])
    except Exception:  # noqa: BLE001 - IV30 is best-effort; HV series still returns
        iv30 = None

    vp = (iv30 - current_hv) if (iv30 is not None and current_hv is not None) else None

    return IVHVResponse(
        ticker=t,
        window=window,
        currentIV30=iv30,
        currentHV=current_hv,
        variancePremium=vp,
        series=series,
        ivRank=None,        # TODO: needs daily IV snapshots — see README
        ivPercentile=None,  # TODO: idem
        cached=False,
        fetchedAt=_now(),
    )
