import { useState, useRef, useCallback, useEffect } from "react";
import { AlertCircle, Loader2, ChevronDown, Bookmark, Trash2, Search } from "lucide-react";
import { streamAnalysis, streamSectorAnalysis, fetchMarketData, type QuarterlyPeriod, type MarketData, type QuarterlyDebug, type CatalystCalendar } from "@/lib/analyze";
import { useToast } from "@/hooks/use-toast";
import { IndexSparkline } from "@/components/charts/IndexCharts";
import { IncomeChart, CashFlowChart, BalanceChart, MarginsChart, GrowthChart, type IncomeData, type CashFlowData, type BalanceData, type MarginsData, type GrowthData } from "@/components/charts/FintechCharts";
import { OptionsSubSection } from "@/components/options/OptionsSubSection";
import { RiskSubSection } from "@/components/charts/RiskCharts";
import { EtfSubSection } from "@/components/charts/ETFCharts";
import { TechnicalSubSection } from "@/components/charts/TechnicalCharts";
import { InstrumentPriceChart } from "@/components/charts/InstrumentPriceChart";
import { fetchEtfData } from "@/lib/etf-api";
import type { EtfResponse } from "@/types/etf";

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

function persistReports(reports: SavedReport[]): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(reports)); return true; }
  catch (_) { return false; }
}

// ── Section configs ────────────────────────────────────────────────────

const SECTION_CONFIG: Record<string, { label: string; category: string }> = {
  "Resumen Ejecutivo":      { label: "RESUMEN EJECUTIVO",     category: "EXECUTIVE SUMMARY"     },
  "Finanzas":               { label: "FUNDAMENTALES",          category: "VALUATION & FINANCIALS" },
  "Opciones":               { label: "OPCIONES",               category: "OPTIONS FLOW"           },
  "Valoración":             { label: "VALORACIÓN",             category: "VALUATION"              },
  "Sector":                 { label: "SECTOR",                 category: "SECTOR & COMPS"         },
  "Noticias":               { label: "NOTICIAS",               category: "MARKET NEWS"            },
  "Señales Técnicas":       { label: "SEÑALES TÉCNICAS",       category: "TECHNICAL ANALYSIS"     },
  "Riesgo":                 { label: "RIESGO",                 category: "RISK ANALYTICS"         },
  "Institucional":          { label: "INSTITUCIONAL",          category: "OWNERSHIP"              },
};

// ETF apartado: basic valuation only — no quarterly fundamentals, no red
// flags, no insider, no institutional (those blocks don't apply to funds).
const ETF_SECTION_CONFIG: Record<string, { label: string; category: string }> = {
  "Resumen Ejecutivo": { label: "RESUMEN EJECUTIVO", category: "EXECUTIVE SUMMARY"  },
  "Valoración":        { label: "VALORACIÓN",        category: "VALUATION"          },
  "ETF":               { label: "ETF",               category: "FUND DEEP DIVE"     },
  "Opciones":          { label: "OPCIONES",          category: "OPTIONS FLOW"       },
  "Riesgo":            { label: "RIESGO",            category: "RISK ANALYTICS"     },
  "Noticias":          { label: "NOTICIAS",          category: "MARKET NEWS"        },
  "Señales Técnicas":  { label: "SEÑALES TÉCNICAS",  category: "TECHNICAL ANALYSIS" },
};

const SECTOR_SECTION_CONFIG: Record<string, { label: string; category: string }> = {
  "Panorama del Sector":        { label: "PANORAMA",            category: "OVERVIEW"         },
  "Empresas Líderes":           { label: "EMPRESAS LÍDERES",    category: "TOP COMPANIES"    },
  "Mejores ETFs":               { label: "MEJORES ETFs",        category: "ETF SELECTION"    },
  "Noticias y Tendencias":      { label: "NOTICIAS Y TENDENCIAS", category: "NEWS & TRENDS"  },
  "Análisis Macro":             { label: "ANÁLISIS MACRO",      category: "MACRO CONTEXT"    },
  "Perspectivas y Catalizadores": { label: "PERSPECTIVAS",      category: "OUTLOOK"          },
  "Riesgos del Sector":         { label: "RIESGOS DEL SECTOR",  category: "RISKS"            },
};

const EXPECTED_TABS    = Object.keys(SECTION_CONFIG);
const ETF_TABS         = Object.keys(ETF_SECTION_CONFIG);
const SECTOR_TABS      = Object.keys(SECTOR_SECTION_CONFIG);

// ── Helpers ────────────────────────────────────────────────────────────

function fmtPeriod(p: string): string {
  const d = new Date(p + "T00:00:00Z");
  if (isNaN(d.getTime())) return p;
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  const year = d.getUTCFullYear().toString().slice(2);
  return `Q${quarter}'${year}`;
}

const ND_VALUES = new Set(["N/D", "", "N/A", "-"]);

function cleanVal(v: string): string {
  if (ND_VALUES.has(v)) return "—";
  // Normalize large M values to B: "$864,498.00M" → "$864.50B"
  const mMatch = v.match(/^\$?([\d,]+(?:\.\d+)?)M$/);
  if (mMatch) {
    const millions = parseFloat(mMatch[1].replace(/,/g, ""));
    if (!isNaN(millions) && millions >= 1000) {
      const prefix = v.startsWith("$") ? "$" : "";
      return `${prefix}${(millions / 1000).toFixed(2)}B`;
    }
  }
  return v.replace(/(-?\d+\.\d{3,})/g, (m) => {
    const n = parseFloat(m); return isNaN(n) ? m : n.toFixed(2);
  });
}

function allND(values: string[]) { return values.every((v) => ND_VALUES.has(v)); }

// ── Chart data transformers ────────────────────────────────────────────
// The backend ships pre-formatted strings ("$12.34B", "-$5.67B", "+45.6%", "N/D")
// so the UI tables can render directly. Recharts needs raw numbers, so we parse
// the same strings back. Returns null when the value is N/D so chart series
// gracefully skip missing points instead of plotting as 0.
function parseMoney(s: string | undefined | null): number | null {
  if (!s || ND_VALUES.has(s)) return null;
  const m = s.match(/^(-?)\$?(-?)([\d,]+(?:\.\d+)?)([BMK]?)$/);
  if (!m) return null;
  const sign = (m[1] === "-" || m[2] === "-") ? -1 : 1;
  const num = parseFloat(m[3].replace(/,/g, ""));
  if (isNaN(num)) return null;
  const mult = m[4] === "B" ? 1e9 : m[4] === "M" ? 1e6 : m[4] === "K" ? 1e3 : 1;
  return sign * num * mult;
}

