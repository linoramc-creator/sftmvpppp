"""Runtime configuration for the options service.

All values are read from environment variables so the service can run locally
(uvicorn) or in a container without code changes. Sensible defaults are baked
in so the service boots even with zero env configuration (cache simply turns
into a no-op and the risk-free rate uses a recent T-bill level).
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _get_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # Annualized risk-free rate used for BSM. Default ≈ 3-month T-bill.
    risk_free_rate: float = _get_float("RISK_FREE_RATE", 0.0525)

    # Supabase cache (optional). When either is empty, caching is disabled and
    # every request hits yfinance live.
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_key: str = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_KEY", ""))

    # Cache TTLs (seconds). Prices/IV refresh intraday; OI is an EOD figure.
    ttl_price_seconds: int = _get_int("OPTIONS_TTL_PRICE", 4 * 60 * 60)   # 4h
    ttl_oi_seconds: int = _get_int("OPTIONS_TTL_OI", 24 * 60 * 60)        # 24h

    # Standard equity option contract multiplier (shares per contract).
    contract_multiplier: int = _get_int("CONTRACT_MULTIPLIER", 100)

    # Hygiene: drop contracts whose IV is outside this sane band (fraction, not %).
    min_iv: float = _get_float("MIN_IV", 0.01)    # 1%
    max_iv: float = _get_float("MAX_IV", 5.0)     # 500%

    port: int = _get_int("PORT", 8001)

    # Comma-separated list of allowed CORS origins. "*" allows all (dev default).
    cors_origins: str = os.getenv("OPTIONS_CORS_ORIGINS", "*")

    @property
    def cache_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
