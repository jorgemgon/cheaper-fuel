import { SERVER_VERSION } from "./env";
import { MAINLAND_NOTE, SOURCE } from "./domain";

const TOOLS: Array<{ name: string; summary: string }> = [
  {
    name: "find_stations",
    summary:
      "Cheapest stations near a place, postal code, coordinate or within a concelho/district. " +
      "Widens the radius automatically to cover neighbouring concelhos and reports which ones were searched.",
  },
  { name: "get_station_details", summary: "One station: every fuel price, opening hours, services, payment methods." },
  { name: "get_market_overview", summary: "Min / average / median / max and the price spread, nationally or per concelho." },
  { name: "get_price_history", summary: "Daily national average prices and the observed discount, with the change over the period." },
  {
    name: "list_discount_programs",
    summary:
      "The discount catalogue stored in D1: supplier, retail partners, mechanics, caps, validity and provenance. " +
      "Activeness is derived from the validity dates, never stored.",
  },
  { name: "list_fuel_types", summary: "Fuel catalogue: ids, names and units." },
  { name: "list_locations", summary: "Resolve concelhos, localities and postal codes." },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderLanding(origin: string): string {
  const endpoint = `${origin}/mcp`;
  const toolRows = TOOLS.map(
    (tool) =>
      `<tr><td><code>${escapeHtml(tool.name)}</code></td><td>${escapeHtml(tool.summary)}</td></tr>`,
  ).join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cheaper-fuel — Portugal fuel prices MCP</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem;
    font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0b0f14; color: #d8e2ec;
  }
  main { max-width: 62rem; margin: 0 auto; }
  h1 { font-size: 2rem; margin: 0 0 .35rem; letter-spacing: -.02em; color: #fff; }
  h2 { font-size: 1.05rem; text-transform: uppercase; letter-spacing: .08em; color: #7f97ad; margin: 2.4rem 0 .75rem; }
  p { margin: .6rem 0; }
  .lede { color: #9fb3c6; font-size: 1.05rem; }
  a { color: #6cc4ff; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875em; }
  code { background: #16202b; padding: .12em .4em; border-radius: .3rem; }
  pre { background: #16202b; border: 1px solid #22303d; border-radius: .6rem; padding: 1rem; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .6rem .7rem; border-bottom: 1px solid #1d2933; vertical-align: top; }
  th { color: #8aa1b6; font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; }
  .badge { display: inline-block; background: #16323f; color: #7fd4ff; border: 1px solid #1f4a5c;
           padding: .1rem .55rem; border-radius: 99px; font-size: .75rem; margin-left: .5rem; vertical-align: middle; }
  .notice { border-left: 3px solid #2a6f8f; background: #101a22; padding: .8rem 1rem; border-radius: .35rem; margin: 1rem 0; }
  footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid #1d2933; color: #74889b; font-size: .875rem; }
</style>
</head>
<body>
<main>
  <h1>cheaper-fuel <span class="badge">v${escapeHtml(SERVER_VERSION)}</span></h1>
  <p class="lede">A remote MCP server for fuel prices at filling stations in mainland Portugal.</p>

  <h2>Endpoint</h2>
  <p><code>${escapeHtml(endpoint)}</code> — Streamable HTTP, stateless, no authentication.</p>

  <h2>Connect a client</h2>
  <pre><code># Claude Code
claude mcp add --transport http cheaper-fuel ${escapeHtml(endpoint)}

# MCP Inspector
npx @modelcontextprotocol/inspector</code></pre>
  <p>For Codex or other clients, add a remote MCP server with the URL above.</p>

  <h2>Tools</h2>
  <table>
    <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
    <tbody>
        ${toolRows}
    </tbody>
  </table>

  <div class="notice">
    <strong>Data freshness.</strong> Prices are cached for up to 24 hours. Every response includes
    <code>data_fetched_at</code> (when this server last read DGEG) and <code>last_updated</code>
    (when the operator published each price). Treat prices as published figures, not real-time quotes.
  </div>

  <div class="notice">
    <strong>Discounts are advisory.</strong> <code>find_stations</code> accepts <code>cards</code> and
    <code>services</code> and reports an <code>effective_price</code> after the programmes the caller
    qualifies for. Only high-confidence programmes are applied; anything still being verified is returned
    separately as <code>possible_discounts</code>, and deals published without a number are catalogued
    rather than guessed. Terms belong to the operators — confirm at the pump.
  </div>

  <div class="notice">
    <strong>Coverage.</strong> ${escapeHtml(MAINLAND_NOTE)}
  </div>

  <h2>Data source</h2>
  <p>
    ${escapeHtml(SOURCE)}. DGEG publishes this information free of charge for reuse, on condition that
    DGEG is identified as the source and each price carries its last-update date and time. Both are
    included in every tool response.
  </p>
  <p>
    Prices are reported by station operators, not measured by DGEG. This service re-publishes them
    as-is and does not guarantee accuracy.
  </p>

  <footer>
    <p>cheaper-fuel · <a href="/health">/health</a> · source: <a href="https://precoscombustiveis.dgeg.gov.pt/" rel="noopener">precoscombustiveis.dgeg.gov.pt</a></p>
  </footer>
</main>
</body>
</html>`;
}
