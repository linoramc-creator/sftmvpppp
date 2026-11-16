# MensorLab

MensorLab extends Analytics with private, reproducible projects. It does not
create a second portfolio or write to the simulator's order or position tables.
The simulator entry is removed from navigation; its existing records remain.

## Workflows

- **Estudios y proyectos:** use editable templates for an asset and reference,
  diversification, or hypothetical long-only weights. Combine up to six studies,
  with up to eight assets per study. Include any reference among those assets.
- **Gráficos a medida:** the existing natural-language Analytics workflow, saved
  queries, coverage alternatives, sources and export controls remain available.
  Add an executed chart definition to a project; changing pending parameters
  requires executing that chart before it can be added.
- **Private projects:** calculate first, then save the server run identifier.
  Opening a project reads its saved result without reinterpreting or fetching
  market data. Updating creates a dated snapshot and preserves earlier results.
  There are at most 20 projects and 10 snapshots per project. Unsaved server runs
  expire after 48 hours and are bounded independently.

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
