import { useState, useRef, useCallback } from "react";
import { TrendingUp, AlertCircle, Loader2, Download, BarChart2 } from "lucide-react";
import { streamAnalysis, type QuarterlyPeriod } from "@/lib/analyze";
import { useToast } from "@/hooks/use-toast";
import { downloadAnalysisPdf } from "@/lib/reportPdf";

const EXPECTED_TABS = [
  "Resumen Ejecutivo",
  "Finanzas",
  "Valoración",
  "Competidores",
  "Noticias",
  "Institucional",
];

// ── Helpers ───────────────────────────────────────────────────────────

/** "2024-09-30" → "Sep '24" */
function fmtPeriod(p: string): string {
  const d = new Date(p + "T00:00:00Z");
  if (isNaN(d.getTime())) return p;
  return d.toLocaleDateString("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function isPositive(v: string) { return v.startsWith("+"); }
function isNegative(v: string) { return v.startsWith("-") && v !== "N/D"; }
function isND(v: string) { return v === "N/D"; }

function cellClass(v: string, colorize = false) {
  if (isND(v)) return "text-muted-foreground/40";
  if (!colorize) return "text-foreground/85 font-mono";
  if (isPositive(v)) return "text-emerald-400 font-mono font-medium";
  if (isNegative(v)) return "text-red-400 font-mono font-medium";
  return "text-foreground/85 font-mono";
}

// ── Index component ───────────────────────────────────────────────────

const Index = () => {
  const [ticker, setTicker] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentTicker, setCurrentTicker] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("Resumen Ejecutivo");
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyPeriod[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

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
    setActiveTab("Resumen Ejecutivo");
    setQuarterlyData([]);

    let accumulated = "";

    try {
      await streamAnalysis({
        ticker: clean,
        signal: controller.signal,
        onDelta: (chunk) => {
          accumulated += chunk;
          setAnalysis(accumulated);
        },
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) handleAnalyze();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      <header className="border-b border-border/60 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BarChart2 className="h-5 w-5 text-primary" />
            <span className="font-heading text-base font-semibold text-foreground tracking-tight">
              Análisis Financiero
            </span>
            <span className="text-xs text-muted-foreground/60 hidden sm:inline">— Research institucional</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-primary/60 hidden sm:inline-block">
              Datos en tiempo real
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 flex flex-col">
        <div className="mb-6 bg-secondary/20 p-4 border border-border/40 rounded-lg">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                placeholder="Introduce un ticker (ej. AAPL, MSFT, NVDA)..."
                maxLength={20}
                className="w-full h-11 px-4 bg-card border border-border/60 rounded-md text-foreground font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isLoading || !ticker.trim()}
              className="h-11 px-7 bg-primary text-primary-foreground font-heading text-sm font-semibold rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analizando...
                </>
              ) : (
                "Analizar"
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/50 rounded-lg flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {(analysis || isLoading) && (
          <div className="flex-1 flex flex-col border border-border/40 rounded-xl bg-card shadow-xl overflow-hidden min-h-[600px]">
            <div className="px-5 py-3 border-b border-border/40 flex flex-wrap items-center justify-between bg-secondary/10 min-h-[48px]">
              <div className="flex items-center gap-3">
                <div className={`h-2 w-2 rounded-full ${isLoading ? "bg-primary animate-pulse" : "bg-primary"}`} />
                <span className="font-mono text-sm font-semibold text-primary tracking-wide">
                  {currentTicker}
                </span>
                <span className="text-xs text-muted-foreground">Informe de análisis</span>
              </div>
              <div className="flex items-center gap-4">
                {isLoading && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    Generando informe...
                  </span>
                )}
                {!isLoading && analysis && (
                  <button
                    onClick={() => downloadAnalysisPdf(analysis, currentTicker)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/70 transition-colors font-mono border border-primary/30 px-3 py-1.5 rounded-md"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exportar PDF
                  </button>
                )}
              </div>
            </div>
            
            <AnalysisTabsRenderer
              content={analysis}
              isLoading={isLoading}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              quarterlyData={quarterlyData}
            />
          </div>
        )}

        {!analysis && !isLoading && !error && (
          <div className="text-center py-32 flex-1 flex flex-col justify-center items-center opacity-40">
            <div className="mb-6 p-6 rounded-2xl border border-primary/20 bg-primary/5">
              <TrendingUp className="text-primary h-10 w-10" />
            </div>
            <p className="text-foreground font-semibold text-lg mb-2">
              Análisis de empresas cotizadas
            </p>
            <p className="text-muted-foreground text-sm">
              Introduce un ticker para obtener un informe financiero completo
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

// ── Improved Tabbed Markdown Renderer ──────────────────────────────────────────

function AnalysisTabsRenderer({
  content, isLoading, activeTab, setActiveTab, quarterlyData,
}: {
  content: string;
  isLoading: boolean;
  activeTab: string;
  setActiveTab: (t: string) => void;
  quarterlyData: QuarterlyPeriod[];
}) {
  const sections = parseSections(content);
  const computedTabs = Object.keys(sections);

  if (computedTabs.length === 0) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span>Recopilando datos...</span>
      </div>
    );
  }

  const displayTab = sections[activeTab] ? activeTab : computedTabs[0];
  const currentTabContent = sections[displayTab] || [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab Navigation */}
      <div className="flex border-b border-border/40 bg-secondary/10 overflow-x-auto overflow-y-hidden shrink-0">
        {EXPECTED_TABS.map((expectedTab) => {
          const hasContent = !!sections[expectedTab] || (expectedTab === "Finanzas" && quarterlyData.length > 0);
          const isActive = displayTab === expectedTab;
          return (
            <button
              key={expectedTab}
              onClick={() => hasContent && setActiveTab(expectedTab)}
              disabled={!hasContent && !isLoading}
              className={`
                px-5 py-2.5 text-xs font-medium whitespace-nowrap transition-all
                border-r border-border/30 select-none outline-none
                ${isActive
                  ? "bg-background text-primary border-b-2 border-b-primary"
                  : "text-muted-foreground border-b-2 border-b-transparent hover:text-foreground hover:bg-background/50"}
                ${!hasContent ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {expectedTab}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 analysis-content text-sm text-foreground/90 leading-relaxed overflow-y-auto">
        {/* Quarterly component injected at top of Finanzas tab */}
        {displayTab === "Finanzas" && quarterlyData.length > 0 && (
          <QuarterlyHistorySection data={quarterlyData} />
        )}
        {renderElements(currentTabContent)}
        {isLoading && displayTab === computedTabs[computedTabs.length - 1] && <span className="terminal-cursor text-primary ml-1" />}
      </div>
    </div>
  );
}

// ── Quarterly History Component ────────────────────────────────────────

const ND_VALUES = new Set(["N/D", "", "N/A", "-"]);

function cleanVal(v: string): string {
  if (ND_VALUES.has(v)) return "—";
  // Round floats with 3+ decimal places to 2
  return v.replace(/(-?\d+\.\d{3,})/g, (m) => {
    const n = parseFloat(m); return isNaN(n) ? m : n.toFixed(2);
  });
}

function allND(values: string[]) {
  return values.every((v) => ND_VALUES.has(v));
}

function QTable({ title, rows, periods }: {
  title: string;
  periods: string[];
  rows: { label: string; values: string[]; colorize?: boolean }[];
}) {
  // Only keep rows that have at least one real value
  const visibleRows = rows.filter((r) => !allND(r.values));
  if (!visibleRows.length) return null;

  return (
    <div className="mb-5">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-border/30 bg-secondary/10">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="border-b border-border/30 bg-secondary/20">
              <th className="px-4 py-2 text-left text-muted-foreground/60 font-medium w-36 text-[11px]">Métrica</th>
              {periods.map((p, i) => (
                <th key={i} className="px-4 py-2 text-center text-primary/80 font-semibold text-[11px] uppercase tracking-wide">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {visibleRows.map((row) => {
              const cleaned = row.values.map(cleanVal);
              return (
                <tr key={row.label} className="hover:bg-primary/5 transition-colors">
                  <td className="px-4 py-2 text-muted-foreground font-medium whitespace-nowrap border-r border-border/20 text-[11px]">
                    {row.label}
                  </td>
                  {cleaned.map((v, i) => (
                    <td key={i} className={`px-4 py-2 text-center whitespace-nowrap ${cellClass(v, row.colorize)}`}>
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
  const col = (field: keyof QuarterlyPeriod) => data.map((q) => q[field] as string);

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-primary border-b border-primary/15 pb-1.5 mb-4 tracking-wide">
        Evolución Trimestral
      </h3>

      <QTable
        title="Cuenta de Resultados"
        periods={periods}
        rows={[
          { label: "Ingresos",      values: col("revenue") },
          { label: "Var. YoY",      values: col("revenueGrowth"), colorize: true },
          { label: "Margen Bruto",  values: col("grossMargin"),   colorize: true },
          { label: "EBITDA",        values: col("ebitda") },
          { label: "Bfº Neto",      values: col("netIncome") },
          { label: "Margen Neto",   values: col("netMargin"),     colorize: true },
          { label: "EPS",           values: col("eps") },
        ]}
      />

      <QTable
        title="Cash Flow"
        periods={periods}
        rows={[
          { label: "CF Operativo",  values: col("operatingCF") },
          { label: "Free Cash Flow",values: col("freeCashFlow") },
          { label: "Capex",         values: col("capex") },
        ]}
      />

      <QTable
        title="Balance / Solvencia"
        periods={periods}
        rows={[
          { label: "Caja",          values: col("cash") },
          { label: "Deuda Total",   values: col("totalDebt") },
          { label: "Deuda Neta",    values: col("netDebt") },
          { label: "Equity",        values: col("equity") },
          { label: "Total Activos", values: col("totalAssets") },
        ]}
      />
    </div>
  );
}

// Parse markdown into grouped sections.
function parseSections(content: string): Record<string, React.ReactNode[]> {
  const lines = content.split("\n");
  const sections: Record<string, React.ReactNode[]> = {};
  
  let currentSection = "Resumen Ejecutivo"; // default fallback for first lines
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

    // Detect new tab header
    if (line.startsWith("## ")) {
      flush();
      currentSection = line.slice(3).trim();
      i++;
      continue;
    }

    // Parse elements within section
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
        <h3 key={i} className="text-sm font-semibold mb-2 mt-6 text-primary border-b border-primary/15 pb-1.5 tracking-wide">
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("#### ")) {
      currentElements.push(
        <h4 key={i} className="text-xs font-semibold mb-1.5 mt-4 text-muted-foreground uppercase tracking-wider">
          {line.slice(5)}
        </h4>
      );
    } else if (line.match(/^---+$/)) {
      currentElements.push(<hr key={i} className="my-4 border-border/40" />);
    } else if (line.match(/^[-*] /)) {
      currentElements.push(
        <li key={i} className="ml-1 mb-2 list-none flex items-start">
          <span className="text-primary/60 mr-2.5 mt-1 text-xs select-none">●</span>
          <span className="flex-1 text-foreground/85">{renderInline(line.slice(2))}</span>
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      const match = line.match(/^(\d+)\. (.*)$/);
      if (match) {
        currentElements.push(
          <li key={i} className="ml-5 mb-2 list-decimal text-muted-foreground marker:text-primary marker:font-semibold">
            <span className="text-foreground/85">{renderInline(match[2])}</span>
          </li>
        );
      }
    } else if (line.startsWith("> ")) {
      currentElements.push(
        <blockquote key={i} className="border-l-3 border-primary/40 pl-4 py-1 my-3 text-muted-foreground italic bg-primary/5 rounded-r">
          {line.slice(2)}
        </blockquote>
      );
    } else if (line.trim() === "") {
      currentElements.push(<div key={i} className="h-2" />);
    } else {
      currentElements.push(
        <p key={i} className="mb-2.5 text-foreground/85 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }

    i++;
  }

  flush(); // save last section

  // Clean empty sections to prevent empty tabs
  const cleaned: Record<string, React.ReactNode[]> = {};
  for (const [key, els] of Object.entries(sections)) {
    if (els.some(el => el !== null && typeof el !== 'undefined' && (el as any).type !== 'div')) {
      cleaned[key] = els;
    }
  }

  return cleaned;
}

function renderElements(elements: React.ReactNode[]) {
  return <div className="space-y-1">{elements}</div>;
}

function renderTable(tableLines: string[], baseKey: number) {
  if (tableLines.length < 2) return null;

  const parseRow = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headerCells = parseRow(tableLines[0]);

  // Check if second line is separator
  const isSeparator = (line: string) => /^\|?[\s-:|]+\|?$/.test(line);
  const startDataIndex = isSeparator(tableLines[1]) ? 2 : 1;

  const dataRows = tableLines.slice(startDataIndex).filter((l) => !isSeparator(l));

  return (
    <div key={`table-${baseKey}`} className="my-5 overflow-x-auto rounded-lg border border-border/40 bg-secondary/10 pb-1">
      <table className="w-full text-xs font-mono min-w-max">
        <thead>
          <tr className="border-b border-border/40 bg-secondary/20">
            {headerCells.map((cell, j) => (
              <th
                key={j}
                className="px-4 py-2.5 text-left font-semibold text-muted-foreground tracking-wide text-[11px] uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {dataRows.map((row, ri) => {
            const cells = parseRow(row);
            return (
              <tr key={ri} className="hover:bg-primary/5 transition-colors">
                {headerCells.map((_, j) => {
                  // Strip surrounding asterisks (*value* → value) and round long decimals
                  const raw = (cells[j] ?? "").replace(/^\*+|\*+$/g, "").trim() || "—";
                  // Round numbers with more than 2 decimals: 40.8399999% → 40.84%
                  const content = raw.replace(/(-?\d+\.\d{3,})/g, (m) => {
                    const n = parseFloat(m);
                    return isNaN(n) ? m : n.toFixed(2);
                  });
                  const isND = content === "N/D" || content === "—";
                  const isNumeric = /^[-+$]?\d/.test(content) || content.includes("%") || content.includes("x");
                  const isNegative = /^-/.test(content) && !isND;
                  let colorClass = j === 0 ? "text-foreground font-medium" : "text-foreground/80";

                  if (isNumeric && !isNegative) colorClass = "text-primary font-mono";
                  if (isNegative) colorClass = "text-destructive font-mono";
                  if (isND) colorClass = "text-muted-foreground/40";

                  return (
                    <td key={j} className={`px-4 py-2 whitespace-nowrap ${colorClass}`}>
                      {renderInline(content)}
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
  // Process bold, then inline code, then links
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="text-foreground font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Inline code
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return (
          <code key={`${i}-${j}`} className="bg-primary/15 text-primary px-1.5 py-0.5 rounded text-xs font-mono">
            {cp.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${i}-${j}`}>{cp}</span>;
    });
  });
}

export default Index;
