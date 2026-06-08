"""Unit tests for options-flow aggregations.

All expected values are computed by hand from the documented formulas so the
sign conventions stay pinned.
"""
import math

import pytest

import aggregations as agg


# ── exposures_per_strike ───────────────────────────────────────────────
def test_exposures_single_strike_hand_computed():
    spot = 100.0
    calls = [{"strike": 100.0, "gamma": 0.02, "delta": 0.5, "vega": 0.1,
              "openInterest": 10, "volume": 5}]
    puts = [{"strike": 100.0, "gamma": 0.02, "delta": -0.5, "vega": 0.1,
             "openInterest": 20, "volume": 7}]
    per_strike, totals = agg.exposures_per_strike(calls, puts, spot, mult=100)

    assert len(per_strike) == 1
    row = per_strike[0]
    # s2 = 100*100*0.01 = 100
    assert row["callGex"] == pytest.approx(0.02 * 10 * 100 * 100)      # 2000
    assert row["putGex"] == pytest.approx(-0.02 * 20 * 100 * 100)      # -4000
    assert row["gex"] == pytest.approx(-2000.0)
    assert row["dex"] == pytest.approx(0.5 * 10 * 100 * 100 + (-0.5) * 20 * 100 * 100)  # -50000
    assert row["vex"] == pytest.approx(0.1 * 10 * 100 - 0.1 * 20 * 100)  # -100
    assert row["callOI"] == 10 and row["putOI"] == 20

    assert totals["totalGex"] == pytest.approx(-2000.0)
    assert totals["totalDex"] == pytest.approx(-50000.0)
    assert totals["totalVex"] == pytest.approx(-100.0)


def test_calls_positive_puts_negative_gex():
    spot = 100.0
    calls = [{"strike": 100.0, "gamma": 0.03, "delta": 0.5, "vega": 0.1, "openInterest": 5}]
    puts = [{"strike": 100.0, "gamma": 0.03, "delta": -0.5, "vega": 0.1, "openInterest": 5}]
    per_strike, _ = agg.exposures_per_strike(calls, puts, spot)
    assert per_strike[0]["callGex"] > 0
    assert per_strike[0]["putGex"] < 0


def test_exposures_handles_missing_greeks_and_oi():
    spot = 100.0
    calls = [{"strike": 100.0, "gamma": None, "delta": None, "vega": None, "openInterest": None}]
    puts = []
    per_strike, totals = agg.exposures_per_strike(calls, puts, spot)
    assert totals["totalGex"] == 0.0
    assert per_strike[0]["callOI"] == 0


# ── gamma_flip ─────────────────────────────────────────────────────────
def test_gamma_flip_interpolates_zero_crossing():
    per_strike = [
        {"strike": 90.0, "gex": 1000.0},
        {"strike": 100.0, "gex": -3000.0},
        {"strike": 110.0, "gex": 500.0},
    ]
    # cumulative: +1000 (90) → -2000 (100). Crosses 0 at 90 + (1000/3000)*10 ≈ 93.33
    flip = agg.gamma_flip(per_strike)
    assert flip == pytest.approx(93.333, abs=1e-2)


def test_gamma_flip_none_when_no_crossing():
    per_strike = [{"strike": 90.0, "gex": 100.0}, {"strike": 100.0, "gex": 200.0}]
    assert agg.gamma_flip(per_strike) is None


# ── max_pain ───────────────────────────────────────────────────────────
def test_max_pain_symmetric_is_center():
    calls = [{"strike": k, "openInterest": 100} for k in (90, 100, 110)]
    puts = [{"strike": k, "openInterest": 100} for k in (90, 100, 110)]
    assert agg.max_pain(calls, puts) == 100.0


def test_max_pain_pulled_by_heavy_put_oi():
    # Heavy put OI at 110 → writers want price up near 110 so puts expire worthless
    calls = [{"strike": 100.0, "openInterest": 10}]
    puts = [{"strike": 100.0, "openInterest": 10}, {"strike": 110.0, "openInterest": 1000}]
    assert agg.max_pain(calls, puts) == 110.0


def test_max_pain_empty_returns_none():
    assert agg.max_pain([], []) is None


# ── put/call ratio ─────────────────────────────────────────────────────
def test_put_call_ratio_oi_and_vol():
    calls = [{"openInterest": 10, "volume": 4}]
    puts = [{"openInterest": 20, "volume": 12}]
    oi, vol = agg.put_call_ratio(calls, puts)
    assert oi == pytest.approx(2.0)
    assert vol == pytest.approx(3.0)


def test_put_call_ratio_none_when_no_calls():
    oi, vol = agg.put_call_ratio([], [{"openInterest": 5, "volume": 1}])
    assert oi is None and vol is None


# ── OI walls ───────────────────────────────────────────────────────────
def test_oi_walls_top_n_sorted():
    calls = [{"strike": s, "openInterest": oi} for s, oi in [(100, 50), (110, 300), (120, 10)]]
    puts = [{"strike": s, "openInterest": oi} for s, oi in [(90, 400), (80, 20)]]
    cw, pw = agg.oi_walls(calls, puts, n=2)
    assert [w["strike"] for w in cw] == [110.0, 100.0]
    assert cw[0]["openInterest"] == 300
    assert pw[0]["strike"] == 90.0


# ── ATM IV + expected move ─────────────────────────────────────────────
def test_atm_iv_averages_call_put():
    calls = [{"strike": 101.0, "impliedVolatility": 0.30}]
    puts = [{"strike": 99.0, "impliedVolatility": 0.34}]
    assert agg.atm_iv(calls, puts, 100.0) == pytest.approx(0.32, abs=1e-9)


def test_expected_move_formula():
    em = agg.expected_move(spot=100.0, iv=0.20, T=0.25)
    assert em["pct"] == pytest.approx(0.10)   # 0.20 * sqrt(0.25)
    assert em["abs"] == pytest.approx(10.0)


def test_expected_move_none_when_no_iv():
    em = agg.expected_move(spot=100.0, iv=None, T=0.25)
    assert em["pct"] is None and em["abs"] is None


def test_atm_straddle_mid():
    calls = [{"strike": 100.0, "mid": 3.2}]
    puts = [{"strike": 100.0, "mid": 2.8}]
    assert agg.atm_straddle_mid(calls, puts, 100.0) == pytest.approx(6.0)


# ── historical volatility ──────────────────────────────────────────────
def test_hv_series_length_and_leading_nones():
    closes = [100.0 + i for i in range(40)]
    series = agg.historical_volatility_series(closes, window=30)
    assert len(series) == 40
    assert all(v is None for v in series[:30])
    assert series[-1] is not None


def test_hv_zero_for_constant_growth():
    # Constant multiplicative growth → identical log returns → zero realized vol
    closes = [100.0 * (1.01 ** i) for i in range(60)]
    assert agg.latest_hv(closes, window=30) == pytest.approx(0.0, abs=1e-9)


def test_hv_positive_for_noisy_series():
    closes = [100.0, 102.0, 99.0, 103.0, 98.0] * 12  # oscillating
    hv = agg.latest_hv(closes, window=30)
    assert hv is not None and hv > 0


def test_hv_none_when_too_short():
    assert agg.latest_hv([100.0, 101.0], window=30) is None
