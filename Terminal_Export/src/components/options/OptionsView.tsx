import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, Search } from "lucide-react";
import { optionsApi, isOptionsConfigured, OptionsApiError } from "@/lib/options-api";
import type {
  AggregationsResponse, ChainResponse, ExpiriesResponse,
  IVHVResponse, SkewResponse, SurfaceResponse, TermStructureResponse,
} from "@/types/options";
import { OptionsErrorBoundary } from "./OptionsErrorBoundary";
import { ChainTable } from "./ChainTable";
import { GexDexChart } from "./GexDexChart";
import { IvSkewChart } from "./IvSkewChart";
import { TermStructureChart } from "./TermStructureChart";
import { IvHvChart } from "./IvHvChart";
import { IvSurfaceChart } from "./IvSurfaceChart";
import { FlowCharts } from "./FlowCharts";
import { fmtPrice } from "./theme";

type TabKey = "chain" | "gex" | "flow" | "skew" | "surface" | "term" | "ivhv";

const TABS: { key: TabKey; label: string; needsExpiry: boolean }[] = [
  { key: "chain", label: "CADENA", needsExpiry: true },
  { key: "gex", label: "GEX/DEX/VEX", needsExpiry: true },
  { key: "flow", label: "FLUJO & POSICIONAMIENTO", needsExpiry: true },
  { key: "skew", label: "SKEW", needsExpiry: true },
  { key: "surface", label: "SUPERFICIE IV", needsExpiry: false },
  { key: "term", label: "ESTRUCTURA TEMPORAL", needsExpiry: false },
  { key: "ivhv", label: "IV / HV", needsExpiry: false },
];

function pickDefaultExpiry(expiries: string[]): string {
  if (!expiries.length) return "";
  const now = Date.now();
  let best = expiries[0];
  let bestDiff = Infinity;
  for (const e of expiries) {
    const days = (new Date(e + "T00:00:00Z").getTime() - now) / 86_400_000;
    if (days < 0) continue;
    const diff = Math.abs(days - 30);
    if (diff < bestDiff) { bestDiff = diff; best = e; }
  }
  return best;
}

