import type React from 'react';
import {cleanReportText} from '@/lib/editorial';
// Normalize section names so Gemini drift ("Resumen ejecutivo", "Resumen Ejecutivo.",
// "##  Resumen Ejecutivo") still matches the canonical EXPECTED_TABS entry.
function normalizeSectionName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseSections(content: string, knownTabs: string[], options:{preserveMetricTable?:boolean}={}): Record<string, React.ReactNode[]> {
  const lines = cleanReportText(content).split("\n");
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
      currentElements.push(renderTable(tableLines, i,options.preserveMetricTable));
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
          <li key={i} className="ml-4 mb-3 list-decimal text-muted-foreground marker:text-section-heading marker:font-semibold text-xs">
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

export function renderElements(elements: React.ReactNode[]) {
  return <div className="space-y-0.5">{elements}</div>;
}

export function sectorTrends(elements: React.ReactNode[]) {
  let keep = false;
  return elements.filter(node => {
    const element = node as { type?: unknown; props?: { children?: unknown } } | null;
    if (element?.type === 'h3') keep = /Tendencias|Disruptores|Innovaciones/i.test(String(element.props?.children ?? ''));
    return keep;
  });
}

function renderTable(tableLines: string[], baseKey: number,preserveMetricTable=false) {
  if (tableLines.length < 2) return null;

  const parseRow = (line: string) =>
    line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const headerCells = parseRow(tableLines[0]);

  // Skip the "Métrica | Valor" table — it's rendered inside the unified Historical Financials table
  if (!preserveMetricTable && headerCells.length === 2 && /^Métrica$/i.test(headerCells[0]) && /^Valor$/i.test(headerCells[1])) {
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
  return { icon: "▸", cls: "text-section-heading/50 text-[10px]" };
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
  text = cleanReportText(text);
  const withLinks = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return withLinks.map((seg, si) => {
    const linkMatch = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) seg = linkMatch[1];
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
            <code key={`${si}-${i}-${j}`} className="bg-section-heading/10 !text-primary px-1 py-0.5 text-xs">
              {cp.slice(1, -1)}
            </code>
          );
        }
        return <span key={`${si}-${i}-${j}`}>{cp}</span>;
      });
    });
  });
}
