"""Options-flow aggregations — GEX, DEX, VEX, max pain, OI walls, expected move.

Pure functions operating on plain dicts (no yfinance, no Pydantic) so they are
trivially unit-testable. Each contract dict is expected to carry at least:
    strike, openInterest, volume, delta, gamma, vega, impliedVolatility, mid

Sign conventions (documented because they are a frequent source of confusion):
    DEX  net dollar-delta = Σ δ · OI · mult · S      (puts are negative via δ<0)
    GEX  dealer gamma     = Σ ±γ · OI · mult · S²·1% (calls +, puts −; SqueezeMetrics-style)
    VEX  dealer vega       = Σ ±vega1pt · OI · mult   (calls +, puts −, same convention)
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np


def _num(v) -> float:
    """Coerce to float, mapping None/NaN to 0.0 (for summable quantities)."""
    if v is None:
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if math.isnan(f) else f


def _opt(v) -> Optional[float]:
    """Coerce to float or None (for Greeks that may legitimately be missing)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


# ── GEX / DEX / VEX per strike ─────────────────────────────────────────
def exposures_per_strike(calls: list[dict], puts: list[dict], spot: float, mult: int = 100):
    """Return (per_strike list, totals dict) of gamma/delta/vega exposures.

    per_strike is sorted ascending by strike. Each entry has gex/callGex/putGex/
    dex/vex plus call/put OI and volume.
    """
    strikes = sorted({_num(c["strike"]) for c in calls} | {_num(p["strike"]) for p in puts})
    table: dict[float, dict] = {
        k: {
            "strike": k, "gex": 0.0, "callGex": 0.0, "putGex": 0.0,
            "dex": 0.0, "vex": 0.0,
            "callOI": 0, "putOI": 0, "callVolume": 0, "putVolume": 0,
        }
        for k in strikes
    }
    s2 = spot * spot * 0.01  # dollar-gamma scaling: per 1% spot move

    for c in calls:
        k = _num(c["strike"])
        row = table[k]
        oi = int(_num(c.get("openInterest")))
        row["callOI"] += oi
        row["callVolume"] += int(_num(c.get("volume")))
        g, d, v = _opt(c.get("gamma")), _opt(c.get("delta")), _opt(c.get("vega"))
        if g is not None:
            cg = g * oi * mult * s2
            row["callGex"] += cg
            row["gex"] += cg
        if d is not None:
            row["dex"] += d * oi * mult * spot
        if v is not None:
            row["vex"] += v * oi * mult

    for p in puts:
        k = _num(p["strike"])
        row = table[k]
        oi = int(_num(p.get("openInterest")))
        row["putOI"] += oi
        row["putVolume"] += int(_num(p.get("volume")))
        g, d, v = _opt(p.get("gamma")), _opt(p.get("delta")), _opt(p.get("vega"))
        if g is not None:
            pg = -g * oi * mult * s2          # dealer short puts → negative gamma
            row["putGex"] += pg
            row["gex"] += pg
        if d is not None:
            row["dex"] += d * oi * mult * spot  # put delta already negative
        if v is not None:
            row["vex"] += -v * oi * mult         # dealer short puts → negative vega

    per_strike = [table[k] for k in strikes]
    totals = {
        "totalGex": sum(r["gex"] for r in per_strike),
        "totalDex": sum(r["dex"] for r in per_strike),
        "totalVex": sum(r["vex"] for r in per_strike),
    }
    return per_strike, totals


def gamma_flip(per_strike: list[dict]) -> Optional[float]:
    """Approximate the zero-gamma strike via the cumulative-GEX sign change.

    Sums net GEX from the lowest strike up; the level where the running total
    crosses zero is the gamma-flip proxy (linear interpolation between strikes).
    """
    pts = sorted(per_strike, key=lambda x: x["strike"])
    cum = 0.0
    prev_cum: Optional[float] = None
    prev_strike: Optional[float] = None
    for p in pts:
        cum += p["gex"]
        if prev_cum is not None and ((prev_cum <= 0 < cum) or (prev_cum >= 0 > cum)):
            if cum != prev_cum:
                frac = -prev_cum / (cum - prev_cum)
                return prev_strike + frac * (p["strike"] - prev_strike)
            return p["strike"]
        prev_cum, prev_strike = cum, p["strike"]
    return None


