"""Market-data layer: yfinance access + Greeks enrichment.

The yfinance-facing functions are thin and resilient (retries, defensive
parsing). The valuable transform — turning raw option rows into contracts with
computed Greeks — lives in `enrich_records`, which is a pure function over plain
dicts (no pandas / no network) and is unit-tested directly.
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Optional

import numpy as np

import bsm
from config import settings

try:
    from tenacity import retry, stop_after_attempt, wait_exponential

    _retry = retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
        reraise=True,
    )
except ImportError:  # pragma: no cover - tenacity optional for tests
    def _retry(fn):
        return fn


# ── scalar parsing helpers (records come from pandas → numpy scalars/NaN) ──
def _f(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _i(v) -> Optional[int]:
    f = _f(v)
    return None if f is None else int(f)


def _none_if_nan(x) -> Optional[float]:
    if x is None:
        return None
    f = float(x)
    return None if math.isnan(f) else f


# ── PURE: enrich raw option rows with Greeks ───────────────────────────
def enrich_records(
    records: list[dict],
    opt_type: str,
    S: float,
    T: float,
    r: float,
    q: float,
    min_iv: float = None,
    max_iv: float = None,
) -> list[dict]:
    """Attach BSM Greeks + intrinsic/extrinsic value to raw option rows.

    `records` are plain dicts (e.g. from DataFrame.to_dict("records")). IV that
    is missing or outside [min_iv, max_iv] is treated as unusable: Greeks become
    None, but the row is retained (OI/volume still feed flow aggregations).
    """
    min_iv = settings.min_iv if min_iv is None else min_iv
    max_iv = settings.max_iv if max_iv is None else max_iv
    is_call = opt_type == "call"
    n = len(records)
    if n == 0:
        return []

    strikes = np.array([_f(rec.get("strike")) if _f(rec.get("strike")) is not None else np.nan
                        for rec in records], dtype=float)
    ivs = np.array([_f(rec.get("impliedVolatility")) if _f(rec.get("impliedVolatility")) is not None else np.nan
                    for rec in records], dtype=float)

    # Hygiene: null IV outside the sane band so Greeks come out NaN → None.
    bad_iv = ~np.isfinite(ivs) | (ivs < min_iv) | (ivs > max_iv)
    ivs_clean = np.where(bad_iv, np.nan, ivs)

    g = bsm.greeks(S, strikes, T, r, q, ivs_clean, is_call)

    out: list[dict] = []
    for i, rec in enumerate(records):
        k = _f(rec.get("strike"))
        bid = _f(rec.get("bid"))
        ask = _f(rec.get("ask"))
        last = _f(rec.get("lastPrice"))
        iv = None if bad_iv[i] else _f(rec.get("impliedVolatility"))

        mid = None
        if bid is not None and ask is not None and bid > 0 and ask > 0:
            mid = (bid + ask) / 2.0
        elif last is not None and last > 0:
            mid = last

        intrinsic = None
        if k is not None:
            intrinsic = max(S - k, 0.0) if is_call else max(k - S, 0.0)
        extrinsic = (mid - intrinsic) if (mid is not None and intrinsic is not None) else None

        itm = rec.get("inTheMoney")
        if itm is None and k is not None:
            itm = (S > k) if is_call else (S < k)

        out.append({
            "contractSymbol": str(rec.get("contractSymbol") or f"{opt_type}-{k}"),
            "type": opt_type,
            "strike": k,
            "lastPrice": last,
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "volume": _i(rec.get("volume")),
            "openInterest": _i(rec.get("openInterest")),
            "impliedVolatility": iv,
            "inTheMoney": bool(itm) if itm is not None else False,
            "delta": _none_if_nan(_idx(g["delta"], i)),
            "gamma": _none_if_nan(_idx(g["gamma"], i)),
            "theta": _none_if_nan(_idx(g["theta"], i)),
            "vega": _none_if_nan(_idx(g["vega"], i)),
            "rho": _none_if_nan(_idx(g["rho"], i)),
            "vanna": _none_if_nan(_idx(g["vanna"], i)),
            "charm": _none_if_nan(_idx(g["charm"], i)),
            "intrinsic": intrinsic,
            "extrinsic": extrinsic,
        })
    return out


def _idx(arr, i):
    """Index a Greek result that may be a numpy array or a python scalar."""
    if isinstance(arr, np.ndarray):
        return arr[i] if arr.ndim else arr.item()
    return arr


def year_fraction(expiry: str, today: Optional[date] = None) -> tuple[int, float]:
    """(days_to_expiry, T_years). Floors T at half a day to keep Greeks finite."""
    today = today or date.today()
    exp = datetime.strptime(expiry, "%Y-%m-%d").date()
    days = (exp - today).days
    T = max(days, 0) / 365.0
    if T <= 0:
        T = 0.5 / 365.0  # 0DTE pragmatic floor
    return days, T


# ── yfinance access (network) ──────────────────────────────────────────
def _ticker(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


@_retry
def get_spot(t) -> Optional[float]:
    try:
        fi = t.fast_info
        for key in ("lastPrice", "last_price"):
            try:
                v = fi[key]
                if v:
                    return float(v)
            except Exception:  # noqa: BLE001
                pass
        v = getattr(fi, "last_price", None)
        if v:
            return float(v)
    except Exception:  # noqa: BLE001
        pass
    h = t.history(period="1d")
    if len(h):
        return float(h["Close"].iloc[-1])
    return None


def get_dividend_yield(t) -> float:
    try:
        info = t.info
        dy = info.get("dividendYield")
        if dy is None:
            return 0.0
        dy = float(dy)
        if dy > 1.0:           # some yfinance versions report percent
            dy /= 100.0
        return max(0.0, min(dy, 0.25))
    except Exception:  # noqa: BLE001
        return 0.0


@_retry
def get_expiries(t) -> list[str]:
    return list(t.options or [])


@_retry
def get_raw_chain(t, expiry: str):
    """Return (call_records, put_records) as plain dicts for a single expiry."""
    oc = t.option_chain(expiry)
    calls = oc.calls.to_dict("records") if oc.calls is not None else []
    puts = oc.puts.to_dict("records") if oc.puts is not None else []
    return calls, puts


@_retry
def get_history_closes(t, period: str = "1y"):
    """Return (dates[isostr], closes[float]) for realized-vol / IV-HV charts."""
    h = t.history(period=period, interval="1d")
    if h is None or len(h) == 0:
        return [], []
    dates = [d.strftime("%Y-%m-%d") for d in h.index]
    closes = [float(c) for c in h["Close"].tolist()]
    return dates, closes


# ── high-level builders ─────────────────────────────────────────────────
def build_chain(symbol: str, expiry: str) -> dict:
    """Full enriched chain for one expiry (no caching here — caller caches)."""
    t = _ticker(symbol)
    spot = get_spot(t)
    if spot is None:
        raise ValueError(f"No spot price for {symbol}")
    q = get_dividend_yield(t)
    r = settings.risk_free_rate
    days, T = year_fraction(expiry)
    call_rec, put_rec = get_raw_chain(t, expiry)
    calls = enrich_records(call_rec, "call", spot, T, r, q)
    puts = enrich_records(put_rec, "put", spot, T, r, q)
    return {
        "ticker": symbol.upper(),
        "expiry": expiry,
        "spot": spot,
        "riskFreeRate": r,
        "dividendYield": q,
        "daysToExpiry": days,
        "T": T,
        "calls": calls,
        "puts": puts,
        "fetchedAt": datetime.utcnow().isoformat() + "Z",
    }


def get_meta(symbol: str) -> dict:
    t = _ticker(symbol)
    spot = get_spot(t)
    if spot is None:
        raise ValueError(f"No spot price for {symbol}")
    return {
        "ticker": symbol.upper(),
        "spot": spot,
        "expiries": get_expiries(t),
        "dividendYield": get_dividend_yield(t),
        "riskFreeRate": settings.risk_free_rate,
    }


def load_history(symbol: str, period: str = "1y"):
    """Public wrapper: (spot, dates[], closes[]) for the IV-HV chart."""
    t = _ticker(symbol)
    spot = get_spot(t)
    dates, closes = get_history_closes(t, period)
    return spot, dates, closes
