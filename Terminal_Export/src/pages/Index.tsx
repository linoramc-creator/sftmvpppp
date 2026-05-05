import { useState, useRef, useCallback, useEffect } from "react";
import { AlertCircle, Loader2, ChevronDown, Bookmark, Trash2, Search } from "lucide-react";
import { streamAnalysis, type QuarterlyPeriod } from "@/lib/analyze";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────

interface SavedReport {
  id: string;
  ticker: string;
  savedAt: string;
  analysis: string;
  quarterlyData: QuarterlyPeriod[];
}

// ── Persistence ────────────────────────────────────────────────────────

const STORAGE_KEY = "terminal_reports_v1";

function loadReports(): SavedReport[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch (_) { return []; }
}

function persistReports(reports: SavedReport[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); }
  catch (_) { /* quota exceeded */ }
}

// ── Section config ─────────────────────────────────────────────────────

const SECTION_CONFIG: Record<string, { label: string; category: string }> = {
  "Resumen Ejecutivo": { label: "RESUMEN EJECUTIVO",  category: "EXECUTIVE SUMMARY"    },
  "Finanzas":          { label: "FUNDAMENTALES",       category: "VALUATION & FINANCIALS"},
  "Valoración":        { label: "VALORACIÓN",          category: "VALUATION"             },
  "Competidores":      { label: "COMPETIDORES",        category: "PEERS & COMPS"         },
  "Noticias":          { label: "NOTICIAS",            category: "MARKET NEWS"           },
  "Institucional":     { label: "INSTITUCIONAL",       category: "OWNERSHIP"             },
};

const EXPECTED_TABS = Object.keys(SECTION_CONFIG);

// ── Helpers ────────────────────────────────────────────────────────────

function fmtPeriod(p: string): string {
  const d = new Date(p + "T00:00:00Z");
  if (isNaN(d.getTime())) return p;
  const s = d.toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
  return s.replace(".", "").toUpperCase();
}

const ND_VALUES = new Set(["N/D", "", "N/A", "-"]);

function cleanVal(v: string): string {
  if (ND_VALUES.has(v)) return "—";
  return v.replace(/(-?\d+\.\d{3,})/g, (m) => {
    const n = parseFloat(m); return isNaN(n) ? m : n.toFixed(2);
  });
}

function allND(values: string[]) { return values.every((v) => ND_VALUES.has(v)); }
function isPositive(v: string) { return v.startsWith("+"); }
function isNegative(v: string) { return v.startsWith("-") && v !== "N/D" && v !== "—"; }

function numClass(v: string, colorize = false) {
  if (v === "—" || v === "N/D") return "text-muted-foreground/30";
  if (!colorize) return "text-foreground/80 font-mono";
  if (isPositive(v)) return "text-primary font-mono";
  if (isNegative(v)) return "text-destructive font-mono";
  return "text-foreground/80 font-mono";
}

// ── Main component ─────────────────────────────────────────────────────

