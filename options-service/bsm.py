"""Black-Scholes-Merton option pricing and Greeks.

Every value here is computed analytically in code — NEVER by an LLM. The module
works on scalars or numpy arrays interchangeably, so a whole option chain can be
priced in a single vectorized call.

Conventions
-----------
Inputs:
    S      spot price of the underlying
    K      strike price
    T      time to expiry in YEARS (calendar days / 365)
    r      continuously-compounded risk-free rate (fraction, e.g. 0.0525)
    q      continuous dividend yield (fraction, e.g. 0.006)
    sigma  implied volatility (fraction, e.g. 0.32 for 32%)
    is_call  bool or bool-array; True = call, False = put

The *raw* primitive functions (`delta`, `gamma`, `vega`, `theta`, `rho`,
`vanna`, `charm`) return the pure mathematical partial derivatives:
    - delta : dimensionless (∂V/∂S)
    - gamma : per $1            (∂²V/∂S²)
    - vega  : per 1.00 vol      (∂V/∂σ, i.e. per 100% change — divide by 100 for 1pt)
    - theta : per YEAR          (∂V/∂t, calendar-time decay — divide by 365 for daily)
    - rho   : per 1.00 rate     (∂V/∂r — divide by 100 for 1pt)
    - vanna : per $1 · per 1.00 vol (∂²V/∂S∂σ)
    - charm : per YEAR          (∂Δ/∂t, delta decay — divide by 365 for daily)

`greeks()` returns a TRADER-SCALED dict (theta & charm per day, vega & rho & vanna
per 1 volatility/rate point) for direct display. Aggregations import the raw
primitives so the exposure math stays unambiguous.
"""
from __future__ import annotations

import math
from typing import Union

import numpy as np

Number = Union[float, np.ndarray]

# ── Normal distribution helpers (numpy-only, no scipy dependency) ──────────
# math.erf is the libm implementation (accurate to ~1e-16); np.vectorize lets
# it run elementwise over arrays. scipy is used when present for speed.
try:  # pragma: no cover - exercised implicitly depending on environment
    from scipy.stats import norm as _scipy_norm

    def _norm_cdf(x: Number) -> Number:
        return _scipy_norm.cdf(x)

    def _norm_pdf(x: Number) -> Number:
        return _scipy_norm.pdf(x)

except ImportError:  # pragma: no cover
    _erf_vec = np.vectorize(math.erf, otypes=[float])
    _SQRT_2 = math.sqrt(2.0)
    _INV_SQRT_2PI = 1.0 / math.sqrt(2.0 * math.pi)

    def _norm_cdf(x: Number) -> Number:
        return 0.5 * (1.0 + _erf_vec(np.asarray(x, dtype=float) / _SQRT_2))

    def _norm_pdf(x: Number) -> Number:
        x = np.asarray(x, dtype=float)
        return _INV_SQRT_2PI * np.exp(-0.5 * x * x)


def _as_float_array(*vals: Number) -> tuple[np.ndarray, ...]:
    return tuple(np.asarray(v, dtype=float) for v in vals)


