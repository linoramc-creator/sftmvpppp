"""Two-tier cache for option chains.

Tier 1: in-process dict (always on) — survives within a single service instance.
Tier 2: Supabase Postgres (optional) — survives restarts and is shared across
        instances. Enabled only when SUPABASE_URL + SUPABASE_SERVICE_KEY are set.

Both tiers store the *enriched chain payload* keyed by (ticker, expiry) with a
`fetched_at` timestamp; freshness is enforced in Python against the configured
TTL. The service degrades gracefully: if Supabase is unreachable the in-memory
tier still serves, and a total miss simply triggers a live yfinance fetch.

Supabase table (run once — see README):

    create table if not exists options_cache (
        ticker      text        not null,
        expiry      text        not null,
        fetched_at  timestamptz not null default now(),
        payload     jsonb       not null,
        primary key (ticker, expiry)
    );
"""
from __future__ import annotations

import time
from typing import Optional

from config import settings


class ChainCache:
    def __init__(self) -> None:
        self._mem: dict[tuple[str, str], tuple[float, dict]] = {}
        self._client = None
        if settings.cache_enabled:
            try:
                from supabase import create_client

                self._client = create_client(settings.supabase_url, settings.supabase_key)
            except Exception as exc:  # noqa: BLE001 - never let cache init crash the service
                print(f"[cache] Supabase init failed, memory-only: {exc}")
                self._client = None

    @staticmethod
    def _key(ticker: str, expiry: str) -> tuple[str, str]:
        return (ticker.upper(), expiry)

    # ── read ────────────────────────────────────────────────────────────
    def get(self, ticker: str, expiry: str, ttl_seconds: int) -> Optional[dict]:
        now = time.time()
        key = self._key(ticker, expiry)

        # Tier 1 — memory
        hit = self._mem.get(key)
        if hit and (now - hit[0]) < ttl_seconds:
            payload = dict(hit[1])
            payload["cached"] = True
            return payload

        # Tier 2 — Supabase
        if self._client is not None:
            try:
                res = (
                    self._client.table("options_cache")
                    .select("payload, fetched_at")
                    .eq("ticker", key[0])
                    .eq("expiry", expiry)
                    .limit(1)
                    .execute()
                )
                rows = res.data or []
                if rows:
                    fetched_at = _parse_ts(rows[0].get("fetched_at"))
                    if fetched_at is not None and (now - fetched_at) < ttl_seconds:
                        payload = rows[0]["payload"]
                        self._mem[key] = (fetched_at, payload)  # warm memory tier
                        payload = dict(payload)
                        payload["cached"] = True
                        return payload
            except Exception as exc:  # noqa: BLE001
                print(f"[cache] Supabase read failed: {exc}")

        return None

    # ── write ───────────────────────────────────────────────────────────
    def set(self, ticker: str, expiry: str, payload: dict) -> None:
        key = self._key(ticker, expiry)
        now = time.time()
        # Don't persist the transient cached flag.
        clean = {k: v for k, v in payload.items() if k != "cached"}
        self._mem[key] = (now, clean)

        if self._client is not None:
            try:
                self._client.table("options_cache").upsert(
                    {
                        "ticker": key[0],
                        "expiry": expiry,
                        "fetched_at": "now()",
                        "payload": clean,
                    }
                ).execute()
            except Exception as exc:  # noqa: BLE001
                print(f"[cache] Supabase write failed: {exc}")


def _parse_ts(raw) -> Optional[float]:
    """Convert an ISO8601 / epoch timestamp to a float epoch; None on failure."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    try:
        from datetime import datetime

        s = str(raw).replace("Z", "+00:00")
        return datetime.fromisoformat(s).timestamp()
    except Exception:  # noqa: BLE001
        return None


# Module-level singleton used by the router.
chain_cache = ChainCache()