const Index = () => {
  const [ticker, setTicker]               = useState("");
  const [analysis, setAnalysis]           = useState("");
  const [isLoading, setIsLoading]         = useState(false);
  const [currentTicker, setCurrentTicker] = useState("");
  const [error, setError]                 = useState("");
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyPeriod[]>([]);
  const [navTab, setNavTab]               = useState<"ticker" | "guardados">("ticker");
  const [savedReports, setSavedReports]   = useState<SavedReport[]>(loadReports);
  const [expanded, setExpanded]           = useState<Record<string, boolean>>({});
  const [clock, setClock]                 = useState("");
  const [viewingReport, setViewingReport] = useState<SavedReport | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const d = now.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase();
      const t = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
      setClock(`${d} ${t}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const openAllSections = () => {
    const all: Record<string, boolean> = {};
    EXPECTED_TABS.forEach((t) => (all[t] = true));
    setExpanded(all);
  };

  const handleAnalyze = useCallback(async () => {
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setAnalysis("");
    setError("");
    setCurrentTicker(clean);
    setQuarterlyData([]);
    setViewingReport(null);
    openAllSections();

    let accumulated = "";
    try {
      await streamAnalysis({
        ticker: clean,
        signal: controller.signal,
        onDelta: (chunk) => { accumulated += chunk; setAnalysis(accumulated); },
        onDone: () => setIsLoading(false),
        onError: (err) => {
          setError(err);
          setIsLoading(false);
          toast({ title: "Error", description: err, variant: "destructive" });
        },
        onQuarterlyData: (data) => setQuarterlyData(data),
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setIsLoading(false);
      setError("Error de conexión. Inténtalo de nuevo.");
    }
  }, [ticker, toast]);

  const handleSave = useCallback(() => {
    if (!analysis || !currentTicker) return;
    const report: SavedReport = {
      id: `${currentTicker}_${Date.now()}`,
      ticker: currentTicker,
      savedAt: new Date().toLocaleDateString("es-ES", {
        day: "2-digit", month: "short", year: "numeric",
      }).toUpperCase(),
      analysis,
      quarterlyData,
    };
    const updated = [report, ...savedReports.filter((r) => r.ticker !== currentTicker)];
    setSavedReports(updated);
    persistReports(updated);
    toast({ title: "Informe guardado", description: `${currentTicker} guardado correctamente.` });
  }, [analysis, currentTicker, quarterlyData, savedReports, toast]);

  const handleDeleteReport = useCallback((id: string) => {
    const updated = savedReports.filter((r) => r.id !== id);
    setSavedReports(updated);
    persistReports(updated);
    if (viewingReport?.id === id) setViewingReport(null);
  }, [savedReports, viewingReport]);

  const toggleSection = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) handleAnalyze();
  };

  const activeAnalysis     = viewingReport ? viewingReport.analysis     : analysis;
  const activeQuarterly    = viewingReport ? viewingReport.quarterlyData : quarterlyData;
  const activeTicker       = viewingReport ? viewingReport.ticker        : currentTicker;
  const isLive             = !viewingReport;

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card">
        <div className="flex items-center justify-between px-5 h-10">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary inline-block" />
              <span className="text-primary font-bold text-xs tracking-[0.25em]">TERMINAL</span>
            </div>
            <nav className="flex">
              {(["TICKER", "GUARDADOS"] as const).map((label) => {
                const key = label === "TICKER" ? "ticker" : "guardados" as const;
                const active = navTab === key;
                return (
                  <button
                    key={label}
                    onClick={() => setNavTab(key)}
                    className={`px-4 h-10 text-[11px] tracking-widest transition-colors ${
                      active
                        ? "text-primary border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                    {label === "GUARDADOS" && savedReports.length > 0 && (
                      <span className="ml-1.5 text-[9px] bg-primary/15 text-primary px-1.5 py-0.5">
                        {savedReports.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
          {/* Right: live indicator + clock */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50 tabular-nums">
            <span className="text-primary/50 tracking-widest">MKT</span>
            <span className="text-primary/70">·</span>
            <span className="text-primary/70 tracking-widest">LIVE</span>
            <span className="text-primary/70">·</span>
            <span>{clock}</span>
          </div>
        </div>
      </header>

      {/* ── TICKER tab ──────────────────────────────────────────────── */}
      {navTab === "ticker" && (
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-16">

          {/* Search row */}
          <div className="flex gap-2 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground/30" />
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                placeholder="TICKER — AAPL, MSFT, NVDA, ASML..."
                maxLength={20}
                className="w-full h-8 pl-8 pr-3 bg-card border border-border text-foreground text-xs placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary transition-colors font-mono"
              />
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isLoading || !ticker.trim()}
              className="h-8 px-5 bg-primary text-black font-bold text-[11px] tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-opacity"
            >
              {isLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : "ANALIZAR"}
            </button>
            {!isLoading && analysis && isLive && (
              <button
                onClick={handleSave}
                className="h-8 px-4 border border-primary/40 text-primary text-[11px] tracking-widest hover:bg-primary/8 transition-colors flex items-center gap-1.5"
              >
                <Bookmark className="h-3 w-3" />
                GUARDAR INFORME
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 border border-destructive/40 bg-destructive/5 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive font-mono">{error}</p>
            </div>
          )}

          {/* Viewing saved banner */}
          {viewingReport && (
            <div className="mb-4 px-4 py-2 border border-primary/25 bg-primary/4 flex items-center justify-between">
              <span className="text-[10px] text-primary/70 tracking-widest">
                INFORME GUARDADO · {viewingReport.ticker} · {viewingReport.savedAt}
              </span>
              <button
                onClick={() => setViewingReport(null)}
                className="text-[10px] text-muted-foreground/50 hover:text-foreground tracking-widest"
              >
                CERRAR
              </button>
            </div>
          )}

          {/* Loading placeholder */}
          {isLoading && !activeAnalysis && (
            <div className="flex items-center gap-3 py-10 text-muted-foreground text-[11px] tracking-widest">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              RECOPILANDO DATOS DE MERCADO...
            </div>
          )}

          {/* Empty state */}
          {!activeAnalysis && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center py-28 opacity-20">
              <div className="text-5xl font-bold tracking-[0.3em] text-primary mb-3">TERMINAL</div>
              <p className="text-[10px] tracking-[0.4em] text-muted-foreground">
                INTRODUCE UN TICKER PARA GENERAR UN INFORME
              </p>
            </div>
          )}

          {/* Report */}
          {activeAnalysis && (
            <ReportView
              content={activeAnalysis}
              quarterlyData={activeQuarterly}
              ticker={activeTicker}
              isLoading={isLoading && isLive}
              expanded={expanded}
              onToggle={toggleSection}
            />
          )}
        </div>
      )}

      {/* ── GUARDADOS tab ───────────────────────────────────────────── */}
      {navTab === "guardados" && (
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-16">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-1.5 h-1.5 bg-primary inline-block" />
            <span className="text-[11px] tracking-widest text-foreground">INFORMES GUARDADOS</span>
            <span className="text-[10px] text-muted-foreground/40">{savedReports.length}</span>
          </div>

          {savedReports.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 opacity-25">
              <p className="text-[10px] tracking-widest text-muted-foreground">
                NO HAY INFORMES GUARDADOS
              </p>
            </div>
          )}

          <div className="space-y-1">
            {savedReports.map((report) => (
              <SavedReportCard
                key={report.id}
                report={report}
                onView={() => {
                  setViewingReport(report);
                  openAllSections();
                  setNavTab("ticker");
                }}
                onDelete={() => handleDeleteReport(report.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Report View (accordion) ────────────────────────────────────────────

function ReportView({
  content, quarterlyData, ticker, isLoading, expanded, onToggle,
}: {
  content: string;
  quarterlyData: QuarterlyPeriod[];
  ticker: string;
  isLoading: boolean;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const sections = parseSections(content);

  return (
    <div className="space-y-px">
      {/* Ticker header strip */}
      {ticker && (
        <div className="flex items-center gap-4 px-4 py-3 border border-border bg-card mb-3">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <span className="text-base font-bold text-primary tracking-[0.15em]">{ticker}</span>
          <span className="text-[10px] text-muted-foreground/40 tracking-widest">INFORME DE ANÁLISIS FINANCIERO</span>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 ml-auto" />}
        </div>
      )}

      {EXPECTED_TABS.map((key) => {
        const cfg = SECTION_CONFIG[key];
        const sectionNodes = sections[key];
        const hasQuarterly = key === "Finanzas" && quarterlyData.length > 0;
        if (!sectionNodes && !hasQuarterly) return null;

        const isOpen = expanded[key] !== false;
        const isLastSection = key === EXPECTED_TABS[EXPECTED_TABS.length - 1];

        return (
          <div key={key} className="border border-border">
            {/* Section header */}
            <button
              onClick={() => onToggle(key)}
              className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ChevronDown
                  className={`h-3 w-3 text-muted-foreground/50 transition-transform duration-150 ${isOpen ? "" : "-rotate-90"}`}
                />
                <span className="text-[11px] tracking-widest text-foreground font-semibold">
                  {cfg.label}
                </span>
              </div>
              <span className="text-[9px] tracking-widest text-muted-foreground/30 hidden sm:block">
                {cfg.category}
              </span>
            </button>

            {/* Section content */}
            {isOpen && (
              <div className="px-4 pt-3 pb-5 border-t border-border/50 analysis-content">
                {key === "Finanzas" && hasQuarterly && (
                  <QuarterlyHistorySection data={quarterlyData} />
                )}
                {sectionNodes && renderElements(sectionNodes)}
                {isLoading && isLastSection && (
                  <span className="terminal-cursor text-primary ml-1" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Saved report card ──────────────────────────────────────────────────

function SavedReportCard({
  report, onView, onDelete,
}: {
  report: SavedReport;
  onView: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-border bg-card flex items-center justify-between px-4 py-3 hover:border-border/80 transition-colors">
      <button onClick={onView} className="flex items-center gap-5 text-left flex-1 min-w-0">
        <span className="w-1.5 h-1.5 bg-primary/60 shrink-0" />
        <span className="text-sm font-bold text-primary tracking-wider">{report.ticker}</span>
        <span className="text-[10px] text-muted-foreground/50 tracking-wider">{report.savedAt}</span>
      </button>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onView}
          className="text-[10px] tracking-widest text-primary/60 hover:text-primary border border-primary/20 px-3 py-1.5 hover:bg-primary/5 transition-colors"
        >
          VER INFORME
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-muted-foreground/30 hover:text-destructive border border-border hover:border-destructive/30 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Quarterly tables ───────────────────────────────────────────────────

function QTable({ title, rows, periods, rightLabel }: {
  title: string;
  periods: string[];
  rightLabel: string;
  rows: { label: string; values: string[]; colorize?: boolean }[];
}) {
  const visible = rows.filter((r) => !allND(r.values));
  if (!visible.length) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/60 border-b border-border">
        <span className="text-[10px] tracking-widest text-foreground font-semibold">{title}</span>
        <span className="text-[9px] tracking-widest text-muted-foreground/40">{rightLabel}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/50 font-medium w-32">
                MÉTRICA
              </th>
              {periods.map((p, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 text-center text-[10px] tracking-widest font-semibold ${
                    i === 0 ? "text-primary" : "text-muted-foreground/50"
                  }`}
                >
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {visible.map((row) => {
              const cleaned = row.values.map(cleanVal);
              return (
                <tr key={row.label} className="hover:bg-primary/3 transition-colors">
                  <td className="px-3 py-2 text-[10px] tracking-wider text-muted-foreground/60 whitespace-nowrap border-r border-border/30">
                    {row.label}
                  </td>
                  {cleaned.map((v, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2 text-center text-xs whitespace-nowrap ${numClass(v, row.colorize)}`}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuarterlyHistorySection({ data }: { data: QuarterlyPeriod[] }) {
  if (!data.length) return null;
  const periods = data.map((q) => fmtPeriod(q.period));
  const col = (f: keyof QuarterlyPeriod) => data.map((q) => q[f] as string);

  return (
    <div className="mb-5 border border-border">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/40">
        <span className="text-[10px] tracking-widest text-foreground font-semibold">HISTÓRICO TRIMESTRAL</span>
        <span className="text-[9px] tracking-widest text-muted-foreground/40">QUARTERLY RESULTS</span>
      </div>
      <div className="p-3 space-y-px">
        <QTable
          title="CUENTA DE RESULTADOS"
          rightLabel="P&L"
          periods={periods}
          rows={[
            { label: "Revenue",      values: col("revenue") },
            { label: "Var. YoY",     values: col("revenueGrowth"), colorize: true },
            { label: "M. Bruto",     values: col("grossMargin"),   colorize: true },
            { label: "EBITDA",       values: col("ebitda") },
            { label: "Bfº Neto",     values: col("netIncome") },
            { label: "M. Neto",      values: col("netMargin"),     colorize: true },
            { label: "EPS",          values: col("eps") },
          ]}
        />
        <QTable
          title="CASH FLOW"
          rightLabel="CASH FLOW STATEMENT"
          periods={periods}
          rows={[
            { label: "CF Operativo", values: col("operatingCF") },
            { label: "Free CF",      values: col("freeCashFlow") },
            { label: "Capex",        values: col("capex") },
          ]}
        />
        <QTable
          title="BALANCE / SOLVENCIA"
          rightLabel="BALANCE SHEET"
          periods={periods}
          rows={[
            { label: "Caja",         values: col("cash") },
            { label: "Deuda Total",  values: col("totalDebt") },
            { label: "Deuda Neta",   values: col("netDebt") },
            { label: "Equity",       values: col("equity") },
            { label: "Total Activos",values: col("totalAssets") },
          ]}
        />
      </div>
    </div>
  );
}

// ── Markdown parser ────────────────────────────────────────────────────

function parseSections(content: string): Record<string, React.ReactNode[]> {
  const lines = content.split("\n");
  const sections: Record<string, React.ReactNode[]> = {};
  let currentSection = "Resumen Ejecutivo";
  let currentElements: React.ReactNode[] = [];

  const flush = () => {
    if (sections[currentSection]) {
      sections[currentSection] = [...sections[currentSection], ...currentElements];
    } else {
      sections[currentSection] = currentElements;
    }
    currentElements = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      flush();
      currentSection = line.slice(3).trim();
      i++;
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      currentElements.push(renderTable(tableLines, i));
      continue;
    }

    if (line.startsWith("### ")) {
      currentElements.push(
        <h3 key={i}>{line.slice(4)}</h3>
      );
    } else if (line.startsWith("#### ")) {
      currentElements.push(
        <h4 key={i}>{line.slice(5)}</h4>
      );
    } else if (line.match(/^---+$/)) {
      currentElements.push(<hr key={i} />);
    } else if (line.match(/^[-*] /)) {
      currentElements.push(
        <li key={i} className="ml-1 mb-2 list-none flex items-start gap-2">
          <span className="text-primary/50 mt-0.5 text-[10px] select-none shrink-0">▸</span>
          <span className="flex-1 text-foreground/75 text-xs leading-relaxed" style={{ fontFamily: "var(--font-sans)" }}>
            {renderInline(line.slice(2))}
          </span>
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      const m = line.match(/^(\d+)\. (.*)$/);
      if (m) {
        currentElements.push(
          <li key={i} className="ml-4 mb-2 list-decimal text-muted-foreground marker:text-primary marker:font-semibold text-xs">
            <span className="text-foreground/75" style={{ fontFamily: "var(--font-sans)" }}>{renderInline(m[2])}</span>
          </li>
        );
      }
    } else if (line.startsWith("> ")) {
      currentElements.push(
        <blockquote key={i}>{line.slice(2)}</blockquote>
      );
    } else if (line.trim() === "") {
      currentElements.push(<div key={i} className="h-1.5" />);
    } else {
      currentElements.push(
        <p key={i}>{renderInline(line)}</p>
      );
    }

    i++;
  }

  flush();

  // Remove purely empty sections
  const cleaned: Record<string, React.ReactNode[]> = {};
  for (const [k, els] of Object.entries(sections)) {
    if (els.some((el) => el !== null && typeof el === "object" && (el as any).type !== "div")) {
      cleaned[k] = els;
    }
  }
  return cleaned;
}

function renderElements(elements: React.ReactNode[]) {
  return <div className="space-y-0.5">{elements}</div>;
}

function renderTable(tableLines: string[], baseKey: number) {
  if (tableLines.length < 2) return null;

  const parseRow = (line: string) =>
    line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const headerCells = parseRow(tableLines[0]);
  const isSep = (line: string) => /^\|?[\s\-:|]+\|?$/.test(line);
  const startData = isSep(tableLines[1]) ? 2 : 1;
  const dataRows = tableLines.slice(startData).filter((l) => !isSep(l));

  return (
    <div key={`tbl-${baseKey}`} className="my-4 overflow-x-auto border border-border">
      <table className="w-full text-xs font-mono min-w-max">
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            {headerCells.map((cell, j) => (
              <th
                key={j}
                className="px-3 py-2 text-left text-[10px] tracking-widest text-muted-foreground/60 font-medium uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {dataRows.map((row, ri) => {
            const cells = parseRow(row);
            return (
              <tr key={ri} className="hover:bg-primary/3 transition-colors">
                {headerCells.map((_, j) => {
                  const raw = (cells[j] ?? "").replace(/^\*+|\*+$/g, "").trim() || "—";
                  const val = raw.replace(/(-?\d+\.\d{3,})/g, (m) => {
                    const n = parseFloat(m); return isNaN(n) ? m : n.toFixed(2);
                  });
                  const isNDVal = val === "N/D" || val === "—";
                  const isNum   = /^[-+$]?\d/.test(val) || val.includes("%") || val.includes("x");
                  const isNeg   = /^-/.test(val) && !isNDVal;

                  let cls = j === 0 ? "text-foreground/80 font-medium" : "text-foreground/65";
                  if (isNum && !isNeg) cls = "text-primary font-mono";
                  if (isNeg)          cls = "text-destructive font-mono";
                  if (isNDVal)        cls = "text-muted-foreground/25";

                  return (
                    <td key={j} className={`px-3 py-2 whitespace-nowrap text-xs ${cls}`}>
                      {renderInline(val)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
    }
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return (
          <code key={`${i}-${j}`} className="bg-primary/10 text-primary px-1 py-0.5 text-xs">
            {cp.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${i}-${j}`}>{cp}</span>;
    });
  });
}

export default Index;
