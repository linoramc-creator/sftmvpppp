"""Unit tests for the pure parts of the fetcher (no network / no pandas)."""
import math

import pytest

import fetcher


def test_enrich_attaches_greeks_atm_call():
    recs = [{"contractSymbol": "X", "strike": 100.0, "bid": 3.0, "ask": 3.4,
             "lastPrice": 3.2, "volume": 5, "openInterest": 50,
             "impliedVolatility": 0.20, "inTheMoney": False}]
    out = fetcher.enrich_records(recs, "call", S=100.0, T=1.0, r=0.05, q=0.0)
    assert len(out) == 1
    c = out[0]
    assert 0.5 < c["delta"] < 0.7          # ATM call delta ≈ 0.6368
    assert c["gamma"] > 0
    assert c["vega"] > 0
    assert c["mid"] == pytest.approx(3.2)  # (3.0 + 3.4)/2
    assert c["impliedVolatility"] == pytest.approx(0.20)
    assert c["intrinsic"] == pytest.approx(0.0)   # ATM call has no intrinsic
    assert c["type"] == "call"


def test_enrich_intrinsic_itm_put():
    recs = [{"strike": 110.0, "bid": 11.0, "ask": 11.4, "impliedVolatility": 0.25,
             "openInterest": 10}]
    out = fetcher.enrich_records(recs, "put", S=100.0, T=0.5, r=0.05, q=0.0)
    assert out[0]["intrinsic"] == pytest.approx(10.0)  # max(110-100, 0)
    assert out[0]["delta"] < 0                          # put delta negative


def test_enrich_hygiene_nulls_bad_iv_but_keeps_oi():
    recs = [{"strike": 100.0, "impliedVolatility": 0.0, "openInterest": 999}]
    out = fetcher.enrich_records(recs, "call", S=100.0, T=1.0, r=0.05, q=0.0)
    assert out[0]["impliedVolatility"] is None
    assert out[0]["delta"] is None      # no IV → no Greeks
    assert out[0]["openInterest"] == 999  # OI retained for flow aggregations


def test_enrich_hygiene_rejects_absurd_iv():
    recs = [{"strike": 100.0, "impliedVolatility": 9.9, "openInterest": 1}]
    out = fetcher.enrich_records(recs, "call", S=100.0, T=1.0, r=0.05, q=0.0,
                                 min_iv=0.01, max_iv=5.0)
    assert out[0]["impliedVolatility"] is None
    assert out[0]["gamma"] is None


def test_enrich_mid_falls_back_to_last_price():
    recs = [{"strike": 100.0, "bid": 0.0, "ask": 0.0, "lastPrice": 2.5,
             "impliedVolatility": 0.3}]
    out = fetcher.enrich_records(recs, "call", S=100.0, T=1.0, r=0.05, q=0.0)
    assert out[0]["mid"] == pytest.approx(2.5)


def test_enrich_empty():
    assert fetcher.enrich_records([], "call", 100.0, 1.0, 0.05, 0.0) == []


def test_year_fraction_floor_for_zero_dte():
    from datetime import date
    days, T = fetcher.year_fraction("2026-06-08", today=date(2026, 6, 8))
    assert days == 0
    assert T > 0 and T == pytest.approx(0.5 / 365.0)


def test_year_fraction_future():
    from datetime import date
    days, T = fetcher.year_fraction("2026-07-08", today=date(2026, 6, 8))
    assert days == 30
    assert T == pytest.approx(30 / 365.0)
