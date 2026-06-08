// Typed client for the Python options service (options-service/).
// The base URL comes from VITE_OPTIONS_API_URL; when unset, callers receive a
// clear configuration error instead of a silent failure.

import type {
  AggregationsResponse,
  ChainResponse,
  ExpiriesResponse,
  IVHVResponse,
  SkewResponse,
  SurfaceResponse,
  TermStructureResponse,
} from "@/types/options";

const BASE = (import.meta.env.VITE_OPTIONS_API_URL || "").replace(/\/$/, "");

export class OptionsApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OptionsApiError";
    this.status = status;
  }
}

export function isOptionsConfigured(): boolean {
  return BASE.length > 0;
}

async function get<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  if (!BASE) {
    throw new OptionsApiError(
      "Servicio de opciones no configurado. Define VITE_OPTIONS_API_URL para apuntar al microservicio Python.",
    );
  }
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${BASE}/api/options/${path}?${qs}`;

  let resp: Response;
  try {
    resp = await fetch(url, { signal, headers: { Accept: "application/json" } });
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
    get<ExpiriesResponse>("expiries", { ticker }, signal),

  chain: (ticker: string, expiry: string, signal?: AbortSignal) =>
    get<ChainResponse>("chain", { ticker, expiry }, signal),

  aggregations: (ticker: string, expiry: string, signal?: AbortSignal) =>
    get<AggregationsResponse>("aggregations", { ticker, expiry }, signal),

  skew: (ticker: string, expiry: string, signal?: AbortSignal) =>
    get<SkewResponse>("skew", { ticker, expiry }, signal),

  surface: (ticker: string, signal?: AbortSignal) =>
    get<SurfaceResponse>("surface", { ticker }, signal),

  termStructure: (ticker: string, signal?: AbortSignal) =>
    get<TermStructureResponse>("term-structure", { ticker }, signal),

  ivhv: (ticker: string, window = 30, signal?: AbortSignal) =>
    get<IVHVResponse>("ivhv", { ticker, window }, signal),
};