def d1_d2(S: Number, K: Number, T: Number, r: Number, q: Number, sigma: Number):
    """Return the BSM d1 and d2 terms.

    Where inputs are invalid (T<=0 or sigma<=0) the result is NaN — callers
    filter these out rather than plotting garbage.
    """
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    with np.errstate(divide="ignore", invalid="ignore"):
        vol_sqrt_t = sigma * np.sqrt(T)
        d1 = (np.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vol_sqrt_t
        d2 = d1 - vol_sqrt_t
        invalid = (T <= 0) | (sigma <= 0) | (S <= 0) | (K <= 0)
        d1 = np.where(invalid, np.nan, d1)
        d2 = np.where(invalid, np.nan, d2)
    return d1, d2


def price(S, K, T, r, q, sigma, is_call) -> Number:
    """Theoretical option price."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    is_call = np.asarray(is_call, dtype=bool)
    d1, d2 = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    disc_r = np.exp(-r * T)
    call = S * disc_q * _norm_cdf(d1) - K * disc_r * _norm_cdf(d2)
    put = K * disc_r * _norm_cdf(-d2) - S * disc_q * _norm_cdf(-d1)
    return _scalarize(np.where(is_call, call, put))


def delta(S, K, T, r, q, sigma, is_call) -> Number:
    """∂V/∂S — dimensionless (calls 0..1, puts -1..0)."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    is_call = np.asarray(is_call, dtype=bool)
    d1, _ = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    call_delta = disc_q * _norm_cdf(d1)
    put_delta = disc_q * (_norm_cdf(d1) - 1.0)
    return _scalarize(np.where(is_call, call_delta, put_delta))


def gamma(S, K, T, r, q, sigma) -> Number:
    """∂²V/∂S² — same for calls and puts, always >= 0."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    d1, _ = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    with np.errstate(divide="ignore", invalid="ignore"):
        g = disc_q * _norm_pdf(d1) / (S * sigma * np.sqrt(T))
    return _scalarize(g)


def vega(S, K, T, r, q, sigma) -> Number:
    """∂V/∂σ per 1.00 (100%) vol — same for calls and puts. Divide by 100 for 1pt."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    d1, _ = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    v = S * disc_q * _norm_pdf(d1) * np.sqrt(T)
    return _scalarize(v)


def theta(S, K, T, r, q, sigma, is_call) -> Number:
    """∂V/∂t per YEAR (negative for long options). Divide by 365 for per-day."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    is_call = np.asarray(is_call, dtype=bool)
    d1, d2 = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    disc_r = np.exp(-r * T)
    with np.errstate(divide="ignore", invalid="ignore"):
        common = -(S * disc_q * _norm_pdf(d1) * sigma) / (2.0 * np.sqrt(T))
    call_theta = common - r * K * disc_r * _norm_cdf(d2) + q * S * disc_q * _norm_cdf(d1)
    put_theta = common + r * K * disc_r * _norm_cdf(-d2) - q * S * disc_q * _norm_cdf(-d1)
    return _scalarize(np.where(is_call, call_theta, put_theta))


def rho(S, K, T, r, q, sigma, is_call) -> Number:
    """∂V/∂r per 1.00 (100%) rate. Divide by 100 for a 1pt rate move."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    is_call = np.asarray(is_call, dtype=bool)
    _, d2 = d1_d2(S, K, T, r, q, sigma)
    disc_r = np.exp(-r * T)
    call_rho = K * T * disc_r * _norm_cdf(d2)
    put_rho = -K * T * disc_r * _norm_cdf(-d2)
    return _scalarize(np.where(is_call, call_rho, put_rho))


def vanna(S, K, T, r, q, sigma) -> Number:
    """∂²V/∂S∂σ = ∂Δ/∂σ — same for calls and puts. Per $1 · per 1.00 vol."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    d1, d2 = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    with np.errstate(divide="ignore", invalid="ignore"):
        v = -disc_q * _norm_pdf(d1) * d2 / sigma
    return _scalarize(v)


def charm(S, K, T, r, q, sigma, is_call) -> Number:
    """∂Δ/∂t per YEAR (delta decay). Divide by 365 for per-day delta bleed."""
    S, K, T, r, q, sigma = _as_float_array(S, K, T, r, q, sigma)
    is_call = np.asarray(is_call, dtype=bool)
    d1, d2 = d1_d2(S, K, T, r, q, sigma)
    disc_q = np.exp(-q * T)
    with np.errstate(divide="ignore", invalid="ignore"):
        bracket = (2.0 * (r - q) * T - d2 * sigma * np.sqrt(T)) / (2.0 * T * sigma * np.sqrt(T))
        core = disc_q * _norm_pdf(d1) * bracket
    call_charm = q * disc_q * _norm_cdf(d1) - core
    put_charm = -q * disc_q * _norm_cdf(-d1) - core
    return _scalarize(np.where(is_call, call_charm, put_charm))


def greeks(S, K, T, r, q, sigma, is_call) -> dict:
    """Trader-scaled Greeks for display.

    theta & charm are per CALENDAR DAY; vega, rho & vanna are per 1 VOLATILITY/
    rate POINT (i.e. raw/100). delta and gamma are returned raw.
    """
    return {
        "delta": delta(S, K, T, r, q, sigma, is_call),
        "gamma": gamma(S, K, T, r, q, sigma),
        "theta": _scale(theta(S, K, T, r, q, sigma, is_call), 1.0 / 365.0),
        "vega": _scale(vega(S, K, T, r, q, sigma), 0.01),
        "rho": _scale(rho(S, K, T, r, q, sigma, is_call), 0.01),
        "vanna": _scale(vanna(S, K, T, r, q, sigma), 0.01),
        "charm": _scale(charm(S, K, T, r, q, sigma, is_call), 1.0 / 365.0),
    }


# ── small helpers ─────────────────────────────────────────────────────────
def _scalarize(arr: np.ndarray) -> Number:
    """Return a python float for 0-d input, else the ndarray unchanged."""
    arr = np.asarray(arr, dtype=float)
    if arr.ndim == 0:
        return float(arr)
    return arr


def _scale(val: Number, factor: float) -> Number:
    if isinstance(val, np.ndarray):
        return val * factor
    return float(val) * factor
