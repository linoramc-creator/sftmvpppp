# MensorLab

## Advanced Analytics calculation contract

Metrics `realizedVolatility`, `drawdown`, `rollingCorrelation`, `rollingBeta`
and `relativeStrength` use operation `level`. Daily, weekly and monthly are
display frequencies: computation always uses observed daily closes. Rolling
volatility/correlation/beta require 20, 60 or 120 changes (default 20) and one
additional close. Relations require a benchmark included among at least two
selected assets and an explicit common USD/EUR/GBP currency. Native-currency
volatility and drawdown are allowed, with their currency limitation disclosed.

Rolling calculations request at most 365 calendar days before the visible
start as trailing warm-up. Each point records sample start/end, number of
closes and valid changes, window and reference. No future observation is used.
Incomplete windows, FX absences, intervals exceeding seven days or undefined
variance remain null. Weekly/monthly display takes the last daily result,
including nulls; it never redefines the window as weeks or months.

- Realized volatility: sample standard deviation of simple changes × √252 ×
  100. The convention is 252 observations even for other trading calendars.
- Correlation: Pearson correlation on identical dates. Beta: covariance divided
  by reference variance. A constant price has zero volatility but undefined
  correlation and beta.
- Drawdown: change from the running maximum of **visible-period** closes.
  Earlier or future highs cannot establish that peak; this is not an all-time
  maximum claim.
- Relative strength: normalized price ratio change from the first visible
  common close. It is not RSI, total return or causal attribution. The reference
  line is preserved and clearly labelled.

These are observed split-adjusted prices without reinvested dividends. Source
and export restrictions remain unchanged. Unavailable metrics and unapproved
windows offer explicit separate alternatives. Multiple requested metrics are
offered as independent studies, never silently reduced to a single metric.

`labOrganize` resolves a server-owned source run, accepts only a bounded subset
of existing IDs and names, and never accepts query/result evidence from the
client. It retains the original `generatedAt` and observations; `organizedAt`
records the organizational edit. A changed query or allocation requires an
explicit fresh calculation.

MensorLab extends Analytics with private, reproducible projects. It does not
create a second portfolio or write to the simulator's order or position tables.
The simulator entry is removed from navigation; its existing records remain.

## Workflows

- **Estudios y proyectos:** use editable templates for an asset and reference,
  diversification, or hypothetical long-only weights. Combine up to six studies,
  with up to eight assets per study. Include any reference among those assets.
- The study list selects a single visible result. Each study, including a custom
  chart, can be renamed, duplicated, moved up/down or removed with confirmation.
  Removing it immediately removes its graph from the current workspace. Removing
  the last study clears the workspace; an empty definition is never submitted.
  A saved empty workspace offers deletion of its project or creation of a study.
- Reordering, renaming or removing existing studies uses `labOrganize`. The
  server reads the owned run and builds a new run containing only its permitted
  subset, preserving original observation dates, values and sources. No client
  result upload, provider request or model call is needed. Save the organized
  run normally to persist the changed project. New studies or changed query
  parameters require an explicit calculation.
- Volatility, drawdown, rolling correlation and rolling beta are selectable
  templates backed by the deterministic Analytics metrics. Their daily windows
  and references remain editable and are part of the query definition.
- **Gráficos a medida:** the existing natural-language Analytics workflow, saved
  queries, coverage alternatives, sources and export controls remain available.
  Add an executed chart definition to a project; changing pending parameters
  requires executing that chart before it can be added.
- **Private projects:** calculate first, then save the server run identifier.
  Opening a project reads its saved result without reinterpreting or fetching
  market data. Updating creates a dated snapshot and preserves earlier results.
  There are at most 20 projects and 10 snapshots per project. Unsaved server runs
  expire after 48 hours and are bounded independently.

Project and snapshot options are collapsed until requested. Opening another
project or starting a new one requires confirmation when there are unsaved
changes; leaving the browser also uses its standard unsaved-work confirmation.

The account-scoped contextual links from reports and quick asset pages still
open the existing chart workflow. They execute a predefined query once, without
an additional model call. Hidden panels defer their work.

## Methodology

Comparisons use daily prices in a chosen common currency (USD, EUR or GBP), on
matching dates. Results identify sources, units, observation counts, dates,
conversion gaps and methodology. Price variation is not dividend-inclusive
total return. Annualization is 252 sessions; risk estimates require at least
20 matching returns. Zero variance, missing observations or an insufficient
sample produce an unavailable metric rather than an invented zero.

Metrics include price variation, historical annualized volatility, maximum
drawdown, beta, correlation and relative strength against the selected reference.
The correlation matrix states its matching sample. Historical relationships do
not establish causality.

Scenario asset weights and explicit cash must total exactly 100%; the server
never normalizes them automatically. Positions are long-only and hypothetical.
The output shows weight coverage, concentration, equivalent holdings and
historical risk estimates. Missing weighted assets are not treated as cash or
as zero-return positions. Cash has no assumed interest return. These studies
are neither forecasts nor an order-execution backtest.

## Persistence and access

Authentication determines ownership on the server. Clients do not provide an
owner identifier or upload results to be stored as verified executions.
Optimistic revisions detect concurrent writes. Idempotency identifiers are
reused after an uncertain reply and changed for a different save or refresh.
Account changes abort pending work and discard the previous user's local state.

Calculations, refreshes, templates and visual changes do not call a language
model. The inherited natural-language chart interpreter is separate. Provider
series are reused within an execution and use the existing server cache and
coverage controls. Unsupported queries keep explicit alternatives.

## Exports

Charts reuse Analytics SVG/PNG exports, with a small MensorTerminal signature
at the bottom right. Source rights control chart and CSV availability. A JSON
project definition contains the executed definitions and evidence metadata;
it does not silently export the underlying observations. Local chart style
controls change the current view; the saved project retains its executed
definition and chart settings until recalculated with a changed definition.

## Verification

Frontend tests cover explicit execution, invalid scenario weights, authenticated
actions, save identities, opening immutable snapshots without recomputation,
revision conflicts, dirty definitions, confirmation before deletion, hidden
panels, contextual chart navigation and account cancellation. The original
Analytics tests cover its calculations display, gaps, export permissions and
watermarked chart exports. Backend tests exercise calculations, data gaps,
validation, persistence and user isolation independently of UI fixtures.
