// Typed client for the Options analytics backend.
//
// Backend lives inside the unified `analyze-ticker` Supabase Edge Function
// (dispatched by `optionsAction`) — the SAME function as the rest of the app.
// It pulls option chains from Yahoo and computes every Greek + flow aggregation
// in code (never by an LLM). No separate service or extra URL to configure.

import type {
  AggregationsResponse,
  ChainResponse,
  ExpiriesResponse,
  IVHVResponse,
  SkewResponse,
  SurfaceResponse,
  TermStructureResponse,
} from "@/types/options";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const OPTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analyze-ticker` : "";

export class OptionsApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OptionsApiError";
    this.status = status;
  }
}

// Configured as long as the app's Supabase backend is configured — there is no
// separate options service to point at anymore.
export function isOptionsConfigured(): boolean {
  return OPTIONS_URL.length > 0;
}

async function call<T>(
  action: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  if (!OPTIONS_URL) {
    throw new OptionsApiError(
      "Backend de Supabase no configurado. Define VITE_SUPABASE_URL para habilitar las opciones.",
    );
  }

  let resp: Response;
  try {
    resp = await fetch(OPTIONS_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(ANON_KEY ? { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } : {}),
      },
      body: JSON.stringify({ optionsAction: action, ...params }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new OptionsApiError(`Sin conexión con el servicio de opciones: ${(e as Error).message}`);
  }

  if (!resp.ok) {
    let detail = `Error ${resp.status}`;
    try {
      const j = await resp.json();
      detail = j.detail || j.error || detail;
    } catch {
      /* keep default */
    }
    throw new OptionsApiError(detail, resp.status);
  }
  return resp.json() as Promise<T>;
}

export const optionsApi = {
  expiries: (ticker: string, signal?: AbortSignal) =>
    call<ExpiriesResponse>("expiries", { ticker }, signal),

  chain: (ticker: string, expiry: string, signal?: AbortSignal) =>
    call<ChainResponse>("chain", { ticker, expiry }, signal),

  aggregations: (ticker: string, expiry: string, signal?: AbortSignal) =>
    call<AggregationsResponse>("aggregations", { ticker, expiry }, signal),

  skew: (ticker: string, expiry: string, signal?: AbortSignal) =>
    call<SkewResponse>("skew", { ticker, expiry }, signal),

  surface: (ticker: string, signal?: AbortSignal) =>
    call<SurfaceResponse>("surface", { ticker }, signal),

  termStructure: (ticker: string, signal?: AbortSignal) =>
    call<TermStructureResponse>("term-structure", { ticker }, signal),

  ivhv: (ticker: string, window = 30, signal?: AbortSignal) =>
    call<IVHVResponse>("ivhv", { ticker, window }, signal),
};
