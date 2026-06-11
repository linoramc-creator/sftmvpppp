import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { isOptionsConfigured, optionsApi, OptionsApiError } from "@/lib/options-api";
import type { ChainResponse, ExpiriesResponse, SurfaceResponse } from "@/types/options";
import { StrikeBarsChart } from "./StrikeBarsChart";
import { VolatilitySmileChart } from "./VolatilitySmileChart";

// Options sub-section embedded in the Ticker report. Shows exactly three
// blocks (volume by strike, OI by strike, volatility smile) for the ticker
// already analysed — no separate ticker input. All numbers come from the
// deterministic backend (Yahoo chain + BSM); nothing here is AI-generated.
export function OptionsSubSection({ ticker }: { ticker: string }) {
  const [meta, setMeta]               = useState<ExpiriesResponse | null>(null);
  const [expiry, setExpiry]           = useState("");
  const [chain, setChain]             = useState<ChainResponse | null>(null);
  const [surface, setSurface]         = useState<SurfaceResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError]             = useState("");

  // Initial load per ticker: expiries → first usable chain + IV surface.
  useEffect(() => {
    if (!ticker || !isOptionsConfigured()) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setMeta(null);
    setChain(null);
    setSurface(null);
    setExpiry("");

    (async () => {
      try {
        const m = await optionsApi.expiries(ticker, controller.signal);
        if (controller.signal.aborted) return;
        setMeta(m);
        const expiries = m.expiries ?? [];
        if (expiries.length === 0) {
          setError("Este ticker no tiene opciones cotizadas (o Yahoo no publica su cadena).");
          setLoading(false);
          return;
        }

        const [chainResult, surfaceResult] = await Promise.allSettled([
          (async () => {
            // The very nearest expiry can be a near-empty 0DTE chain; fall
            // through to the next one when it has almost no strikes.
            let c = await optionsApi.chain(ticker, expiries[0], controller.signal);
            if ((c.calls ?? []).length + (c.puts ?? []).length < 5 && expiries.length > 1) {
              c = await optionsApi.chain(ticker, expiries[1], controller.signal);
            }
            return c;
          })(),
          optionsApi.surface(ticker, controller.signal),
        ]);
        if (controller.signal.aborted) return;

        if (chainResult.status === "fulfilled") {
          setChain(chainResult.value);
          setExpiry(chainResult.value.expiry);
        }
        if (surfaceResult.status === "fulfilled") setSurface(surfaceResult.value);

        if (chainResult.status === "rejected" && surfaceResult.status === "rejected") {
          const reason = chainResult.reason;
          setError(reason instanceof OptionsApiError ? reason.message : "No se pudieron cargar los datos de opciones.");
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof OptionsApiError ? e.message : "No se pudieron cargar los datos de opciones.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [ticker]);

  // Expiry switch (volume / OI charts only — the smile spans all expiries).
  const handleExpiryChange = (next: string) => {
    setExpiry(next);
    if (!ticker || !next) return;
    const controller = new AbortController();
    setChainLoading(true);
    optionsApi.chain(ticker, next, controller.signal)
      .then((c) => { if (!controller.signal.aborted) setChain(c); })
      .catch((e) => {
        if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof OptionsApiError ? e.message : "No se pudo cargar la cadena para ese vencimiento.");
      })
      .finally(() => { if (!controller.signal.aborted) setChainLoading(false); });
  };

  if (!isOptionsConfigured()) {
    return (
      <div className="py-8 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
        Backend de Supabase no configurado — define VITE_SUPABASE_URL para habilitar las opciones.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted-foreground text-[11px] tracking-widest">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        CARGANDO DATOS DE OPCIONES...
      </div>
    );
  }

  if (error && !chain && !surface) {
    return (
      <div className="p-3 border border-destructive/40 bg-destructive/5 flex items-start gap-2">
        <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
        <p className="text-xs text-destructive font-mono">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Expiry selector for the per-strike charts */}
      {meta && (meta.expiries ?? []).length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[9px] tracking-widest text-muted-foreground/45 uppercase">Vencimiento</span>
          <select
            value={expiry}
            onChange={(e) => handleExpiryChange(e.target.value)}
            className="h-7 px-2 bg-card border border-border text-[11px] text-foreground font-mono focus:outline-none focus:border-primary"
          >
            {(meta.expiries ?? []).map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          {chain && (
            <span className="text-[9px] text-muted-foreground/40 font-mono">
              spot ${chain.spot.toFixed(2)} · {chain.daysToExpiry}d
            </span>
          )}
          {chainLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40" />}
        </div>
      )}

      {/* 1 — Volume by strike */}
      <div>
        <div className="text-[10px] tracking-widest text-foreground font-semibold mb-1">VOLUMEN POR STRIKE</div>
        <div className="text-[9px] text-muted-foreground/40 mb-1.5">
          Contratos negociados hoy por strike · calls en verde, puts en rojo
        </div>
        {chain
          ? <StrikeBarsChart data={chain} metric="volume" />
          : <ChartUnavailable text="Sin cadena de opciones disponible para este vencimiento." />}
      </div>

      {/* 2 — Open interest by strike */}
      <div>
        <div className="text-[10px] tracking-widest text-foreground font-semibold mb-1">INTERÉS ABIERTO POR STRIKE</div>
        <div className="text-[9px] text-muted-foreground/40 mb-1.5">
          Contratos vivos por strike · concentraciones altas actúan como imanes de precio
        </div>
        {chain
          ? <StrikeBarsChart data={chain} metric="openInterest" />
          : <ChartUnavailable text="Sin cadena de opciones disponible para este vencimiento." />}
      </div>

      {/* 3 — Volatility smile */}
      <div>
        <div className="text-[10px] tracking-widest text-foreground font-semibold mb-1">SMILE DE VOLATILIDAD</div>
        <div className="text-[9px] text-muted-foreground/40 mb-1.5">
          IV implícita (OTM) frente a strike · una línea por vencimiento
        </div>
        {surface
          ? <VolatilitySmileChart data={surface} />
          : <ChartUnavailable text="Sin datos de superficie IV para este ticker." />}
      </div>
    </div>
  );
}

function ChartUnavailable({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
      {text}
    </div>
  );
}
