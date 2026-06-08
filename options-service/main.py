"""Options analytics microservice (FastAPI + yfinance).

Isolated, additive backend for the Options section of the terminal. Run locally:

    cd options-service
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8001

All Greeks and flow aggregations are computed in code (bsm.py + aggregations.py),
never by an LLM. See README.md for endpoints, env vars and deployment.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from router_options import router

app = FastAPI(
    title="Options Analytics Service",
    version="1.0.0",
    description="yfinance-backed options chain, Greeks (BSM), GEX/DEX/VEX, IV surface, skew, term structure, IV/HV.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "cacheEnabled": settings.cache_enabled,
        "riskFreeRate": settings.risk_free_rate,
    }


@app.exception_handler(Exception)
async def _unhandled(_request: Request, exc: Exception):
    # Never leak a stack trace to the browser; keep the shape predictable.
    return JSONResponse(status_code=500, content={"error": "internal_error", "detail": str(exc)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=False)
