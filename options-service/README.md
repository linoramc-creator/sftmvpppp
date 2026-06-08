# Options Analytics Service

Isolated, additive Python microservice that powers the **Opciones** section of the
terminal. Backed by [yfinance](https://github.com/ranaroussi/yfinance); every Greek
and flow aggregation is **computed in code** (`bsm.py` + `aggregations.py`) — never
by an LLM.

It does **not** touch the existing Supabase Edge Function or any current feature.
The React app calls it directly via `VITE_OPTIONS_API_URL`.

---

## What it computes

| Area | Output |
|------|--------|
| **Greeks (BSM)** | delta, gamma, theta (per day), vega (per 1 vol pt), rho, **vanna**, **charm** |
| **Flow** | GEX / DEX / VEX per strike + totals, gamma-flip level |
| **Positioning** | max pain, OI walls (support/resistance), put/call ratio (OI & volume) |
| **Volatility** | IV surface (OTM-side), skew (smile), ATM term structure, IV30 vs HV, variance risk premium |
| **Expected move** | ±1σ from ATM IV·√T, and from the ATM straddle mid |

Greeks units (see `bsm.py` docstring): the trader-facing `greeks()` dict returns
theta & charm **per calendar day** and vega/rho/vanna **per 1 point**; delta & gamma
are raw. The raw primitive functions expose the pure partial derivatives.

---

## Endpoints

Base path: `/api/options`

| Method | Path | Query | Returns |
|--------|------|-------|---------|
| GET | `/expiries` | `ticker` | spot, dividend yield, list of expiries |
| GET | `/chain` | `ticker`, `expiry` | full enriched chain (calls + puts with Greeks) |
| GET | `/aggregations` | `ticker`, `expiry` | GEX/DEX/VEX per strike, max pain, walls, PCR, expected move |
| GET | `/skew` | `ticker`, `expiry` | IV vs strike (call/put + OTM smile) |
| GET | `/surface` | `ticker`, `max_expiries`, `moneyness_min/max` | IV surface points (flattened grid) |
| GET | `/term-structure` | `ticker`, `max_expiries` | ATM IV per expiry |
| GET | `/ivhv` | `ticker`, `window` | IV30 vs rolling HV time series + variance premium |
| GET | `/health` | — | liveness + config echo |

---

## Run locally

```bash
cd options-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
# → http://localhost:8001/health
# → http://localhost:8001/api/options/expiries?ticker=AAPL
```

Frontend dev: add to `Terminal_Export/.env.local`

```
VITE_OPTIONS_API_URL=http://localhost:8001
```

---

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `RISK_FREE_RATE` | `0.0525` | Annual risk-free rate for BSM |
| `PORT` | `8001` | HTTP port |
| `OPTIONS_CORS_ORIGINS` | `*` | Comma-separated allowed origins (set to your Vercel URL in prod) |
| `SUPABASE_URL` | — | Enables the Supabase cache tier when set |
| `SUPABASE_SERVICE_KEY` | — | Service-role key for the cache table |
| `OPTIONS_TTL_PRICE` | `14400` (4h) | Chain freshness TTL (seconds) |
| `OPTIONS_TTL_OI` | `86400` (24h) | Reserved for a future OI-only longer TTL |
| `MIN_IV` / `MAX_IV` | `0.01` / `5.0` | Hygiene band; IV outside ⇒ Greeks nulled (OI kept) |

The service boots and works with **zero** env config — the cache simply becomes
in-memory only and a recent T-bill rate is assumed.

---

## Supabase cache table (optional)

Run once in the Supabase SQL editor:

```sql
create table if not exists options_cache (
    ticker      text        not null,
    expiry      text        not null,
    fetched_at  timestamptz not null default now(),
    payload     jsonb       not null,
    primary key (ticker, expiry)
);
```

Caching is two-tier: an in-process dict (always on) plus this table (shared,
restart-safe). Freshness is enforced in Python against `OPTIONS_TTL_PRICE`.

---

## Deployment

Stateless container; deploy on Railway / Render / Fly.io (free tiers are enough).

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
```

Then set `VITE_OPTIONS_API_URL` to the deployed URL in the Vercel project env.

---

## Tests

```bash
python -m pytest -q
```

- `tests/test_bsm.py` — BSM Greeks vs Hull's textbook values, put/call parity,
  vectorization, numerical-derivative cross-checks (vanna), invalid-input handling.
- `tests/test_aggregations.py` — GEX/DEX/VEX sign conventions, gamma-flip
  interpolation, max-pain convergence, PCR, OI walls, expected move, realized vol.
- `tests/test_fetcher.py` — pure Greeks-enrichment + IV hygiene + year-fraction.

---

## TODO — IV Rank / IV Percentile

yfinance does **not** expose historical implied volatility, so IV Rank and IV
Percentile (current IV vs its own trailing-year range) cannot be computed from a
single live snapshot. They are returned as `null` today.

To enable them: persist a daily ATM-IV snapshot per ticker to Supabase (a small
cron hitting `/aggregations` and storing `atmIV` with a date), then compute
`ivRank = (iv - min) / (max - min)` and the percentile over the trailing ~252
snapshots. Wiring point: `router_options.ivhv()` (`ivRank` / `ivPercentile`).
