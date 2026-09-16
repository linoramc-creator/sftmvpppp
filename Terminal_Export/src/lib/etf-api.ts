import { authenticatedFetch } from "@/lib/beta-api";
// Client for the ETF deep-analysis endpoint of the unified analyze-ticker
// edge function (body: { etf: true, ticker }).

import type { EtfResponse } from "@/types/etf";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ETF_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analyze-ticker` : "";

export function isEtfConfigured(): boolean {
  return ETF_URL.length > 0;
}

// Returns { found: false } for non-ETF tickers; null on network/server error.
export async function fetchEtfData(ticker: string, signal?: AbortSignal): Promise<EtfResponse | null> {
  if (!ETF_URL) return null;
  try {
    const resp = await authenticatedFetch(ETF_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",

      },
      body: JSON.stringify({ etf: true, ticker }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as EtfResponse;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    return null;
  }
}