function parsePercent(s: string | undefined | null): number | null {
  if (!s || ND_VALUES.has(s)) return null;
  const m = s.match(/^([+-]?)([\d.]+)%$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const num = parseFloat(m[2]);
  return isNaN(num) ? null : sign * num;
}

// Build chart-ready arrays from the full quarterly history (oldest → newest).
// We only include quarters that have at least one non-null field for the chart's
// dimension; missing fields default to 0 so the chart still renders the
// quarters present and the user can see the gaps in context.
function buildIncomeChartData(data: QuarterlyPeriod[]): IncomeData[] {
  return [...data]
    .reverse()
    .map((q) => {
      const revenue = parseMoney(q.revenue);
      const ebitda = parseMoney(q.ebitda);
      const netIncome = parseMoney(q.netIncome);
      if (revenue == null && ebitda == null && netIncome == null) return null;
      return { period: fmtPeriod(q.period), revenue, ebitda, netIncome };
    })
    .filter((d): d is IncomeData => d !== null);
}

function buildCashFlowChartData(data: QuarterlyPeriod[]): CashFlowData[] {
  return [...data]
    .reverse()
    .map((q) => {
      const operating = parseMoney(q.operatingCF);
      const capex = parseMoney(q.capex);
      const fcf = parseMoney(q.freeCashFlow);
      if (operating == null && capex == null && fcf == null) return null;
      return { period: fmtPeriod(q.period), operating, capex, fcf };
    })
    .filter((d): d is CashFlowData => d !== null);
}

function buildBalanceChartData(data: QuarterlyPeriod[]): BalanceData[] {
  return [...data]
    .reverse()
    .map((q) => {
      const totalAssets = parseMoney(q.totalAssets);
      const cash = parseMoney(q.cash);
      const totalDebt = parseMoney(q.totalDebt);
      const equity = parseMoney(q.equity);
      if (totalAssets == null && cash == null && totalDebt == null && equity == null) return null;
      return { period: fmtPeriod(q.period), totalAssets, cash, totalDebt, equity };
    })
    .filter((d): d is BalanceData => d !== null);
}

function buildMarginsChartData(data: QuarterlyPeriod[]): MarginsData[] {
  return [...data]
    .reverse()
    .map((q) => {
      let grossMargin = parsePercent(q.grossMargin);
      let netMargin   = parsePercent(q.netMargin);
      // Client-side fallback: compute from raw monetary values when backend returns N/D
      if (netMargin == null) {
        const rev = parseMoney(q.revenue);
        const net = parseMoney(q.netIncome);
        if (rev != null && rev !== 0 && net != null) netMargin = (net / rev) * 100;
      }
      if (grossMargin == null) {
        const rev   = parseMoney(q.revenue);
        const ebit  = parseMoney(q.ebitda);  // use EBITDA margin as gross proxy only when both missing
        if (rev != null && rev !== 0 && ebit != null && netMargin == null) {
          grossMargin = (ebit / rev) * 100;
        }
      }
      if (grossMargin == null && netMargin == null) return null;
      return { period: fmtPeriod(q.period), grossMargin, netMargin };
    })
    .filter((d): d is MarginsData => d !== null);
}

function buildGrowthChartData(data: QuarterlyPeriod[]): GrowthData[] {
  const reversed = [...data].reverse(); // oldest → newest
  return reversed
    .map((q, idx) => {
      let revenueGrowth = parsePercent(q.revenueGrowth);
      // Client-side fallback: compute YoY from revenue when backend returns N/D
      if (revenueGrowth == null && idx >= 4) {
        const curr = parseMoney(q.revenue);
        const prev = parseMoney(reversed[idx - 4].revenue);
        if (curr != null && prev != null && Math.abs(prev) > 0) {
          revenueGrowth = ((curr - prev) / Math.abs(prev)) * 100;
        }
      }
      if (revenueGrowth == null) return null;
      return { period: fmtPeriod(q.period), revenueGrowth };
    })
    .filter((d): d is GrowthData => d !== null);
}

// Extract the "| Métrica | Valor |" markdown table from analysis text
function extractCurrentMetrics(content: string): { label: string; value: string }[] {
  const result: { label: string; value: string }[] = [];
  if (!content) return result;
  const match = content.match(/\|\s*Métrica\s*\|\s*Valor\s*\|[\s\S]+?(?=\n\s*\n|\n##|\n###|\n[^|])/i);
  if (!match) return result;
  const lines = match[0].split("\n");
  const ND = new Set(["N/D", "N/A", "—", "-", ""]);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.includes("|")) continue;
    if (/^\|?[\s\-:|]+\|?$/.test(line)) continue;
    if (/Métrica/i.test(line)) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.replace(/^\*+|\*+$/g, "").trim());
    if (cells.length >= 2 && cells[0] && !ND.has(cells[1])) {
      result.push({ label: cells[0], value: cells[1] });
    }
  }
  return result;
}

// ── Main component ─────────────────────────────────────────────────────

