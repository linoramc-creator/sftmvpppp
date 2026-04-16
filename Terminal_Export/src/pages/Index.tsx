import { useState, useRef, useCallback } from "react";
import { Search, TrendingUp, AlertCircle, Loader2, Download, TerminalSquare } from "lucide-react";
import { streamAnalysis } from "@/lib/analyze";
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

const Index = () => {
  const [ticker, setTicker] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentTicker, setCurrentTicker] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("Resumen Ejecutivo");

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
    <div className="min-h-screen bg-background flex flex-col font-mono text-foreground">
      <header className="border-b-2 border-border/50 px-6 py-4 bg-black">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TerminalSquare className="h-6 w-6 text-primary" />
            <span className="font-heading text-lg font-bold tracking-widest text-primary">
              BBG-TERMINAL<span className="text-muted-foreground ml-1">v2.0</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-primary/70 animate-pulse hidden sm:inline-block">
              ● REAL-TIME CONNECTION ESTABLISHED
            </span>
            <span className="px-2 py-1 bg-primary/10 text-primary border border-primary/20 text-xs rounded">
              GOV / CORP / MTGE / M-MKT
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 flex flex-col">
        <div className="mb-6 bg-secondary/30 p-4 border border-border/50 rounded-sm">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/50 text-sm">{">"}</span>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                placeholder="ENTER TICKER (E.G. AAPL) OR COMMAND..."
                maxLength={20}
                className="w-full h-12 pl-8 pr-4 bg-black border border-border/70 rounded-sm text-primary font-mono text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-colors uppercase tracking-widest"
              />
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isLoading || !ticker.trim()}
              className="h-12 px-8 bg-primary text-primary-foreground font-heading text-sm font-bold rounded-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 uppercase tracking-wider"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  PROCESSING
                </>
              ) : (
                "SEARCH <GO>"
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive rounded-sm flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive uppercase tracking-wide">{error}</p>
          </div>
        )}

        {(analysis || isLoading) && (
          <div className="flex-1 flex flex-col border border-border/50 rounded-sm bg-black shadow-2xl overflow-hidden min-h-[600px]">
            <div className="px-4 py-2 border-b border-border/50 flex flex-wrap items-center justify-between bg-secondary/20 min-h-[44px]">
              <div className="flex items-center gap-3">
                <div className={`h-2.5 w-2.5 rounded-sm ${isLoading ? "bg-primary animate-pulse" : "bg-primary"}`} />
                <span className="font-mono text-sm font-bold text-primary tracking-widest">
                  {currentTicker} <span className="text-muted-foreground ml-2">EQUITY</span>
                </span>
              </div>
              <div className="flex items-center gap-4">
                {isLoading && (
                  <span className="text-xs text-[#FF9900] font-mono animate-pulse uppercase tracking-wider">
                    STREAMING DATA...
                  </span>
                )}
                {!isLoading && analysis && (
                  <button
                    onClick={() => downloadAnalysisPdf(analysis, currentTicker)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/70 transition-colors font-mono uppercase border border-primary/30 px-2 py-1 rounded-sm"
                  >
                    <Download className="h-3.5 w-3.5" />
                    EXPORT PDF
                  </button>
                )}
              </div>
            </div>
            
            <AnalysisTabsRenderer 
              content={analysis} 
              isLoading={isLoading} 
              activeTab={activeTab} 
              setActiveTab={setActiveTab} 
            />
          </div>
        )}

        {!analysis && !isLoading && !error && (
          <div className="text-center py-32 flex-1 flex flex-col justify-center items-center opacity-30">
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="h-24 w-32 border border-primary/30 rounded-sm flex items-center justify-center"><TrendingUp className="text-primary h-8 w-8" /></div>
              <div className="h-24 w-32 border border-primary/30 rounded-sm flex items-center justify-center"><TerminalSquare className="text-primary h-8 w-8" /></div>
            </div>
            <p className="text-primary font-bold tracking-widest mb-2 uppercase">
              SYSTEM STANDBY
            </p>
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              AWAITING INPUT...
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

// ── Improved Tabbed Markdown Renderer ──────────────────────────────────────────

function AnalysisTabsRenderer({ content, isLoading, activeTab, setActiveTab }: { content: string; isLoading: boolean, activeTab: string, setActiveTab: (t: string) => void }) {
  const sections = parseSections(content);
  const computedTabs = Object.keys(sections);
  
  if (computedTabs.length === 0) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-primary/50 text-sm">
        <Loader2 className="h-8 w-8 animate-spin mb-4 text-[#FF9900]" />
        INITIALIZING MATRICES...
      </div>
    );
  }

  // Find if current requested tab has data. If not, fallback to first computed tab.
  const displayTab = sections[activeTab] ? activeTab : computedTabs[0];
  const currentTabContent = sections[displayTab] || [];

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#050505]">
      {/* Tab Navigation */}
      <div className="flex border-b border-border/50 bg-[#000000] overflow-x-auto overflow-y-hidden custom-scrollbar shrink-0">
        {EXPECTED_TABS.map((expectedTab) => {
          const hasContent = !!sections[expectedTab];
          const isActive = displayTab === expectedTab;

          // Only mapping expected tabs. If AI generates arbitrary ones, they are ignored for UI cleanlyness, 
          // but we can add them at the end.
          return (
            <button
              key={expectedTab}
              onClick={() => hasContent && setActiveTab(expectedTab)}
              disabled={!hasContent && !isLoading}
              className={`
                px-5 py-2 text-xs font-bold font-mono tracking-wider whitespace-nowrap uppercase transition-all
                border-r border-border/50 select-none outline-none
                ${isActive ? "bg-primary/10 text-primary border-b-[3px] border-b-primary shadow-sm" : "text-muted-foreground border-b-[3px] border-b-transparent hover:bg-white/5"}
                ${!hasContent ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {expectedTab} {isLoading && !hasContent && EXPECTED_TABS.indexOf(expectedTab) === computedTabs.length ? "..." : ""}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 analysis-content text-sm text-[#FF9900] leading-relaxed overflow-y-auto">
        {renderElements(currentTabContent)}
        {isLoading && displayTab === computedTabs[computedTabs.length - 1] && <span className="terminal-cursor text-primary ml-1" />}
      </div>
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
        <h3 key={i} className="text-base font-bold mb-3 mt-6 text-primary uppercase tracking-wide border-b border-primary/20 pb-1">
          {line.slice(4)}
        </h3>
      );
    } else if (line.match(/^---+$/)) {
      currentElements.push(<hr key={i} className="my-5 border-border/50" />);
    } else if (line.match(/^[-*] /)) {
      currentElements.push(
        <li key={i} className="ml-2 mb-2 list-none flex items-start">
          <span className="text-primary mr-3 mt-0.5 select-none">■</span>
          <span className="flex-1">{renderInline(line.slice(2))}</span>
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      const match = line.match(/^(\d+)\. (.*)$/);
      if (match) {
        currentElements.push(
          <li key={i} className="ml-6 mb-2 list-decimal text-primary marker:text-primary marker:font-bold">
            <span className="text-[#FF9900]">{renderInline(match[2])}</span>
          </li>
        );
      }
    } else if (line.startsWith("> ")) {
      currentElements.push(
        <blockquote key={i} className="border-l-4 border-primary/50 pl-4 py-1 my-4 text-[#FF9900]/80 italic bg-primary/5">
          {line.slice(2)}
        </blockquote>
      );
    } else if (line.trim() === "") {
      currentElements.push(<div key={i} className="h-3" />);
    } else {
      // Normal paragraph
      currentElements.push(
        <p key={i} className="mb-3">
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

  // A very Bloomberg-ish grid table
  return (
    <div key={`table-${baseKey}`} className="my-6 overflow-x-auto border-y border-border/40 bg-black/50 custom-scrollbar pb-2">
      <table className="w-full text-xs font-mono min-w-max">
        <thead>
          <tr className="border-b-2 border-border/60">
            {headerCells.map((cell, j) => (
              <th
                key={j}
                className="px-4 py-3 text-left font-bold text-primary uppercase tracking-wider"
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
              <tr key={ri} className="hover:bg-primary/10 transition-colors group">
                {headerCells.map((_, j) => {
                  const content = cells[j] ?? "N/D";
                  const isNumberOrNA = /^[-$]?\d|N\/D|%/.test(content);
                  const isNegative = content.startsWith("-");
                  let colorClass = "text-foreground";

                  if (isNumberOrNA) colorClass = "text-[#FF9900]";
                  if (isNegative) colorClass = "text-destructive";

                  return (
                    <td key={j} className={`px-4 py-2.5 whitespace-nowrap ${colorClass}`}>
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
        <strong key={i} className="text-primary font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Inline code
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return (
          <code key={`${i}-${j}`} className="bg-primary/20 text-primary px-1.5 py-0.5 rounded-[2px] text-xs font-mono font-bold">
            {cp.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${i}-${j}`}>{cp}</span>;
    });
  });
}

export default Index;
