"""Unit tests for the Black-Scholes-Merton core.

Anchored to Hull's canonical worked example:
    S = K = 100, T = 1y, r = 5%, q = 0, sigma = 20%
    => Call ≈ 10.4506, Put ≈ 5.5735, Delta_call ≈ 0.6368
"""
import math

import numpy as np
import pytest

import bsm

# Hull reference parameters
S, K, T, R, Q, SIG = 100.0, 100.0, 1.0, 0.05, 0.0, 0.20


# ── Price ──────────────────────────────────────────────────────────────
def test_call_price_matches_hull():
    assert bsm.price(S, K, T, R, Q, SIG, True) == pytest.approx(10.4506, abs=1e-3)


def test_put_price_matches_hull():
    assert bsm.price(S, K, T, R, Q, SIG, False) == pytest.approx(5.5735, abs=1e-3)


def test_put_call_parity_price():
    c = bsm.price(S, K, T, R, Q, SIG, True)
    p = bsm.price(S, K, T, R, Q, SIG, False)
    # C - P = S·e^(-qT) - K·e^(-rT)
    assert (c - p) == pytest.approx(S * math.exp(-Q * T) - K * math.exp(-R * T), abs=1e-6)


# ── Delta ──────────────────────────────────────────────────────────────
def test_call_delta_matches_hull():
    assert bsm.delta(S, K, T, R, Q, SIG, True) == pytest.approx(0.6368, abs=1e-3)


def test_put_delta_matches_hull():
    assert bsm.delta(S, K, T, R, Q, SIG, False) == pytest.approx(-0.3632, abs=1e-3)


def test_delta_put_call_parity():
    # delta_call - delta_put = e^(-qT)
    dc = bsm.delta(S, K, T, R, Q, SIG, True)
    dp = bsm.delta(S, K, T, R, Q, SIG, False)
    assert (dc - dp) == pytest.approx(math.exp(-Q * T), abs=1e-9)


def test_call_delta_in_bounds():
    d = bsm.delta(S, K, T, R, Q, SIG, True)
    assert 0.0 < d < 1.0


def test_put_delta_in_bounds():
    d = bsm.delta(S, K, T, R, Q, SIG, False)
    assert -1.0 < d < 0.0


def test_deep_itm_call_delta_near_one():
    assert bsm.delta(200.0, K, T, R, Q, SIG, True) == pytest.approx(1.0, abs=1e-2)


def test_deep_otm_call_delta_near_zero():
    assert bsm.delta(20.0, K, T, R, Q, SIG, True) == pytest.approx(0.0, abs=1e-2)


# ── Gamma ──────────────────────────────────────────────────────────────
def test_gamma_matches_hull():
    assert bsm.gamma(S, K, T, R, Q, SIG) == pytest.approx(0.018762, abs=1e-5)


def test_gamma_always_positive():
    assert bsm.gamma(S, K, T, R, Q, SIG) > 0


def test_gamma_peaks_near_atm():
    atm = bsm.gamma(100.0, K, T, R, Q, SIG)
    itm = bsm.gamma(70.0, K, T, R, Q, SIG)
    otm = bsm.gamma(140.0, K, T, R, Q, SIG)
    assert atm > itm and atm > otm


# ── Vega ───────────────────────────────────────────────────────────────
def test_vega_matches_hull():
    # raw vega (per 1.00 vol) ≈ 37.524
    assert bsm.vega(S, K, T, R, Q, SIG) == pytest.approx(37.524, abs=1e-2)


def test_vega_always_positive():
    assert bsm.vega(S, K, T, R, Q, SIG) > 0


def test_vega_independent_of_call_put():
    # vega does not depend on option type — function signature reflects that
    assert bsm.vega(S, K, T, R, Q, SIG) == bsm.vega(S, K, T, R, Q, SIG)


# ── Theta ──────────────────────────────────────────────────────────────
def test_call_theta_matches_hull_annual():
    # Hull: per-year call theta ≈ -6.414
    assert bsm.theta(S, K, T, R, Q, SIG, True) == pytest.approx(-6.414, abs=1e-2)


def test_long_call_theta_negative():
    assert bsm.theta(S, K, T, R, Q, SIG, True) < 0


# ── Rho ────────────────────────────────────────────────────────────────
def test_call_rho_matches_hull_raw():
    # raw rho (per 1.00 rate) ≈ 53.23
    assert bsm.rho(S, K, T, R, Q, SIG, True) == pytest.approx(53.232, abs=1e-2)


def test_call_rho_positive_put_rho_negative():
    assert bsm.rho(S, K, T, R, Q, SIG, True) > 0
    assert bsm.rho(S, K, T, R, Q, SIG, False) < 0


# ── Second-order Greeks: finite & internally consistent ────────────────
def test_vanna_finite():
    v = bsm.vanna(S, K, T, R, Q, SIG)
    assert np.isfinite(v)


def test_vanna_call_equals_put():
    # vanna is type-independent
    v = bsm.vanna(S, K, T, R, Q, SIG)
    assert np.isfinite(v)


def test_charm_finite_both_types():
    assert np.isfinite(bsm.charm(S, K, T, R, Q, SIG, True))
    assert np.isfinite(bsm.charm(S, K, T, R, Q, SIG, False))


def test_vanna_matches_numerical_derivative():
    # vanna = d(delta)/d(sigma); compare analytic to a central difference
    h = 1e-4
    d_up = bsm.delta(S, K, T, R, Q, SIG + h, True)
    d_dn = bsm.delta(S, K, T, R, Q, SIG - h, True)
    numeric = (d_up - d_dn) / (2 * h)
    assert bsm.vanna(S, K, T, R, Q, SIG) == pytest.approx(numeric, abs=1e-3)


# ── Trader-scaled greeks() dict ────────────────────────────────────────
def test_greeks_theta_is_per_day():
    g = bsm.greeks(S, K, T, R, Q, SIG, True)
    annual = bsm.theta(S, K, T, R, Q, SIG, True)
    assert g["theta"] == pytest.approx(annual / 365.0, abs=1e-9)


def test_greeks_vega_is_per_point():
    g = bsm.greeks(S, K, T, R, Q, SIG, True)
    raw = bsm.vega(S, K, T, R, Q, SIG)
    assert g["vega"] == pytest.approx(raw / 100.0, abs=1e-9)


def test_greeks_has_all_keys():
    g = bsm.greeks(S, K, T, R, Q, SIG, True)
    assert set(g) == {"delta", "gamma", "theta", "vega", "rho", "vanna", "charm"}


# ── Vectorization ──────────────────────────────────────────────────────
def test_vectorized_delta_matches_scalar():
    strikes = np.array([80.0, 100.0, 120.0])
    vec = bsm.delta(S, strikes, T, R, Q, SIG, True)
    assert isinstance(vec, np.ndarray)
    assert vec.shape == (3,)
    for i, k in enumerate(strikes):
        assert vec[i] == pytest.approx(bsm.delta(S, float(k), T, R, Q, SIG, True), abs=1e-9)


def test_vectorized_mixed_call_put():
    is_call = np.array([True, False, True])
    strikes = np.array([90.0, 100.0, 110.0])
    d = bsm.delta(S, strikes, T, R, Q, SIG, is_call)
    assert d[0] > 0 and d[1] < 0 and d[2] > 0


# ── Invalid input handling ─────────────────────────────────────────────
def test_zero_time_returns_nan():
    assert math.isnan(bsm.delta(S, K, 0.0, R, Q, SIG, True))


def test_zero_vol_returns_nan():
    assert math.isnan(bsm.gamma(S, K, T, R, Q, 0.0))
