# cheaper-fuel

A remote [MCP](https://modelcontextprotocol.io) server for fuel prices at filling stations in
**mainland Portugal**, running on Cloudflare Workers.

| | |
|---|---|
| **MCP endpoint** | `https://cheaper-fuel.jorgon.workers.dev/mcp` |
| **Landing page** | <https://cheaper-fuel.jorgon.workers.dev/> |
| **Health** | <https://cheaper-fuel.jorgon.workers.dev/health> |

Data source: [DGEG — Direção-Geral de Energia e Geologia](https://precoscombustiveis.dgeg.gov.pt/).

## Quick start

```bash
# Claude Code
claude mcp add --transport http cheaper-fuel https://cheaper-fuel.jorgon.workers.dev/mcp

# MCP Inspector
npx @modelcontextprotocol/inspector
# then connect to https://cheaper-fuel.jorgon.workers.dev/mcp
```

For Codex or any other client, add a remote MCP server pointing at the `/mcp` URL. The endpoint is
stateless Streamable HTTP and needs no authentication.

## Why not scrape the website?

The public page at `precoscombustiveis.dgeg.gov.pt` is a JavaScript shell. Its own scripts fetch JSON
from `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/*`, so this server calls that same API
instead of parsing HTML:

- a stable schema instead of selectors that break on redeploy,
- `Access-Control-Allow-Origin: *` and `application/json`,
- it is the exact data source DGEG serves to its own site,
- `robots.txt` does not restrict `/api/`.

## Tools

Six tools, deliberately few, so an agent does not wander between lookups.

| Tool | Use it for |
|---|---|
| `find_stations` | **The workhorse.** Cheapest stations near a place / postal code / coordinates, or within a concelho or district. Accepts friendly fuel and brand names. |
| `get_station_details` | One station: every fuel price, opening hours, services, payment methods. |
| `get_market_overview` | Per-fuel min / average / median / max and price spread, nationally or regionally. |
| `get_price_history` | Daily national average prices with the change over the period. |
| `list_fuel_types` | Fuel catalogue (id, name, unit, road-fuel flag). |
| `list_locations` | Resolve concelhos, localities and postal codes. |

### Designed so agents make one call, not five

- **No prerequisite lookups.** Every tool accepts human names — `"diesel"`, `"gasóleo"`, `"95"`,
  `"gpl"`, `"Leiria"`, `"2400-193"`, `"galp"` — and resolves them internally. Numeric ids are
  optional.
- **No coordinate requirement.** `location` takes a city, a locality, a postal code (`2400-193` or
  `2400`), or `"lat,lon"`.
- **One call returns everything**: price, formatted display price, address, coordinates, distance,
  map link and freshness.
- **Self-widening radius.** If a small concelho has too few stations, `find_stations` grows the radius
  up to `max_radius_km` and reports `effective_radius_km`.
- **Server `instructions`** in the MCP handshake give the model a routing table, so it picks the right
  tool first time.
- **Errors terminate loops.** Failures return `{ error: { code, message, hint, candidates? } }` with a
  concrete next step instead of an empty result.

### Examples

```jsonc
// What is diesel around Leiria right now?
{ "location": "Leiria", "fuels": ["diesel"], "limit": 3 }

// I only know my postcode.
{ "location": "2400-193" }

// Cheapest petrol 95 in Porto district, supermarkets only.
{ "district": "Porto", "fuels": ["gasolina 95"], "station_type": "supermercado", "limit": 5 }

// Prices published in the last 24 hours only.
{ "location": "Coimbra", "fuels": ["diesel"], "updated_within_hours": 24 }

// How has diesel moved this quarter?
{ "fuels": ["diesel"], "days": 90 }          // get_price_history
```

A proximity call returns the neighbouring concelhos it covered:

```jsonc
"municipalities_covered": [
  { "municipality": "Leiria",         "station_count": 14, "min_distance_km": 0.42 },
  { "municipality": "Marinha Grande", "station_count": 6,  "min_distance_km": 8.11 },
  { "municipality": "Batalha",        "station_count": 4,  "min_distance_km": 11.7 }
]
```

## How it works

```
DGEG JSON API
   └─ daily national snapshot (~14,300 station×fuel rows, paged, compacted) … cached 24 h
        ├─ place index   → concelhos, localities, postal codes mapped to median coordinates
        ├─ geo           → haversine, radius widening, concelho grouping
        └─ MCP tools     → find_stations · get_market_overview · get_station_details
   PMD (daily averages) → get_price_history
   GetDadosPosto        → get_station_details (by id)
```

- **One upstream snapshot per day** powers proximity, regional and market queries. It is cached in the
  Cloudflare Cache API for `CACHE_TTL_SECONDS` (default 86400) and memoised per isolate, so warm
  requests skip the ~1.8 MB JSON parse.
- **Place resolution needs no external geocoder.** The snapshot yields 278 concelhos, ~1,770
  localities and ~2,680 postal codes; each gets a median coordinate.
- **"Neighbouring concelhos" come from geometry**, not a hand-maintained adjacency table: the search
  radius widens until every requested fuel has enough results, and `municipalities_covered` lists
  exactly which concelhos were included.

## Data freshness and coverage

Prices are **cached for up to 24 hours**. Every response carries:

- `data_fetched_at` — when this server last read DGEG (the true cache age),
- `last_updated` (per station) or `date` (per history point) — DGEG's own publication timestamp.

Treat results as *as published by DGEG*, never as real-time quotes.

**Coverage is mainland Portugal only** — 18 districts, 278 concelhos. DGEG publishes no Azores or
Madeira stations, so island coordinates return an explicit `unsupported_region` error rather than an
empty list.

`get_price_history` is **national** because that is the only granularity DGEG publishes; there is no
per-concelho or per-station history endpoint.

## Local development

```bash
npm install
npm run dev          # wrangler dev on http://127.0.0.1:8787

node test/smoke.mjs  # 12 end-to-end checks against the local worker
npm run typecheck
npm test
```

`npm run smoke -- https://cheaper-fuel.jorgon.workers.dev/mcp` runs the same checks against a
deployment.

## Deploy

```bash
npx wrangler deploy
```

Configuration lives in [`wrangler.jsonc`](wrangler.jsonc):

| Variable | Default | Purpose |
|---|---|---|
| `DGEG_BASE_URL` | `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb` | Upstream API |
| `CACHE_TTL_SECONDS` | `86400` | Cache lifetime for every upstream call |
| `USER_AGENT` | `cheaper-fuel-mcp/<version> (+repo)` | Identifying agent sent to DGEG |

To auto-deploy on push, connect the repository in the Cloudflare dashboard (Workers → Git
integration) or add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Data source, attribution and disclaimer

DGEG publishes this information **free of charge for reuse**, provided that:

1. DGEG is clearly identified as the source, and
2. the date and time of the last price update are shown.

Both requirements are met in every tool response (`source`, `last_updated`) and on the landing page.

Prices are **reported by station operators**, not measured by DGEG. This project re-publishes them
as-is and guarantees nothing about their accuracy. Not affiliated with or endorsed by DGEG.

## Limitations and roadmap

- **No per-station price history.** DGEG publishes daily averages nationally only; per-station
  tracking would need our own D1 + cron snapshots.
- **No route/corridor search** ("cheapest on the way to Porto").
- **No island coverage** — upstream limitation.
- **Free-plan CPU**: the cold parse of the daily snapshot is the heaviest request; a Workers Paid plan
  gives comfortable headroom.

## Project layout

```
src/
  index.ts      HTTP surface: /mcp, /, /health
  mcp.ts        MCP server, instructions and the six tools
  snapshot.ts   paged national snapshot, cached and memoised
  places.ts     place index and name/postal-code/coordinate resolution
  geo.ts        haversine, radius widening, concelho grouping
  dgeg.ts       cache helpers, upstream client, typed errors
  domain.ts     pure parsing, matching and statistics
  landing.ts    HTML documentation page
test/
  *.test.ts     unit tests (vitest)
  smoke.mjs     end-to-end MCP client checks
```

## License

MIT — see [LICENSE](LICENSE).
