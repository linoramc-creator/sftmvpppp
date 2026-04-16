function formatInlineHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function renderTableHtml(tableLines: string[]): string {
  if (tableLines.length < 2) return "";

  const parseRow = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  const isSeparator = (line: string) => /^\|?[\s\-:|]+\|?$/.test(line);

  const headerCells = parseRow(tableLines[0]);
  const startDataIdx = tableLines.length > 1 && isSeparator(tableLines[1]) ? 2 : 1;
  const dataRows = tableLines.slice(startDataIdx).filter((l) => !isSeparator(l));

  let html = '<div class="table-wrap"><table>';
  html += "<thead><tr>";
  headerCells.forEach((c) => { html += `<th>${formatInlineHtml(c)}</th>`; });
  html += "</tr></thead><tbody>";
  dataRows.forEach((row) => {
    const cells = parseRow(row);
    html += "<tr>";
    headerCells.forEach((_, j) => {
      html += `<td>${formatInlineHtml(cells[j] ?? "")}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let i = 0;
  let inUl = false;

  const closeUl = () => {
    if (inUl) { html.push("</ul>"); inUl = false; }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("|")) {
      closeUl();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      html.push(renderTableHtml(tableLines));
      continue;
    }

    if (line.startsWith("### ")) {
      closeUl();
      html.push(`<h3>${formatInlineHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeUl();
      html.push(`<h2>${formatInlineHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeUl();
      html.push(`<h1>${formatInlineHtml(line.slice(2))}</h1>`);
    } else if (line.match(/^---+$/)) {
      closeUl();
      html.push("<hr>");
    } else if (line.match(/^[-*] /)) {
      if (!inUl) { html.push("<ul>"); inUl = true; }
      html.push(`<li>${formatInlineHtml(line.slice(2))}</li>`);
    } else if (line.match(/^\d+\. /)) {
      const m = line.match(/^(\d+)\. (.*)$/);
      if (m) {
        if (!inUl) { html.push("<ul>"); inUl = true; }
        html.push(`<li>${formatInlineHtml(m[2])}</li>`);
      }
    } else if (line.trim() === "") {
      closeUl();
      html.push("");
    } else {
      closeUl();
      html.push(`<p>${formatInlineHtml(line)}</p>`);
    }

    i++;
  }

  closeUl();
  return html.join("\n");
}

export function downloadAnalysisPdf(markdown: string, ticker: string) {
  const bodyHtml = markdownToHtml(markdown);
  const dateStr = new Date().toLocaleDateString("es-ES", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const win = window.open("", "_blank");
  if (!win) {
    alert("Permite ventanas emergentes en tu navegador para descargar el PDF.");
    return;
  }

  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${ticker} — Informe Financiero</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 10pt;
  color: #111;
  background: #fff;
  padding: 18mm 20mm;
  line-height: 1.6;
}
.report-header {
  border-bottom: 2px solid #1a1a2e;
  padding-bottom: 10pt;
  margin-bottom: 18pt;
}
.report-header h1 {
  font-size: 22pt;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 4pt;
  letter-spacing: -0.5pt;
}
.report-header .subtitle {
  font-size: 8pt;
  color: #777;
}
h2 {
  font-size: 12pt;
  font-weight: 700;
  color: #1a1a2e;
  margin: 20pt 0 5pt;
  padding-bottom: 3pt;
  border-bottom: 1px solid #ccc;
}
h3 {
  font-size: 10.5pt;
  font-weight: 700;
  margin: 12pt 0 4pt;
  color: #333;
}
p { margin: 3pt 0 5pt; }
ul {
  margin: 4pt 0 8pt;
  padding-left: 16pt;
}
li { margin: 3pt 0; }
hr { border: none; border-top: 1px solid #ddd; margin: 10pt 0; }
.table-wrap {
  overflow-x: auto;
  margin: 8pt 0 14pt;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 8.5pt;
}
th {
  background: #1a1a2e;
  color: #fff;
  border: 1px solid #1a1a2e;
  padding: 5pt 7pt;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
}
td {
  border: 1px solid #ccc;
  padding: 4pt 7pt;
  white-space: nowrap;
}
tr:nth-child(even) td { background: #f5f7fa; }
code {
  font-family: 'Courier New', monospace;
  font-size: 8pt;
  background: #f0f0f0;
  padding: 1pt 3pt;
  border-radius: 2pt;
}
strong { font-weight: 700; }
.footer {
  margin-top: 28pt;
  padding-top: 8pt;
  border-top: 1px solid #ccc;
  font-size: 7.5pt;
  color: #aaa;
  text-align: center;
}
@media print {
  body { padding: 0; }
  @page { margin: 15mm 12mm; size: A4 portrait; }
  h2 { break-before: auto; page-break-before: auto; }
  .table-wrap { break-inside: avoid; page-break-inside: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .report-header { break-after: avoid; }
}
</style>
</head>
<body>
<div class="report-header">
  <h1>${ticker} — Informe Financiero</h1>
  <div class="subtitle">AI-Powered Equity Research &nbsp;|&nbsp; ${dateStr} &nbsp;|&nbsp; Datos orientativos. No constituyen asesoramiento financiero.</div>
</div>
${bodyHtml}
<div class="footer">Generado por AI · Fuentes: Finnhub, Tavily · ${dateStr}</div>
<script>
window.onload = function() {
  setTimeout(function() { window.print(); }, 500);
};
<\/script>
</body>
</html>`);

  win.document.close();
}