const Index = () => {
  // Ticker state
  const [ticker, setTicker]               = useState("");
  const [analysis, setAnalysis]           = useState("");
  const [isLoading, setIsLoading]         = useState(false);
  const [currentTicker, setCurrentTicker] = useState("");
  const [error, setError]                 = useState("");
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyPeriod[]>([]);
  const [quarterlyDebug, setQuarterlyDebug] = useState<QuarterlyDebug | null>(null);
  const [catalystCalendar, setCatalystCalendar] = useState<CatalystCalendar | null>(null);
  const [tickerIsEtf, setTickerIsEtf]     = useState<string | null>(null);
  const [savedReports, setSavedReports]   = useState<SavedReport[]>(loadReports);
  const [activeSection, setActiveSection] = useState<string>(EXPECTED_TABS[0]);
  const [viewingReport, setViewingReport] = useState<SavedReport | null>(null);

  // ETF apartado state (independent of the ticker flow)
  const [etfInput, setEtfInput]               = useState("");
  const [etfAnalysis, setEtfAnalysis]         = useState("");
  const [isEtfLoading, setIsEtfLoading]       = useState(false);
  const [currentEtf, setCurrentEtf]           = useState("");
  const [etfError, setEtfError]               = useState("");
  const [etfNotFund, setEtfNotFund]           = useState<string | null>(null);
  const [etfDeep, setEtfDeep]                 = useState<EtfResponse | null>(null);
  const [etfActiveSection, setEtfActiveSection] = useState<string>(ETF_TABS[0]);

  // Sector state
  const [sectorInput, setSectorInput]         = useState("");
  const [sectorAnalysis, setSectorAnalysis]   = useState("");
  const [isSectorLoading, setIsSectorLoading] = useState(false);
  const [currentSector, setCurrentSector]     = useState("");
  const [sectorError, setSectorError]         = useState("");
  const [sectorExpanded, setSectorExpanded]   = useState<Record<string, boolean>>({});

  // Nav
  const [navTab, setNavTab] = useState<"ticker" | "etf" | "sector" | "guardados">("ticker");

  const [clock, setClock] = useState("");

  // Market ticker
  const [marketData,    setMarketData]    = useState<MarketData | null>(null);
  const [customStocks,  setCustomStocks]  = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("terminal_stocks_v1") || '["AAPL","MSFT","NVDA"]'); }
    catch (_) { return ["AAPL", "MSFT", "NVDA"]; }
  });

  const abortRef       = useRef<AbortController | null>(null);
  const etfAbortRef    = useRef<AbortController | null>(null);
  const sectorAbortRef = useRef<AbortController | null>(null);
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

  // Fetch market data on mount + every 60s
  useEffect(() => {
    const load = () => fetchMarketData(customStocks).then(d => { if (d) setMarketData(d); });
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [customStocks]);

  const saveCustomStocks = (stocks: string[]) => {
    setCustomStocks(stocks);
    try { localStorage.setItem("terminal_stocks_v1", JSON.stringify(stocks)); } catch (_) {}
  };

  const resetSections = () => setActiveSection(EXPECTED_TABS[0]);

  const openAllSectorSections = () => {
    const all: Record<string, boolean> = {};
    SECTOR_TABS.forEach((t) => (all[t] = true));
    setSectorExpanded(all);
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
    setQuarterlyDebug(null);
    setCatalystCalendar(null);
    setTickerIsEtf(null);
    setViewingReport(null);
    resetSections();

    // ETF detection runs in parallel with the stream. The ticker search no
    // longer analyses funds: when the symbol turns out to be an ETF we abort
    // the report and point the user to the dedicated ETF apartado.
    fetchEtfData(clean, controller.signal)
      .then((d) => {
        if (d?.found === true && !controller.signal.aborted) {
          controller.abort();
          setIsLoading(false);
          setAnalysis("");
          setTickerIsEtf(clean);
        }
      })
      .catch(() => { /* detection failure → treat as a regular ticker */ });

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
        onQuarterlyDebug: (debug) => setQuarterlyDebug(debug),
        onCatalystCalendar: (data) => setCatalystCalendar(data),
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setIsLoading(false);
      const msg = e instanceof Error ? e.message : "Error de conexión. Inténtalo de nuevo.";
      setError(msg);
    }
  }, [ticker, toast]);

  // ETF apartado: verifies the symbol IS a fund, then streams the ETF-mode
  // report (basic valuation only) while the deterministic deep-dive loads.
  const handleEtfAnalyze = useCallback(async (symbol?: string) => {
    const clean = (symbol ?? etfInput).trim().toUpperCase();
    if (!clean) return;

    etfAbortRef.current?.abort();
    const controller = new AbortController();
    etfAbortRef.current = controller;

    setIsEtfLoading(true);
    setEtfAnalysis("");
    setEtfError("");
    setEtfNotFund(null);
    setCurrentEtf(clean);
    setEtfDeep(null);
    setEtfActiveSection(ETF_TABS[0]);

    // Deep-dive data doubles as the is-it-a-fund gate.
    fetchEtfData(clean, controller.signal)
      .then((d) => {
        if (controller.signal.aborted) return;
        if (d?.found === true) {
          setEtfDeep(d);
        } else if (d && d.found === false) {
          controller.abort();
          setIsEtfLoading(false);
          setEtfAnalysis("");
          setEtfNotFund(clean);
        }
        // d === null (network/provider error) → keep streaming; the deep-dive
        // blocks will show their own empty states.
      })
      .catch(() => { /* same: don't block the report on a detection error */ });

    let accumulated = "";
    try {
      await streamAnalysis({
        ticker: clean,
        etfReport: true,
        signal: controller.signal,
        onDelta: (chunk) => { accumulated += chunk; setEtfAnalysis(accumulated); },
        onDone: () => setIsEtfLoading(false),
        onError: (err) => {
          setEtfError(err);
          setIsEtfLoading(false);
          toast({ title: "Error", description: err, variant: "destructive" });
        },
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setIsEtfLoading(false);
      const msg = e instanceof Error ? e.message : "Error de conexión. Inténtalo de nuevo.";
      setEtfError(msg);
    }
  }, [etfInput, toast]);

  // Jump from the ticker tab to the ETF apartado with the symbol pre-loaded.
  const analyzeAsEtf = useCallback((symbol: string) => {
    setNavTab("etf");
    setEtfInput(symbol);
    setTickerIsEtf(null);
    handleEtfAnalyze(symbol);
  }, [handleEtfAnalyze]);

  const handleSectorAnalyze = useCallback(async () => {
    const clean = sectorInput.trim();
    if (!clean) return;

    sectorAbortRef.current?.abort();
    const controller = new AbortController();
    sectorAbortRef.current = controller;

    setIsSectorLoading(true);
    setSectorAnalysis("");
    setSectorError("");
    setCurrentSector(clean);
    openAllSectorSections();

    let accumulated = "";
    try {
      await streamSectorAnalysis({
        sector: clean,
        signal: controller.signal,
        onDelta: (chunk) => { accumulated += chunk; setSectorAnalysis(accumulated); },
        onDone: () => setIsSectorLoading(false),
        onError: (err) => {
          setSectorError(err);
          setIsSectorLoading(false);
          toast({ title: "Error", description: err, variant: "destructive" });
        },
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setIsSectorLoading(false);
      const msg = e instanceof Error ? e.message : "Error de conexión. Inténtalo de nuevo.";
      setSectorError(msg);
    }
  }, [sectorInput, toast]);

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
    const ok = persistReports(updated);
    if (ok) {
      toast({ title: "Informe guardado", description: `${currentTicker} guardado correctamente.` });
    } else {
      toast({
        title: "Espacio agotado",
        description: "Se ha alcanzado el límite de almacenamiento del navegador. Borra informes antiguos.",
        variant: "destructive",
      });
    }
  }, [analysis, currentTicker, quarterlyData, savedReports, toast]);

  const handleDeleteReport = useCallback((id: string) => {
    const updated = savedReports.filter((r) => r.id !== id);
    setSavedReports(updated);
    persistReports(updated);
    if (viewingReport?.id === id) setViewingReport(null);
  }, [savedReports, viewingReport]);

  const toggleSectorSection = (key: string) =>
    setSectorExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) handleAnalyze();
  };

  const handleEtfKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isEtfLoading) handleEtfAnalyze();
  };

  const handleSectorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isSectorLoading) handleSectorAnalyze();
  };

  const activeAnalysis  = viewingReport ? viewingReport.analysis     : analysis;
  const activeQuarterly = viewingReport ? viewingReport.quarterlyData : quarterlyData;
  const activeTicker    = viewingReport ? viewingReport.ticker        : currentTicker;
  const activeCatalyst  = viewingReport ? null                        : catalystCalendar;
  const isLive          = !viewingReport;

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
              {([
                { label: "TICKER",    key: "ticker"    },
                { label: "ETF",       key: "etf"       },
                { label: "SECTOR",    key: "sector"    },
                { label: "GUARDADOS", key: "guardados" },
              ] as const).map(({ label, key }) => {
                const active = navTab === key;
                return (
                  <button
                    key={key}
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

      {/* ── Market ticker bar ───────────────────────────────────────── */}
      <MarketTickerBar
        data={marketData}
        customStocks={customStocks}
        onChangeStocks={saveCustomStocks}
      />

      {/* ── TICKER tab ──────────────────────────────────────────────── */}
      {navTab === "ticker" && (
        <div className="max-w-7xl mx-auto px-4 pt-5 pb-16 lg:flex lg:gap-6">
          <div className="flex-1 min-w-0">

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

          {/* Detected ETF → redirect to the dedicated apartado */}
          {tickerIsEtf && (
            <div className="mb-4 px-4 py-3 border border-primary/30 bg-primary/5 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] text-foreground/80 font-mono">
                <span className="text-primary font-bold">{tickerIsEtf}</span> es un ETF — los fondos se analizan en su propio apartado.
              </span>
              <button
                onClick={() => analyzeAsEtf(tickerIsEtf)}
                className="h-7 px-4 bg-primary text-black font-bold text-[10px] tracking-widest hover:bg-primary/90 transition-opacity"
              >
                ANALIZAR EN ETF
              </button>
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
              quarterlyDebug={isLive ? quarterlyDebug : null}
              catalystCalendar={activeCatalyst}
              ticker={activeTicker}
              isLoading={isLoading && isLive}
              activeSection={activeSection}
              onSelectSection={setActiveSection}
            />
          )}
          </div>

          {/* Right column — index charts */}
          <aside className="lg:w-[33%] lg:max-w-md lg:shrink-0 mt-8 lg:mt-0">
            <IndexChartsPanel marketData={marketData} />
          </aside>
        </div>
      )}

      {/* ── ETF tab (dedicated apartado — funds only) ───────────────── */}
      {navTab === "etf" && (
        <div className="max-w-7xl mx-auto px-4 pt-5 pb-16 lg:flex lg:gap-6">
          <div className="flex-1 min-w-0">

          {/* ETF search row */}
          <div className="flex gap-2 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground/30" />
              <input
                type="text"
                value={etfInput}
                onChange={(e) => setEtfInput(e.target.value.toUpperCase())}
                onKeyDown={handleEtfKeyDown}
                placeholder="ETF — SPY, QQQ, GLD, TAN, VWCE.DE..."
                maxLength={20}
                className="w-full h-8 pl-8 pr-3 bg-card border border-border text-foreground text-xs placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary transition-colors font-mono"
              />
            </div>
            <button
              onClick={() => handleEtfAnalyze()}
              disabled={isEtfLoading || !etfInput.trim()}
              className="h-8 px-5 bg-primary text-black font-bold text-[11px] tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-opacity whitespace-nowrap"
            >
              {isEtfLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : "ANALIZAR ETF"}
            </button>
          </div>

          {/* Error */}
          {etfError && (
            <div className="mb-4 p-3 border border-destructive/40 bg-destructive/5 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive font-mono">{etfError}</p>
            </div>
          )}

          {/* Not a fund → point back to the ticker search */}
          {etfNotFund && (
            <div className="mb-4 px-4 py-3 border border-primary/30 bg-primary/5 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] text-foreground/80 font-mono">
                <span className="text-primary font-bold">{etfNotFund}</span> no es un ETF — las acciones se analizan en el apartado TICKER.
              </span>
              <button
                onClick={() => {
                  setNavTab("ticker");
                  setTicker(etfNotFund);
                  setEtfNotFund(null);
                }}
                className="h-7 px-4 bg-primary text-black font-bold text-[10px] tracking-widest hover:bg-primary/90 transition-opacity"
              >
                IR A TICKER
              </button>
            </div>
          )}

          {/* Loading placeholder */}
          {isEtfLoading && !etfAnalysis && (
            <div className="flex items-center gap-3 py-10 text-muted-foreground text-[11px] tracking-widest">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              RECOPILANDO DATOS DEL FONDO...
            </div>
          )}

          {/* Empty state */}
          {!etfAnalysis && !isEtfLoading && !etfError && !etfNotFund && (
            <div className="flex flex-col items-center justify-center py-28 opacity-20">
              <div className="text-5xl font-bold tracking-[0.3em] text-primary mb-3">ETF</div>
              <p className="text-[10px] tracking-[0.4em] text-muted-foreground">
                INTRODUCE UN ETF PARA GENERAR UN ANÁLISIS COMPLETO
              </p>
              <div className="mt-5 flex flex-wrap gap-2 justify-center">
                {["SPY","QQQ","GLD","TAN","IWM","XLE","ARKK"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setEtfInput(s)}
                    className="text-[9px] tracking-widest border border-border/50 px-2 py-1 hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ETF report */}
          {etfAnalysis && !etfNotFund && (
            <EtfReportView
              content={etfAnalysis}
              ticker={currentEtf}
              isLoading={isEtfLoading}
              etfDeep={etfDeep}
              activeSection={etfActiveSection}
              onSelectSection={setEtfActiveSection}
            />
          )}
          </div>

          {/* Right column — index charts */}
          <aside className="lg:w-[33%] lg:max-w-md lg:shrink-0 mt-8 lg:mt-0">
            <IndexChartsPanel marketData={marketData} />
          </aside>
        </div>
      )}

      {/* ── SECTOR tab ──────────────────────────────────────────────── */}
      {navTab === "sector" && (
        <div className="max-w-7xl mx-auto px-4 pt-5 pb-16 lg:flex lg:gap-6">
          <div className="flex-1 min-w-0">

          {/* Sector search row */}
          <div className="flex gap-2 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground/30" />
              <input
                type="text"
                value={sectorInput}
                onChange={(e) => setSectorInput(e.target.value)}
                onKeyDown={handleSectorKeyDown}
                placeholder="SECTOR — Semiconductores, Inteligencia Artificial, Energía, Salud..."
                maxLength={80}
                className="w-full h-8 pl-8 pr-3 bg-card border border-border text-foreground text-xs placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary transition-colors font-mono"
              />
            </div>
            <button
              onClick={handleSectorAnalyze}
              disabled={isSectorLoading || !sectorInput.trim()}
              className="h-8 px-5 bg-primary text-black font-bold text-[11px] tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-opacity whitespace-nowrap"
            >
              {isSectorLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : "ANALIZAR SECTOR"}
            </button>
          </div>

          {/* Error */}
          {sectorError && (
            <div className="mb-4 p-3 border border-destructive/40 bg-destructive/5 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive font-mono">{sectorError}</p>
            </div>
          )}

          {/* Loading */}
          {isSectorLoading && !sectorAnalysis && (
            <div className="flex items-center gap-3 py-10 text-muted-foreground text-[11px] tracking-widest">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ANALIZANDO SECTOR — RECOPILANDO DATOS...
            </div>
          )}

          {/* Empty state */}
          {!sectorAnalysis && !isSectorLoading && !sectorError && (
            <div className="flex flex-col items-center justify-center py-28 opacity-20">
              <div className="text-4xl font-bold tracking-[0.2em] text-primary mb-3">SECTOR</div>
              <p className="text-[10px] tracking-[0.4em] text-muted-foreground">
                INTRODUCE UN SECTOR PARA GENERAR UN ANÁLISIS COMPLETO
              </p>
              <div className="mt-5 flex flex-wrap gap-2 justify-center">
                {["Semiconductores","Inteligencia Artificial","Energía","Salud","Fintech","Defensa","Consumo"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSectorInput(s)}
                    className="text-[9px] tracking-widest border border-border/50 px-2 py-1 hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sector report */}
          {sectorAnalysis && (
            <SectorReportView
              content={sectorAnalysis}
              sectorName={currentSector}
              isLoading={isSectorLoading}
              expanded={sectorExpanded}
              onToggle={toggleSectorSection}
            />
          )}
          </div>

          {/* Right column — index charts */}
          <aside className="lg:w-[33%] lg:max-w-md lg:shrink-0 mt-8 lg:mt-0">
            <IndexChartsPanel marketData={marketData} />
          </aside>
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
                  resetSections();
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

// ── Index Charts Panel (native Recharts sparklines) ───────────────────

const PANEL_INDICES = [
  { symbol: "SPY",  label: "S&P 500" },
  { symbol: "VIXY", label: "VIX VOLATILIDAD" },
  { symbol: "IWM",  label: "RUSSELL 2000" },
  { symbol: "GLD",  label: "ORO" },
];

function IndexChartsPanel({ marketData }: { marketData: MarketData | null }) {
  return (
    <div className="lg:sticky lg:top-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span style={{
          width: 6, height: 6, background: '#3b82f6', borderRadius: '50%',
          display: 'inline-block', boxShadow: '0 0 6px #3b82f6',
        }} className="animate-pulse" />
        <span style={{ fontSize: 10, letterSpacing: '0.15em', color: '#94a3b8', fontWeight: 600 }}>
          ÍNDICES GLOBALES
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#475569', letterSpacing: '0.1em' }}>
          LIVE · FINNHUB
        </span>
      </div>
      {PANEL_INDICES.map(({ symbol, label }) => {
        const quote = marketData?.indices.find(i => i.symbol === symbol) ?? null;
        const candle = marketData?.candles?.[symbol] ?? null;
        return (
          <IndexSparkline
            key={symbol}
            label={label}
            symbol={symbol}
            price={quote?.price ?? null}
            change1d={quote?.change1d ?? null}
            change1m={quote?.change1m ?? null}
            candle={candle}
          />
        );
      })}
    </div>
  );
}

// ── Market Ticker Bar ─────────────────────────────────────────────────

function MarketTickerBar({
  data, customStocks, onChangeStocks,
}: {
  data: MarketData | null;
  customStocks: string[];
  onChangeStocks: (stocks: string[]) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [draft,   setDraft]     = useState(customStocks.join(", "));

  const fmtChange = (n: number | null, suffix = "%") =>
    n == null ? null : `${n > 0 ? "+" : ""}${n.toFixed(2)}${suffix}`;

  const cls = (n: number | null) =>
    n == null ? "text-muted-foreground/40"
    : n > 0   ? "text-primary"
    :            "text-destructive";

  const saveEdit = () => {
    const parsed = draft.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.^]{1,10}$/.test(s)).slice(0, 6);
    onChangeStocks(parsed.length ? parsed : customStocks);
    setEditing(false);
  };

  return (
    <div className="border-b border-border/50 bg-card/30">
      <div className="overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-center h-8 px-4 min-w-max gap-0">

          {/* Fixed indices */}
          {(data?.indices ?? []).map((idx) => (
            <div key={idx.symbol} className="flex items-center gap-2 pr-4 mr-4 border-r border-border/30 shrink-0">
              <span className="text-[9px] tracking-widest text-muted-foreground/45 uppercase">{idx.label}</span>
              <span className="text-[11px] tabular-nums text-foreground/80">
                {idx.price != null ? `$${idx.price.toFixed(2)}` : "—"}
              </span>
              {fmtChange(idx.change1d) && (
                <span className={`text-[10px] tabular-nums ${cls(idx.change1d)}`}>{fmtChange(idx.change1d)}</span>
              )}
              {idx.change1m != null && (
                <span className={`text-[10px] tabular-nums ${cls(idx.change1m)}`}>
                  <span className="text-muted-foreground/25">1m </span>{fmtChange(idx.change1m)}
                </span>
              )}
            </div>
          ))}

          {/* 10Y yield */}
          {data?.yield10y != null && (
            <div className="flex items-center gap-2 pr-4 mr-4 border-r border-border/30 shrink-0">
              <span className="text-[9px] tracking-widest text-muted-foreground/45">10Y</span>
              <span className={`text-[11px] tabular-nums ${data.yield10y > 5 ? "text-destructive/80" : "text-foreground/80"}`}>
                {data.yield10y.toFixed(2)}%
              </span>
            </div>
          )}

          {/* 10Y-2Y spread */}
          {data?.spread != null && (
            <div className="flex items-center gap-2 pr-4 mr-4 border-r border-border/30 shrink-0">
              <span className="text-[9px] tracking-widest text-muted-foreground/45">10Y-2Y</span>
              <span className={`text-[11px] tabular-nums ${data.spread < 0 ? "text-destructive/80" : "text-foreground/80"}`}>
                {data.spread > 0 ? "+" : ""}{data.spread}bps
              </span>
            </div>
          )}

          {/* User stocks */}
          {(data?.stocks ?? []).map((s) => (
            <div key={s.symbol} className="flex items-center gap-2 pr-4 mr-4 border-r border-border/30 shrink-0">
              <span className="text-[9px] tracking-widest text-muted-foreground/45">{s.symbol}</span>
              <span className="text-[11px] tabular-nums text-foreground/80">
                {s.price != null ? `$${s.price.toFixed(2)}` : "—"}
              </span>
              {fmtChange(s.change1d) && (
                <span className={`text-[10px] tabular-nums ${cls(s.change1d)}`}>{fmtChange(s.change1d)}</span>
              )}
            </div>
          ))}

          {!data && (
            <span className="text-[9px] text-muted-foreground/25 tracking-widest">CARGANDO...</span>
          )}

          {/* Edit stocks button */}
          <button
            onClick={() => { setDraft(customStocks.join(", ")); setEditing(e => !e); }}
            className="ml-auto pl-3 text-[9px] tracking-widest text-muted-foreground/30 hover:text-primary transition-colors shrink-0"
          >
            {editing ? "✕" : "EDITAR"}
          </button>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-border/30 bg-card/50">
          <span className="text-[9px] tracking-widest text-muted-foreground/40">STOCKS:</span>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
            placeholder="AAPL, TSLA, NVDA, AMZN..."
            className="flex-1 h-6 px-2 bg-background border border-border text-[11px] text-foreground font-mono focus:outline-none focus:border-primary"
          />
          <button onClick={saveEdit} className="text-[9px] tracking-widest text-primary hover:text-primary/80 px-2 py-1 border border-primary/30">GUARDAR</button>
        </div>
      )}
    </div>
  );
}

// ── Report View (ticker horizontal tabs) ──────────────────────────────

function ReportView({
  content, quarterlyData, quarterlyDebug, catalystCalendar, ticker, isLoading, activeSection, onSelectSection,
}: {
  content: string;
  quarterlyData: QuarterlyPeriod[];
  quarterlyDebug?: QuarterlyDebug | null;
  catalystCalendar?: CatalystCalendar | null;
  ticker: string;
  isLoading: boolean;
  activeSection: string;
  onSelectSection: (key: string) => void;
}) {
  const sections = parseSections(content, EXPECTED_TABS);
  const currentMetrics = extractCurrentMetrics(content);

  // Sections appear progressively while the report streams; a tab shows up
  // as soon as its content (or structured data) exists. Order never changes.
  const available = EXPECTED_TABS.filter((key) => {
    if (sections[key]) return true;
    if (key === "Resumen Ejecutivo" && !!ticker) return true;
    if (key === "Finanzas" && quarterlyData.length > 0) return true;
    if (key === "Opciones" && !!ticker) return true;
    if (key === "Riesgo" && !!ticker) return true;
    if (key === "Señales Técnicas" && !!ticker) return true;
    return false;
  });

  const active = available.includes(activeSection) ? activeSection : available[0];

  return (
    <div>
      {/* Ticker header strip */}
      {ticker && (
        <div className="flex items-center gap-4 px-4 py-3 border border-border bg-card mb-3">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <span className="text-base font-bold text-primary tracking-[0.15em]">{ticker}</span>
          <span className="text-[10px] text-muted-foreground/40 tracking-widest">INFORME DE ANÁLISIS FINANCIERO</span>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 ml-auto" />}
        </div>
      )}

      {available.length > 0 && (
        <>
          {/* Horizontal scrollable tab bar (mobile: swipe sideways) */}
          <div className="border border-border bg-card overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <div className="flex min-w-max">
              {available.map((key) => {
                const cfg = SECTION_CONFIG[key];
                const isActive = key === active;
                return (
                  <button
                    key={key}
                    onClick={() => onSelectSection(key)}
                    className={`px-4 py-2.5 text-[11px] tracking-widest whitespace-nowrap shrink-0 border-b-2 transition-colors font-semibold ${
                      isActive
                        ? "text-primary border-primary bg-secondary/30"
                        : "text-muted-foreground/55 border-transparent hover:text-foreground"
                    }`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active section content */}
          {active && (
            <div className="border border-border border-t-0 px-4 pt-3 pb-5 analysis-content">
              {active === "Resumen Ejecutivo" && <InstrumentPriceChart ticker={ticker} />}
              {active === "Finanzas" && (
                <>
                  <QuarterlyHistorySection data={quarterlyData} debug={quarterlyDebug} currentMetrics={currentMetrics} isLoading={isLoading} />
                  <CatalystCalendarSection data={catalystCalendar ?? null} />
                </>
              )}
              {active === "Opciones" && <OptionsSubSection ticker={ticker} />}
              {active === "Riesgo" && <RiskSubSection ticker={ticker} />}
              {active === "Señales Técnicas" && <TechnicalSubSection ticker={ticker} />}
              {sections[active] && renderElements(sections[active])}
              {isLoading && (
                <span className="terminal-cursor text-primary ml-1" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── ETF Report View (apartado ETF — horizontal tabs) ───────────────────

function EtfReportView({
  content, ticker, isLoading, etfDeep, activeSection, onSelectSection,
}: {
  content: string;
  ticker: string;
  isLoading: boolean;
  etfDeep: EtfResponse | null;
  activeSection: string;
  onSelectSection: (key: string) => void;
}) {
  const sections = parseSections(content, ETF_TABS);

  const available = ETF_TABS.filter((key) => {
    if (sections[key]) return true;
    if (key === "Resumen Ejecutivo" && !!ticker) return true;
    if (key === "ETF" && etfDeep?.found === true) return true;
    if (key === "Opciones" && !!ticker) return true;
    if (key === "Riesgo" && !!ticker) return true;
    if (key === "Señales Técnicas" && !!ticker) return true;
    return false;
  });

  const active = available.includes(activeSection) ? activeSection : available[0];

  return (
    <div>
      {/* ETF header strip */}
      {ticker && (
        <div className="flex items-center gap-4 px-4 py-3 border border-border bg-card mb-3">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <span className="text-base font-bold text-primary tracking-[0.15em]">{ticker}</span>
          <span className="text-[10px] text-muted-foreground/40 tracking-widest">ANÁLISIS DE ETF</span>
          {etfDeep?.name && (
            <span className="text-[10px] text-muted-foreground/55 truncate hidden sm:block">{etfDeep.name}</span>
          )}
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 ml-auto" />}
        </div>
      )}

      {available.length > 0 && (
        <>
          {/* Horizontal scrollable tab bar */}
          <div className="border border-border bg-card overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <div className="flex min-w-max">
              {available.map((key) => {
                const cfg = ETF_SECTION_CONFIG[key];
                const isActive = key === active;
                return (
                  <button
                    key={key}
                    onClick={() => onSelectSection(key)}
                    className={`px-4 py-2.5 text-[11px] tracking-widest whitespace-nowrap shrink-0 border-b-2 transition-colors font-semibold ${
                      isActive
                        ? "text-primary border-primary bg-secondary/30"
                        : "text-muted-foreground/55 border-transparent hover:text-foreground"
                    }`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active section content */}
          {active && (
            <div className="border border-border border-t-0 px-4 pt-3 pb-5 analysis-content">
              {active === "Resumen Ejecutivo" && <InstrumentPriceChart ticker={ticker} />}
              {active === "ETF" && etfDeep?.found === true && <EtfSubSection data={etfDeep} />}
              {active === "Opciones" && <OptionsSubSection ticker={ticker} />}
              {active === "Riesgo" && <RiskSubSection ticker={ticker} />}
              {active === "Señales Técnicas" && <TechnicalSubSection ticker={ticker} />}
              {sections[active] && renderElements(sections[active])}
              {isLoading && (
                <span className="terminal-cursor text-primary ml-1" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sector Report View ─────────────────────────────────────────────────

function SectorReportView({
  content, sectorName, isLoading, expanded, onToggle,
}: {
  content: string;
  sectorName: string;
  isLoading: boolean;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const sections = parseSections(content, SECTOR_TABS);

  return (
    <div className="space-y-px">
      {/* Sector header strip */}
      {sectorName && (
        <div className="flex items-center gap-4 px-4 py-3 border border-border bg-card mb-3">
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
          <span className="text-base font-bold text-primary tracking-[0.15em]">{sectorName.toUpperCase()}</span>
          <span className="text-[10px] text-muted-foreground/40 tracking-widest">ANÁLISIS SECTORIAL COMPLETO</span>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 ml-auto" />}
        </div>
      )}

      {SECTOR_TABS.map((key) => {
        const cfg = SECTOR_SECTION_CONFIG[key];
        const sectionNodes = sections[key];
        if (!sectionNodes) return null;

        const isOpen = expanded[key] !== false;
        const isLast = key === SECTOR_TABS[SECTOR_TABS.length - 1];

        return (
          <div key={key} className="border border-border">
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

            {isOpen && (
              <div className="px-4 pt-3 pb-5 border-t border-border/50 analysis-content">
                {sectionNodes && renderElements(sectionNodes)}
                {isLoading && isLast && (
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

// ── Quarterly history (Alpha-style, multi-source) ──────────────────────

type QTab = "valuation" | "income" | "cashflow" | "balance" | "margins" | "growth";

function QuarterlyHistorySection({
  data, debug, currentMetrics = [], isLoading = false,
}: {
  data: QuarterlyPeriod[];
  debug?: QuarterlyDebug | null;
  currentMetrics?: { label: string; value: string }[];
  isLoading?: boolean;
}) {
  const [tab, setTab] = useState<QTab>("income");

  // Loading state: backend not yet returned the quarterly event
  if (isLoading && !data.length && !debug) {
    return (
      <div className="mb-6 border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-secondary/50 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 bg-primary shrink-0 animate-pulse" />
            <span className="text-[11px] tracking-[0.2em] text-foreground font-bold">HISTORICAL FINANCIALS</span>
            <span className="text-[10px] text-muted-foreground/40 tracking-widest">QUARTERLY</span>
          </div>
        </div>
        <div className="px-5 py-6 text-center">
          <div className="text-[10px] tracking-widest text-muted-foreground/50">CARGANDO DATOS TRIMESTRALES...</div>
        </div>
      </div>
    );
  }

  if (!data.length && !currentMetrics.length) {
    let diagnostic = "Esperando datos del backend...";
    if (debug) {
      const problems: string[] = [];
      if ((debug.yahooRows ?? 0) === 0)               problems.push("YAHOO: 0 filas (ticker no cubierto)");
      if (!debug.hasFinnhub)                          problems.push("FINNHUB no configurada");
      if (!debug.hasFmp)                              problems.push("FMP no configurada");
      if (debug.hasTwelveData === false)              problems.push("TWELVE DATA no configurada");
      if (debug.hasTavily     === false)              problems.push("TAVILY no configurada (fallback IA)");
      if (debug.hasFinnhub && debug.finnhubRows === 0)    problems.push("FINNHUB: 0 filas (plan free no incluye /stock/financials)");
      if (debug.hasFmp     && debug.fmpRows     === 0)    problems.push("FMP: 0 filas (ticker no cubierto)");
      if (debug.hasTwelveData && (debug.twelveDataRows ?? 0) === 0) problems.push("TWELVE DATA: 0 filas (ticker no cubierto)");
      if (debug.hasTavily && (debug.aiFallbackRows ?? 0) === 0)     problems.push("Fallback IA no encontró datos");
      diagnostic = problems.length
        ? problems.join(" · ")
        : `Backend respondió pero con 0 trimestres`;
    }
    return (
      <div className="mb-6 border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-secondary/50 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 bg-primary shrink-0" />
            <span className="text-[11px] tracking-[0.2em] text-foreground font-bold">HISTORICAL FINANCIALS</span>
            <span className="text-[10px] text-muted-foreground/40 tracking-widest">QUARTERLY</span>
          </div>
        </div>
        <div className="px-5 py-6 text-center">
          <div className="text-[10px] tracking-widest text-muted-foreground/50 mb-2">DATOS TRIMESTRALES NO DISPONIBLES</div>
          <div className="text-[10px] tracking-wider text-muted-foreground/35">{diagnostic}</div>
        </div>
      </div>
    );
  }

  const incomeData   = buildIncomeChartData(data);
  const cashFlowData = buildCashFlowChartData(data);
  const balanceData  = buildBalanceChartData(data);
  const marginsData  = buildMarginsChartData(data);
  const growthData   = buildGrowthChartData(data);

  const isValuationTab = tab === "valuation";

  const TABS = [
    { id: "valuation" as QTab, label: "Valoración" },
    { id: "income"    as QTab, label: "P&L" },
    { id: "cashflow"  as QTab, label: "Cash Flow" },
    { id: "balance"   as QTab, label: "Balance" },
    { id: "margins"   as QTab, label: "Márgenes" },
    { id: "growth"    as QTab, label: "Crecimiento" },
  ];

  const chartFor = (t: QTab): { rows: { data: any[]; render: () => JSX.Element } | null; emptyMsg: string } => {
    if (t === "income") {
      return incomeData.length > 0
        ? { rows: { data: incomeData, render: () => <IncomeChart data={incomeData} /> }, emptyMsg: "" }
        : { rows: null, emptyMsg: "Sin datos de P&L disponibles." };
    }
    if (t === "cashflow") {
      return cashFlowData.length > 0
        ? { rows: { data: cashFlowData, render: () => <CashFlowChart data={cashFlowData} /> }, emptyMsg: "" }
        : { rows: null, emptyMsg: "Sin datos de Cash Flow disponibles." };
    }
    if (t === "balance") {
      return balanceData.length > 0
        ? { rows: { data: balanceData, render: () => <BalanceChart data={balanceData} /> }, emptyMsg: "" }
        : { rows: null, emptyMsg: "Sin datos de Balance Sheet disponibles." };
    }
    if (t === "margins") {
      return marginsData.length > 0
        ? { rows: { data: marginsData, render: () => <MarginsChart data={marginsData} /> }, emptyMsg: "" }
        : { rows: null, emptyMsg: "Sin datos de márgenes disponibles." };
    }
    if (t === "growth") {
      return growthData.length > 0
        ? { rows: { data: growthData, render: () => <GrowthChart data={growthData} /> }, emptyMsg: "" }
        : { rows: null, emptyMsg: "Sin datos de crecimiento disponibles." };
    }
    return { rows: null, emptyMsg: "" };
  };

  const activeChart = !isValuationTab ? chartFor(tab) : null;

  return (
    <div className="mb-6 border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-secondary/50 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 bg-primary shrink-0" />
          <span className="text-[11px] tracking-[0.2em] text-foreground font-bold">HISTORICAL FINANCIALS</span>
          <span className="text-[10px] text-muted-foreground/40 tracking-widest">QUARTERLY</span>
        </div>
        <span className="text-[10px] tracking-widest text-muted-foreground/30">{data.length}Q · YAHOO + FMP + TWELVE DATA + FINNHUB + AI</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[11px] tracking-wider transition-colors border-b-2 whitespace-nowrap shrink-0 ${
              tab === t.id
                ? "text-primary border-primary"
                : "text-muted-foreground/50 border-transparent hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Valoración tab: point-in-time metrics ── */}
      {isValuationTab && (
        <div className="overflow-x-auto" style={{ scrollbarWidth: "auto", scrollbarColor: "hsl(var(--primary) / 0.5) hsl(var(--background))" }}>
          <table className="w-full" style={{ minWidth: 320 }}>
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="px-4 py-3 text-left text-[11px] tracking-widest text-muted-foreground/40 font-medium sticky left-0 bg-secondary/20 z-10"
                    style={{ minWidth: 200 }}>
                  MÉTRICA
                </th>
                <th className="px-3 py-3 text-right text-[11px] tracking-widest text-primary font-semibold whitespace-nowrap"
                    style={{ minWidth: 140 }}>
                  VALOR ACTUAL
                </th>
              </tr>
            </thead>
            <tbody>
              {currentMetrics.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-[10px] tracking-widest text-muted-foreground/30">
                    MÉTRICAS DE VALORACIÓN NO DISPONIBLES
                  </td>
                </tr>
              )}
              {currentMetrics.map((m) => {
                const v = cleanVal(m.value);
                return (
                  <tr key={m.label} className="border-b border-border/20 hover:bg-primary/3 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-foreground/90 font-medium whitespace-nowrap sticky left-0 bg-card z-10 border-r border-border/20">
                      {m.label}
                    </td>
                    <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap text-[14px] ${v === "—" ? "text-muted-foreground/20" : "text-primary font-semibold"}`}>
                      {v === "—" ? <span className="text-muted-foreground/20">—</span> : v}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Quarterly chart tabs ── */}
      {!isValuationTab && (
        <div className="p-3 bg-card">
          {activeChart?.rows ? (
            <>
              {activeChart.rows.render()}
              <div className="mt-2 px-1 text-[9px] tracking-widest text-muted-foreground/30">
                {activeChart.rows.data.length}Q · ordenado de antiguo (izquierda) a reciente (derecha) · valores faltantes omitidos
              </div>
            </>
          ) : (
            <div className="px-5 py-10 text-center text-[10px] tracking-widest text-muted-foreground/40">
              {activeChart?.emptyMsg ?? "Sin datos disponibles."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Catalyst Calendar ─────────────────────────────────────────────────

function CatalystCalendarSection({ data }: { data: CatalystCalendar | null }) {
  if (!data || (data.earnings.length === 0 && data.dividends.length === 0)) return null;

  return (
    <div className="mb-4 border border-border overflow-hidden">
      <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-primary shrink-0" />
        <span className="text-[11px] tracking-[0.2em] text-foreground font-bold">CATALYST CALENDAR</span>
        <span className="text-[10px] text-muted-foreground/40 tracking-widest ml-auto">FMP</span>
      </div>

      <div className="divide-y divide-border/30">
        {data.earnings.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-[9px] tracking-widest text-muted-foreground/45 mb-2.5">PRÓXIMOS EARNINGS</div>
            <div className="space-y-1.5">
              {data.earnings.map((e, i) => (
                <div key={i} className="flex items-center gap-4 flex-wrap">
                  <span className="text-[12px] text-primary font-mono tabular-nums font-semibold">{e.date}</span>
                  {e.epsEstimate && (
                    <span className="text-[11px] text-muted-foreground/60">
                      EPS est. <span className="text-foreground/80">{e.epsEstimate}</span>
                    </span>
                  )}
                  {e.revenueEstimate && (
                    <span className="text-[11px] text-muted-foreground/60">
                      Rev est. <span className="text-foreground/80">{e.revenueEstimate}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.dividends.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-[9px] tracking-widest text-muted-foreground/45 mb-2.5">EX-DIVIDEND DATES</div>
            <div className="space-y-1.5">
              {data.dividends.map((d, i) => (
                <div key={i} className="flex items-center gap-4 flex-wrap">
                  <span className="text-[12px] text-primary font-mono tabular-nums font-semibold">{d.exDate}</span>
                  {d.amount && (
                    <span className="text-[11px] text-foreground/80">{d.amount}/share</span>
                  )}
                  {d.frequency && (
                    <span className="text-[10px] text-muted-foreground/40">{d.frequency}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Markdown parser ────────────────────────────────────────────────────

// Normalize section names so Gemini drift ("Resumen ejecutivo", "Resumen Ejecutivo.",
// "##  Resumen Ejecutivo") still matches the canonical EXPECTED_TABS entry.
function normalizeSectionName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseSections(content: string, knownTabs: string[]): Record<string, React.ReactNode[]> {
  const lines = content.split("\n");
  const sections: Record<string, React.ReactNode[]> = {};
  // Map of normalized -> canonical name from knownTabs
  const canonicalByNorm = new Map<string, string>(
    knownTabs.map(t => [normalizeSectionName(t), t])
  );
  let currentSection = knownTabs[0] ?? "Section";
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
      const raw = line.replace(/^##\s+/, "").replace(/[:.]+\s*$/, "").trim();
      const norm = normalizeSectionName(raw);
      currentSection = canonicalByNorm.get(norm) ?? raw;
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
      currentElements.push(<h3 key={i}>{line.slice(4)}</h3>);
    } else if (line.startsWith("#### ")) {
      currentElements.push(<h4 key={i}>{line.slice(5)}</h4>);
    } else if (line.match(/^---+$/)) {
      currentElements.push(<hr key={i} />);
    } else if (line.match(/^[-*] /)) {
      const text = line.slice(2);
      // Risk bullets: the textual "Nivel/Severidad: **ALTO**" label is
      // stripped from the copy — the (larger) coloured dot alone encodes the
      // level; tooltip + aria-label keep it accessible.
      const level = extractRiskLevel(text);
      const display = level ? stripRiskLabel(text) : text;
      const { icon, cls } = level
        ? { icon: "●", cls: `${RISK_DOT_CLS[level]} text-[15px]` }
        : getBulletIcon(text);
      currentElements.push(
        <li key={i} className="ml-1 mb-6 list-none flex items-start gap-2.5">
          <span
            className={`select-none shrink-0 leading-none ${cls}`}
            style={{ marginTop: level ? "1px" : "3px" }}
            title={level ? `Nivel de riesgo: ${level}` : undefined}
            aria-label={level ? `Nivel de riesgo: ${level}` : undefined}
            role={level ? "img" : undefined}
          >{icon}</span>
          <span className="flex-1 text-foreground/75 leading-relaxed" style={{ fontFamily: "var(--font-sans)", fontSize: "15px" }}>
            {renderInline(display)}
          </span>
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      const m = line.match(/^(\d+)\. (.*)$/);
      if (m) {
        currentElements.push(
          <li key={i} className="ml-4 mb-3 list-decimal text-muted-foreground marker:text-primary marker:font-semibold text-xs">
            <span className="text-foreground/75" style={{ fontFamily: "var(--font-sans)" }}>{renderInline(m[2])}</span>
          </li>
        );
      }
    } else if (line.startsWith("> ")) {
      currentElements.push(<blockquote key={i}>{line.slice(2)}</blockquote>);
    } else if (line.trim() === "") {
      currentElements.push(<div key={i} className="h-2" />);
    } else {
      currentElements.push(<p key={i}>{renderInline(line)}</p>);
    }

    i++;
  }

  flush();

  // Keep a section if it has ANY non-spacer content. Tables are wrapped in <div> (so
  // a naïve "type !== div" check incorrectly drops table-only sections like Sector's
  // Tabla Comparativa or Empresas Líderes). We treat only the empty-line spacer divs
  // (rendered with className="h-2") as ignorable.
  const cleaned: Record<string, React.ReactNode[]> = {};
  for (const [k, els] of Object.entries(sections)) {
    const hasSubstance = els.some((el) => {
      if (el === null || typeof el !== "object") return false;
      const reactEl = el as { type?: unknown; props?: { className?: string } };
      if (reactEl.type === "div" && reactEl.props?.className === "h-2") return false;
      return true;
    });
    if (hasSubstance) cleaned[k] = els;
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

  // Skip the "Métrica | Valor" table — it's rendered inside the unified Historical Financials table
  if (headerCells.length === 2 && /^Métrica$/i.test(headerCells[0]) && /^Valor$/i.test(headerCells[1])) {
    return null;
  }
  const isSep = (line: string) => /^\|?[\s\-:|]+\|?$/.test(line);
  const startData = isSep(tableLines[1]) ? 2 : 1;
  const ND_VALS = new Set(["N/D", "N/A", "—", "-", ""]);

  const dataRows = tableLines.slice(startData).filter((l) => {
    if (isSep(l)) return false;
    const cells = parseRow(l);
    return cells.slice(1).some((c) => {
      const v = c.replace(/^\*+|\*+$/g, "").trim();
      return v && !ND_VALS.has(v);
    });
  });

  if (!dataRows.length) return null;

  return (
    <div key={`tbl-${baseKey}`} className="my-4 overflow-x-auto border border-border">
      <table className="w-full font-mono min-w-max" style={{ fontSize: "13px" }}>
        <thead>
          <tr className="border-b border-border bg-secondary/50">
            {headerCells.map((cell, j) => (
              <th
                key={j}
                className="px-3 py-2.5 text-left text-[11px] tracking-widest text-muted-foreground/60 font-medium uppercase"
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
                  const isNDVal = ND_VALS.has(val);
                  const isNum   = /^[-+$]?\d/.test(val) || val.includes("%") || val.includes("x");
                  const isNeg   = /^-/.test(val) && !isNDVal;

                  let cls = j === 0 ? "text-foreground/80 font-medium" : "text-foreground/65";
                  if (isNum && !isNeg) cls = "text-primary font-mono";
                  if (isNeg)          cls = "text-destructive font-mono";
                  if (isNDVal)        cls = "text-muted-foreground/20";

                  return (
                    <td key={j} className={`px-3 py-2.5 whitespace-nowrap ${cls}`}>
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

// ── Risk-level extraction (B3: dot encodes the level, no text label) ───

type RiskLevel = "ALTO" | "MEDIO" | "BAJO";

const RISK_DOT_CLS: Record<RiskLevel, string> = {
  ALTO:  "text-destructive",
  MEDIO: "text-amber-400",
  BAJO:  "text-primary",
};

const RISK_LABEL_RE = /\s*[.,;:·—-]*\s*(?:Nivel|Severidad)\s*:?\s*\*\*\s*(ALTO|ALTA|MEDIO|MEDIA|BAJO|BAJA)\s*\*\*\s*\.?/gi;

function extractRiskLevel(text: string): RiskLevel | null {
  const m = /(?:Nivel|Severidad)\s*:?\s*\*\*\s*(ALTO|ALTA|MEDIO|MEDIA|BAJO|BAJA)\s*\*\*/i.exec(text);
  if (!m) return null;
  const raw = m[1].toUpperCase();
  if (raw === "ALTO" || raw === "ALTA") return "ALTO";
  if (raw === "MEDIO" || raw === "MEDIA") return "MEDIO";
  return "BAJO";
}

function stripRiskLabel(text: string): string {
  return text.replace(RISK_LABEL_RE, "").trim();
}

// ── Sentiment detection for bullet icons ──────────────────────────────

function getBulletIcon(text: string): { icon: string; cls: string } {
  const upper = text.toUpperCase();
  const isNeg = /\*\*(ALTO|HIGH|BEARISH|BAJISTA|SOBRECOMPRADO)\*\*/.test(text) ||
                /\bALTO\b/.test(upper) || /\bBEARISH\b/.test(upper) || /\bBAJISTA\b/.test(upper);
  const isPos = /\*\*(BAJO|LOW|BULLISH|ALCISTA|SOBREVENTA)\*\*/.test(text) ||
                /\bBAJO\b/.test(upper) || /\bBULLISH\b/.test(upper) || /\bALCISTA\b/.test(upper);
  const isNeu = /\*\*(MEDIO|NEUTRO|NEUTRAL|MIXTO)\*\*/.test(text) ||
                /\bMEDIO\b/.test(upper) || /\bNEUTRO\b/.test(upper);

  if (isNeg) return { icon: "●", cls: "text-destructive text-[9px]" };
  if (isPos) return { icon: "●", cls: "text-primary text-[9px]" };
  if (isNeu) return { icon: "●", cls: "text-amber-400 text-[9px]" };
  return { icon: "▸", cls: "text-primary/50 text-[10px]" };
}

const RISK_RED = new Set(["ALTO","HIGH","BEARISH","BAJISTA","SOBRECOMPRADO"]);
const RISK_AMB = new Set(["MEDIO","MEDIUM","NEUTRO","NEUTRAL","MIXTO"]);
const RISK_GRN = new Set(["BAJO","LOW","BULLISH","ALCISTA","SOBREVENTA"]);

function boldClass(inner: string): string {
  const u = inner.toUpperCase().trim();
  if (RISK_RED.has(u)) return "font-semibold text-destructive";
  if (RISK_AMB.has(u)) return "font-semibold text-amber-400";
  if (RISK_GRN.has(u)) return "font-semibold text-primary";
  return "font-semibold text-foreground";
}

function renderInline(text: string): React.ReactNode {
  const withLinks = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return withLinks.map((seg, si) => {
    const linkMatch = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={si} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
           className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">
          {linkMatch[1]}
        </a>
      );
    }
    const parts = seg.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        const inner = part.slice(2, -2);
        return <strong key={`${si}-${i}`} className={boldClass(inner)}>{inner}</strong>;
      }
      const codeParts = part.split(/(`[^`]+`)/g);
      return codeParts.map((cp, j) => {
        if (cp.startsWith("`") && cp.endsWith("`")) {
          return (
            <code key={`${si}-${i}-${j}`} className="bg-primary/10 text-primary px-1 py-0.5 text-xs">
              {cp.slice(1, -1)}
            </code>
          );
        }
        return <span key={`${si}-${i}-${j}`}>{cp}</span>;
      });
    });
  });
}

export default Index;
