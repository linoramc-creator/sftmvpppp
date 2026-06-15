import { useEffect, useState } from "react";
import { fetchMacroCalendar } from "@/lib/analyze";
import type { MacroCalendarResponse, MacroEvent } from "@/types/macro";

// "Calendario Macro" tab shared by the ticker, ETF and sector views. The
// event list is global (not per instrument), so one module-level cache keeps
// view switches instant and avoids refetching on every tab change.

let macroCache: { ts: number; data: MacroCalendarResponse } | null = null;
const MACRO_TTL_MS = 30 * 60 * 1000;

const IMPACT_CLS: Record<string, string> = {
  High: "text-destructive",
  Medium: "text-amber-400",
  Low: "text-muted-foreground/50",
};

const IMPACT_ES: Record<string, string> = {
  High: "Alta",
  Medium: "Media",
  Low: "Baja",
};

const fmtNum = (v: number | null, unit: string | null) => {
  if (v == null) return "—";
  const n = Math.abs(v) >= 1000
    ? v.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
};

const fmtDate = (d: string) => {
  // backend ships "YYYY-MM-DD HH:mm"
  const [day, time] = d.split(" ");
  const dt = new Date(`${day}T${time && time.length >= 4 ? time : "00:00"}:00Z`);
  if (isNaN(dt.getTime())) return d;
  const ds = dt.toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" }).toUpperCase();
  const ts = time && time !== "00:00" ? ` ${time}` : "";
  return `${ds}${ts}`;
};

function EventsTable({ events, emptyText }: { events: MacroEvent[]; emptyText: string }) {
  if (events.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] text-muted-foreground/50 border border-border bg-card">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="border border-border bg-card overflow-x-auto">
      <table className="w-full font-mono min-w-max" style={{ fontSize: "12px" }}>
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-normal">FECHA</th>
            <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-normal">EVENTO</th>
            <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-normal">PAÍS</th>
            <th className="px-3 py-2 text-center text-[10px] tracking-widest text-muted-foreground/50 font-normal">IMPORTANCIA</th>
            <th className="px-3 py-2 text-right text-[10px] tracking-widest text-muted-foreground/50 font-normal">ESPERADO</th>
            <th className="px-3 py-2 text-right text-[10px] tracking-widest text-muted-foreground/50 font-normal">PREVIO</th>
            <th className="px-3 py-2 text-right text-[10px] tracking-widest text-muted-foreground/50 font-normal">ACTUAL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {events.map((e, i) => (
            <tr key={`${e.date}-${e.event}-${i}`} className="hover:bg-primary/3 transition-colors">
              <td className="px-3 py-1.5 text-primary tabular-nums whitespace-nowrap">{fmtDate(e.date)}</td>
              <td className="px-3 py-1.5 text-foreground/85 max-w-[320px] truncate" style={{ fontFamily: "var(--font-sans)" }}>
                {e.event}
              </td>
              <td className="px-3 py-1.5 text-foreground/60 whitespace-nowrap">{e.country || "—"}</td>
              <td className="px-3 py-1.5 text-center whitespace-nowrap">
                {e.impact ? (
                  <span className={IMPACT_CLS[e.impact]}>
                    <span className="text-[10px] select-none">●</span>{" "}
                    <span className="text-[10px]">{IMPACT_ES[e.impact]}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground/20">—</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-foreground/65">{fmtNum(e.estimate, e.unit)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-foreground/65">{fmtNum(e.previous, e.unit)}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${e.actual == null ? "text-muted-foreground/20" : "text-primary"}`}>
                {fmtNum(e.actual, e.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MacroCalendarSubSection() {
  const [data, setData]       = useState<MacroCalendarResponse | null>(macroCache?.data ?? null);
  const [loading, setLoading] = useState(!macroCache);
  const [error, setError]     = useState(false);

  useEffect(() => {
    if (macroCache && Date.now() - macroCache.ts < MACRO_TTL_MS) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchMacroCalendar()
      .then((d) => {
        if (cancelled) return;
        if (d) {
          macroCache = { ts: Date.now(), data: d };
          setData(d);
        } else {
          setError(true);
        }
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading && !data) {
    return (
      <div className="py-10 text-center text-[10px] tracking-widest text-muted-foreground/50 animate-pulse">
        CARGANDO CALENDARIO MACRO...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="py-10 text-center text-[11px] text-destructive/80 border border-destructive/30 bg-destructive/5">
        Error al cargar el calendario macro. Inténtalo de nuevo más tarde.
      </div>
    );
  }

  const events = data?.events ?? [];
  if (events.length === 0) {
    const diag = data?.diagnostics ?? {};
    const SRC_LABEL: Record<string, string> = { fmp: "FMP", finnhub: "Finnhub", fred: "FRED" };
    const rows = Object.entries(diag);
    return (
      <div className="py-10 px-4 text-center border border-border bg-card">
        <div className="text-[11px] text-muted-foreground/60 mb-2">Sin eventos macro disponibles</div>
        {rows.length > 0 ? (
          <div className="inline-block text-left mx-auto">
            <div className="text-[10px] text-muted-foreground/40 mb-1.5">
              Fuentes intentadas{data ? ` para ${data.from} → ${data.to}` : ""}:
            </div>
            <ul className="space-y-1">
              {rows.map(([src, status]) => (
                <li key={src} className="text-[10px] font-mono text-muted-foreground/50">
                  <span className="text-foreground/70">{SRC_LABEL[src] ?? src}</span>: {status}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground/35">
            Ninguna fuente devolvió eventos económicos para la ventana actual
            {data ? ` (${data.from} → ${data.to})` : ""}.
          </div>
        )}
      </div>
    );
  }

  // Split by today's date (UTC) — recent prints vs what's coming.
  const todayIso = new Date().toISOString().slice(0, 10);
  const past = events.filter((e) => e.date.slice(0, 10) < todayIso);
  const upcoming = events.filter((e) => e.date.slice(0, 10) >= todayIso);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono">
        <span className="text-muted-foreground/50">EVENTOS ECONÓMICOS · ALTA Y MEDIA IMPORTANCIA</span>
        <span className="text-primary/70 border border-primary/25 px-1.5 py-0.5">
          {data?.source === "finnhub" ? "FINNHUB" : data?.source === "fred" ? "FRED · EE.UU." : "FMP"}
        </span>
        {data && <span className="text-muted-foreground/35">{data.from} → {data.to}</span>}
      </div>

      <div>
        <div className="text-[10px] tracking-widest text-foreground font-semibold mb-1.5">
          PRÓXIMOS EVENTOS <span className="text-muted-foreground/40 font-normal">({upcoming.length})</span>
        </div>
        <EventsTable events={upcoming} emptyText="Sin eventos programados en los próximos 30 días." />
      </div>

      <div>
        <div className="text-[10px] tracking-widest text-foreground font-semibold mb-1.5">
          EVENTOS RECIENTES <span className="text-muted-foreground/40 font-normal">({past.length})</span>
        </div>
        <EventsTable events={[...past].reverse()} emptyText="Sin eventos publicados en los últimos 14 días." />
      </div>
    </div>
  );
}