# ── Max pain ──────────────────────────────────────────────────────────
def max_pain(calls: list[dict], puts: list[dict]) -> Optional[float]:
    """Strike that minimizes total intrinsic value paid to option holders."""
    strikes = sorted({_num(c["strike"]) for c in calls} | {_num(p["strike"]) for p in puts})
    if not strikes:
        return None
    best_k, best_val = None, None
    for kt in strikes:
        total = 0.0
        for c in calls:
            ks = _num(c["strike"])
            if kt > ks:
                total += (kt - ks) * _num(c.get("openInterest"))
        for p in puts:
            ks = _num(p["strike"])
            if kt < ks:
                total += (ks - kt) * _num(p.get("openInterest"))
        if best_val is None or total < best_val:
            best_val, best_k = total, kt
    return best_k


# ── Put/Call ratios ───────────────────────────────────────────────────
def put_call_ratio(calls: list[dict], puts: list[dict]):
    call_oi = sum(_num(c.get("openInterest")) for c in calls)
    put_oi = sum(_num(p.get("openInterest")) for p in puts)
    call_vol = sum(_num(c.get("volume")) for c in calls)
    put_vol = sum(_num(p.get("volume")) for p in puts)
    oi = (put_oi / call_oi) if call_oi > 0 else None
    vol = (put_vol / call_vol) if call_vol > 0 else None
    return oi, vol


# ── OI walls ──────────────────────────────────────────────────────────
def oi_walls(calls: list[dict], puts: list[dict], n: int = 5):
    cw = sorted(
        [{"strike": _num(c["strike"]), "openInterest": int(_num(c.get("openInterest"))), "type": "call"}
         for c in calls if _num(c.get("openInterest")) > 0],
        key=lambda x: x["openInterest"], reverse=True,
    )[:n]
    pw = sorted(
        [{"strike": _num(p["strike"]), "openInterest": int(_num(p.get("openInterest"))), "type": "put"}
         for p in puts if _num(p.get("openInterest")) > 0],
        key=lambda x: x["openInterest"], reverse=True,
    )[:n]
    return cw, pw


# ── ATM IV + expected move ────────────────────────────────────────────
def atm_iv(calls: list[dict], puts: list[dict], spot: float) -> Optional[float]:
    """IV at the strike nearest spot, averaged across call & put when both exist."""
    def nearest(rows):
        valid = [(abs(_num(r["strike"]) - spot), _opt(r.get("impliedVolatility"))) for r in rows]
        valid = [(d, iv) for d, iv in valid if iv is not None and iv > 0]
        if not valid:
            return None
        valid.sort(key=lambda x: x[0])
        return valid[0][1]

    civ, piv = nearest(calls), nearest(puts)
    vals = [v for v in (civ, piv) if v is not None]
    return sum(vals) / len(vals) if vals else None


def atm_straddle_mid(calls: list[dict], puts: list[dict], spot: float) -> Optional[float]:
    """ATM straddle mid price ≈ market's expected move in $ to expiry."""
    def nearest_mid(rows):
        cand = [(abs(_num(r["strike"]) - spot), _opt(r.get("mid"))) for r in rows]
        cand = [(d, m) for d, m in cand if m is not None and m > 0]
        if not cand:
            return None
        cand.sort(key=lambda x: x[0])
        return cand[0][1]

    cm, pm = nearest_mid(calls), nearest_mid(puts)
    if cm is None or pm is None:
        return None
    return cm + pm


def expected_move(spot: float, iv: Optional[float], T: float, straddle: Optional[float] = None):
    """±1σ expected move. pct = IV·√T; abs = spot·pct."""
    em_pct = iv * math.sqrt(T) if (iv is not None and iv > 0 and T > 0) else None
    em_abs = spot * em_pct if em_pct is not None else None
    return {"pct": em_pct, "abs": em_abs, "straddle": straddle}


# ── Historical (realized) volatility ──────────────────────────────────
def historical_volatility_series(closes: list[float], window: int = 30):
    """Rolling annualized realized vol from daily closes.

    Returns a list the same length as `closes`; entries before `window+1`
    observations are None. Annualized by √252 from daily log-return std.
    """
    arr = np.asarray([_num(c) for c in closes], dtype=float)
    n = len(arr)
    out: list[Optional[float]] = [None] * n
    if n < window + 1:
        return out
    log_ret = np.diff(np.log(arr))  # length n-1, aligned to index 1..n-1
    for i in range(window, n):
        win = log_ret[i - window:i]
        if len(win) == window and np.all(np.isfinite(win)):
            out[i] = float(np.std(win, ddof=1) * math.sqrt(252.0))
    return out


def latest_hv(closes: list[float], window: int = 30) -> Optional[float]:
    series = historical_volatility_series(closes, window)
    for v in reversed(series):
        if v is not None:
            return v
    return None