function fmtExpiryLabel(e: string): string {
  const d = new Date(e + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return e;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  return `${e}  (${days}d)`;
}

export function OptionsView() {
  const [ticker, setTicker] = useState("");
  const [meta, setMeta] = useState<ExpiriesResponse | null>(null);
  const [expiry, setExpiry] = useState("");
  const [tab, setTab] = useState<TabKey>("chain");

  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cache = useRef<Map<string, unknown>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const configured = isOptionsConfigured();

  // ── Load expiries (and reset) on ticker submit ───────────────────────
  const loadTicker = useCallback(async () => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    setMetaLoading(true);
    setMetaError(null);
    setMeta(null);
    setData(null);
    setError(null);
    cache.current.clear();
    try {
      const m = await optionsApi.expiries(sym);
      setMeta(m);
      setExpiry(pickDefaultExpiry(m.expiries));
    } catch (e) {
      setMetaError(e instanceof OptionsApiError ? e.message : (e as Error).message);
    } finally {
      setMetaLoading(false);
    }
  }, [ticker]);

  // ── Load the active tab's data ───────────────────────────────────────
  useEffect(() => {
    if (!meta) return;
    const def = TABS.find((t) => t.key === tab)!;
    if (def.needsExpiry && !expiry) return;

    const sym = meta.ticker;
    const cacheKey =
      tab === "gex" || tab === "flow"
        ? `agg:${expiry}`
        : `${tab}:${def.needsExpiry ? expiry : "-"}`;

    if (cache.current.has(cacheKey)) {
      setData(cache.current.get(cacheKey));
      setError(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let d: unknown;
        switch (tab) {
          case "chain": d = await optionsApi.chain(sym, expiry, ac.signal); break;
          case "gex":
          case "flow": d = await optionsApi.aggregations(sym, expiry, ac.signal); break;
          case "skew": d = await optionsApi.skew(sym, expiry, ac.signal); break;
          case "surface": d = await optionsApi.surface(sym, ac.signal); break;
          case "term": d = await optionsApi.termStructure(sym, ac.signal); break;
          case "ivhv": d = await optionsApi.ivhv(sym, 30, ac.signal); break;
        }
        cache.current.set(cacheKey, d);
        setData(d);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof OptionsApiError ? e.message : (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [meta, tab, expiry]);

  const refresh = () => {
    cache.current.clear();
    void reloadActive();
  };

  const reloadActive = useCallback(async () => {
    if (!meta) return;
    const def = TABS.find((t) => t.key === tab)!;
    if (def.needsExpiry && !expiry) return;
    const sym = meta.ticker;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      let d: unknown;
      switch (tab) {
        case "chain": d = await optionsApi.chain(sym, expiry, ac.signal); break;
        case "gex":
        case "flow": d = await optionsApi.aggregations(sym, expiry, ac.signal); break;
        case "skew": d = await optionsApi.skew(sym, expiry, ac.signal); break;
        case "surface": d = await optionsApi.surface(sym, ac.signal); break;
        case "term": d = await optionsApi.termStructure(sym, ac.signal); break;
        case "ivhv": d = await optionsApi.ivhv(sym, 30, ac.signal); break;
      }
      const cacheKey =
        tab === "gex" || tab === "flow" ? `agg:${expiry}` : `${tab}:${def.needsExpiry ? expiry : "-"}`;
      cache.current.set(cacheKey, d);
      setData(d);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof OptionsApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [meta, tab, expiry]);

  // ── Config-missing banner ────────────────────────────────────────────
  if (!configured) {
    return (
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-16">
        <div className="border border-amber-500/30 bg-amber-500/5 px-5 py-4">
          <div className="flex items-center gap-2 text-amber-400 text-[11px] tracking-widest uppercase mb-2">
            <AlertCircle className="h-4 w-4" /> Backend de Supabase no configurado
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Define <code className="bg-primary/10 text-primary px-1">VITE_SUPABASE_URL</code> en el entorno de Vercel.
            Las opciones usan la Edge Function <code className="bg-primary/10 text-primary px-1">options-data</code>,
            la misma infraestructura que el resto de la app — no requiere ningún servicio aparte.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pt-5 pb-16">
      {/* Search row */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground/30" />
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && loadTicker()}
            placeholder="TICKER DE OPCIONES — AAPL, SPY, NVDA, TSLA..."
            maxLength={12}
            className="w-full h-8 pl-8 pr-3 bg-card border border-border text-foreground text-xs placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary transition-colors font-mono"
          />
        </div>
        <button
          onClick={loadTicker}
          disabled={metaLoading || !ticker.trim()}
          className="h-8 px-5 bg-primary text-black font-bold text-[11px] tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-opacity"
        >
          {metaLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "CARGAR"}
        </button>
      </div>

      {metaError && (
        <div className="flex items-center gap-2 border border-destructive/30 bg-destructive/5 px-4 py-3 mb-4 text-[12px] text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {metaError}
        </div>
      )}

      {!meta && !metaError && !metaLoading && (
        <div className="text-center py-20">
          <div className="text-3xl font-bold tracking-[0.3em] text-primary/80 mb-2">OPCIONES</div>
          <p className="text-[12px] text-muted-foreground/60">
            Greeks (BSM), GEX/DEX/VEX, superficie IV, skew, estructura temporal, max pain y mov. esperado.
          </p>
          <p className="text-[10px] text-muted-foreground/30 mt-1">Datos de yfinance · Greeks calculados en código, nunca por IA.</p>
        </div>
      )}

      {meta && (
        <>
          {/* Header strip: ticker + spot + expiry selector */}
          <div className="flex items-center gap-4 flex-wrap border border-border bg-card px-4 py-3 mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-foreground tracking-wide">{meta.ticker}</span>
              <span className="text-sm font-mono text-primary">${fmtPrice(meta.spot)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground/60 tracking-widest">
              VENCIMIENTO
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="h-7 px-2 bg-background border border-border text-foreground text-[11px] font-mono focus:outline-none focus:border-primary"
              >
                {meta.expiries.map((e) => (
                  <option key={e} value={e}>{fmtExpiryLabel(e)}</option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground/40 font-mono">
              <span>r {(meta.riskFreeRate * 100).toFixed(2)}%</span>
              <span>q {(meta.dividendYield * 100).toFixed(2)}%</span>
              <button onClick={refresh} className="flex items-center gap-1 hover:text-foreground transition-colors" title="Refrescar">
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Tab strip */}
          <div className="flex border-b border-border bg-card overflow-x-auto mb-4">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-[10px] tracking-wider transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                  tab === t.key ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <OptionsErrorBoundary>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[11px] tracking-widest uppercase">Cargando opciones…</span>
              </div>
            )}
            {!loading && error && (
              <div className="flex items-center gap-2 border border-destructive/30 bg-destructive/5 px-4 py-3 text-[12px] text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            {!loading && !error && data != null && (
              <TabContent tab={tab} data={data} />
            )}
          </OptionsErrorBoundary>
        </>
      )}
    </div>
  );
}

function TabContent({ tab, data }: { tab: TabKey; data: unknown }) {
  switch (tab) {
    case "chain": return <ChainTable data={data as ChainResponse} />;
    case "gex": return <GexDexChart data={data as AggregationsResponse} />;
    case "flow": return <FlowCharts data={data as AggregationsResponse} />;
    case "skew": return <IvSkewChart data={data as SkewResponse} />;
    case "surface": return <IvSurfaceChart data={data as SurfaceResponse} />;
    case "term": return <TermStructureChart data={data as TermStructureResponse} />;
    case "ivhv": return <IvHvChart data={data as IVHVResponse} />;
    default: return null;
  }
}
