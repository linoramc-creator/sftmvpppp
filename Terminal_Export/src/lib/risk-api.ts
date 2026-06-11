// Client for the risk analytics endpoint of the unified analyze-ticker
// edge function (body: { risk: true, ticker }).

import type { RiskResponse } from "@/types/risk";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const RISK_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analyze-ticker` : "";

export class RiskApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RiskApiError";
    this.status = status;
  }
}

export function isRiskConfigured(): boolean {
  return RISK_URL.length > 0;
}

export async function fetchRiskData(ticker: string, signal?: AbortSignal): Promise<RiskResponse> {
  if (!RISK_URL) {
    throw new RiskApiError("Backend de Supabase no configurado. Define VITE_SUPABASE_URL.");
  }
  let resp: Response;
  try {
    resp = await fetch(RISK_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(ANON_KEY ? { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } : {}),
      },
      body: JSON.stringify({ risk: true, ticker }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new RiskApiError(`Sin conexión con el servicio de riesgo: ${(e as Error).message}`);
  }
  if (!resp.ok) {
    let detail = `Error ${resp.status}`;
    try {
      const j = await resp.json();
      detail = j.detail || j.error || detail;
    } catch {
      /* keep default */
    }
    throw new RiskApiError(detail, resp.status);
  }
  return resp.json() as Promise<RiskResponse>;
}
