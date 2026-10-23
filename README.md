# cheaper-fuel

Fuel prices at filling stations in **mainland Portugal**, as a remote
[MCP](https://modelcontextprotocol.io) server **and** an installable Vue PWA dashboard, running on
Cloudflare Workers.

| | |
|---|---|
| **Dashboard** | <https://cheaper-fuel.jorgon.workers.dev/> |
| **MCP endpoint** | `https://cheaper-fuel.jorgon.workers.dev/mcp` |
| **REST API** | <https://cheaper-fuel.jorgon.workers.dev/api> |
| **Server docs** | <https://cheaper-fuel.jorgon.workers.dev/docs> |
| **Health** | <https://cheaper-fuel.jorgon.workers.dev/health> |

Data source: [DGEG — Direção-Geral de Energia e Geologia](https://precoscombustiveis.dgeg.gov.pt/).

## Quick start

```bash
# Use the dashboard in a browser, or install it (it is a PWA):
open https://cheaper-fuel.jorgon.workers.dev/

# Claude Code
claude mcp add --transport http cheaper-fuel https://cheaper-fuel.jorgon.workers.dev/mcp

# MCP Inspector
npx @modelcontextprotocol/inspector
# then connect to https://cheaper-fuel.jorgon.workers.dev/mcp
```

For Codex or any other client, add a remote MCP server pointing at the `/mcp` URL. The endpoint is
stateless Streamable HTTP and needs no authentication.

## Web dashboard

A Vue 3 PWA served from the same Worker (`/`), designed phone-first for use at the pump:

- **Explorar** — asks for your location (one tap) or takes a concelho/postcode, then shows the nearest
  stations on a **Leaflet map** with markers colour-coded by *effective price* after discounts,
  synchronised with the result list.
- **Mercado** — per-fuel min/average/median/max, spread, observed national discount and a comparison
  chart.
- **Histórico** — daily national averages as **Chart.js** line and bar charts (with and without discount).
- **Descontos** — the normalised catalogue: mechanics, caps, requirements, schedule, validity and sources.
- **Sobre** — coverage, freshness, attribution and the MCP connect command.

Installable (manifest + service worker) and usable offline: the last search and previously viewed map
tiles are cached. Location is opt-in, stored only on the device.

Map tiles come from a configurable provider (`VITE_TILE_URL` / `VITE_TILE_ATTRIBUTION`). The default is
**OpenStreetMap standard** tiles — no API key — inverted with CSS into a dark map. The earlier CARTO
default stopped working anonymously (their tiles now render "API KEY REQUIRED"), so a keyed provider such
as CARTO, Stadia or MapTiler can be supplied through those variables.

DGEG does not publish map tiles: its ArcGIS `PostosAbastecimento` service is query-only with no price
fields, so the map uses our own snapshot as the data source.

## REST API

The dashboard is backed by a read-only JSON API that calls exactly the same service functions as the
MCP tools.

| Endpoint | Returns |
|---|---|
| `GET /api/meta` | fuel catalogue, version, registry date, defaults |
| `GET /api/stations` | station search (`location`/`latitude`+`longitude`, `fuels`, `cards`, `services`, `sort`, …) |
| `GET /api/stations/:id` | full station detail with discounts |
| `GET /api/market` | per-fuel statistics (`fuels`, `district`, `municipality`) |
| `GET /api/history` | daily national averages (`fuels`, `days`/`from`/`to`) |
| `GET /api/discounts` | the standardized discount catalogue (`status`, `supplier`, `partner`, …) |
| `GET /api/fuels` | fuel types |
| `GET /api/locations` | concelho/locality/postcode lookup |

List parameters accept either comma-separated values (`?fuels=diesel,95`) or repeated keys. Endpoints
that return discount descriptions accept `lang=en` (default) or `lang=pt`; the dashboard asks for `pt`.
Errors are `{ "error": { "code", "message", "hint?" } }` with 400 for validation, 404 for an unknown
station, 422 for coordinates outside mainland Portugal, 502 for upstream failures and 503 when the
discount registry is unavailable.


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
| `find_stations` | **The workhorse.** Cheapest stations near a place / postal code / coordinates, or within a concelho or district. Accepts friendly fuel and brand names, and reports the effective price after the loyalty cards the user declares. |
| `get_station_details` | One station: every fuel price, opening hours, services, payment methods, plus the discounts that apply to it. |
| `get_market_overview` | Per-fuel min / average / median / max, price spread, and the observed national discount. |
| `get_price_history` | Daily national average prices and the observed discount, with the change over the period. |
| `list_discount_programs` | The standardized discount catalogue from D1: supplier, retail partners, mechanics, caps, validity and provenance. |
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

## Discounts

Discounts come from **two independent sources**, and they are deliberately never added together.

### 1. Observed discounts (automatic, DGEG)

DGEG's daily series publishes both a discounted and an undiscounted national average. The gap is a real,
observable discount measure:

```
observed_discount_eur = avg_without_discount − avg
```

`get_price_history` reports it per day plus a period summary; `get_market_overview` reports the latest
value per fuel. It is a **national weighted average** across all stations and discount types (fleet cards
and similar), so it is not attributable to a supplier or station.

### 2. Programme catalogue (curated, stored in D1)

Supplier and retail-chain deals — Galp × Continente/NOS, BP × Pingo Doce, Repsol — are marketing
promotions with no machine-readable source. They live as **standardized objects in Cloudflare D1**
(`discounts` table), not in the bundle.

One row = one atomic benefit. A composite programme such as COMBINA (an app discount *plus* a supermarket
coupon, tiered by how many services you hold) is several rows sharing `programId` + `tierId`.

```jsonc
{
  "id": "galp-combina-1-coupon",
  "programId": "galp-combina",
  "programTitle": "COMBINA",
  "description": "12 c/L coupon credited to the Cartão Continente after a grocery shop of at least €30 …",
  "tierId": "combina-1",
  "kind": "loyalty_tier",
  "supplier": "GALP",
  "partners": ["CONTINENTE", "NOS"],
  "stationMatch": { "brands": ["GALP"], "namePrefixes": ["Galp", "PA GALP", "PB GALP"] },
  "requires": ["continente_card", "spend:continente_30"],
  "minServices": 1,
  "channel": "coupon",
  "valueType": "cents_per_litre",
  "value": 12,
  "combine": "sum",
  "caps": { "litresPerFill": 60, "litresPerYear": null },
  "schedule": { "kind": "always", "weekdays": [], "daysOfMonth": [], "nth": null, "weekday": null },
  "validFrom": null,
  "validUntil": null,
  "confidence": "high",
  "source": { "url": "…", "retrievedAt": "2026-10-23", "contentHash": null, "fetchMode": "auto", "notes": "…" },
  "updatedAt": "2026-10-23"
}
```

**There is no `status` column.** Activeness is always derived from `validFrom`/`validUntil` against today
in Europe/Lisbon — `scheduled`, `active` or `expired`. Editing one date is enough; nothing can drift.

Every discount also carries a required **`description`** in **both English and Portuguese**
(`description: { en, pt }`). The API and the MCP tools resolve it to a single string using `lang`
(`en` by default, `pt` for the dashboard), so a client never has to reconstruct the mechanic from
numbers and note fields.

Promotions are always listed **active first**, then `scheduled`, then `expired`; supplier and title only
break ties within the same status.

### Day-restricted offers

Some deals only run on particular days. `schedule` expresses that:

| `kind` | Meaning |
|---|---|
| `always` | every day (default) |
| `weekdays` | only on `weekdays`, ISO numbers 1 = Monday … 7 = Sunday |
| `day_of_month` | only on the listed `daysOfMonth` |
| `nth_weekday_of_month` | only on the Nth `weekday`, e.g. the first Wednesday |

```jsonc
"schedule": { "kind": "nth_weekday_of_month", "weekdays": [], "daysOfMonth": [], "nth": 1, "weekday": 3 }
```

An offer that is not valid today is **never applied** to the effective price. It is returned under
`scheduled_discounts` with its `schedule_label` and `next_date`, so an agent can answer "that one runs
on the first Wednesday — next on 2026-11-04" instead of silently showing a price that isn't available.

**What could actually be verified:**

- **Intermarché** — €10 in Cartão Poupança on fills of €50 or more, on the **first Wednesday of each
  month**, at participating stations; the credit is then spent in Intermarché stores from the following
  Thursday to Sunday. Seeded at `medium` confidence (the recurrence comes from a third-party guide,
  while Intermarché promo blogs report one-off Wednesday dates), so it is reported but never applied.
- **BP** — a third-party guide reports 6 c/L on weekdays, 10 c/L at weekends and 15 c/L on the 15th for
  Ultimate. No official page confirms it, so it is **not seeded**.
- **Pingo Doce × BP** — the "20 € fuel" Friday/Saturday/Sunday voucher found online is from **2021**,
  not a current programme, so it is not seeded.

`schedule` is deliberately separate from `validFrom`/`validUntil`: a date range says when the programme
exists, a schedule says which days inside it pay out.

Requirements prefixed `spend:` are conditions the user can trigger by shopping. Everything else is
something they must already hold, and is gated on the `cards` they declare.

### Effective price

```jsonc
{ "location": "Leiria", "fuels": ["diesel"], "brand": "galp",
  "cards": ["continente_card", "mundo_galp_app"], "services": ["galp_energy"] }
```

adds a `discount` block to each station:

```jsonc
"discount": {
  "program_id": "galp-combina", "tier": "combina-1", "label": "1 serviço",
  "guaranteed_cents": 8, "max_cents": 20, "applied_cents": 20,
  "effective_price_eur": 2.099, "effective_price_display": "2,099 €/litro",
  "saves_eur_per_fill": 10,
  "confidence": "high", "stale": false
}
```

- `discount_mode: "guaranteed"` counts only permanent app/instant benefits; the default `best_case` also
  counts spend-triggered coupons.
- `fill_litres` (default 50) makes per-fill caps realistic.
- **Only `confidence: "high"` programmes affect `effective_price`.** Medium/low entries appear as
  `possible_discounts` with `verify: true`, so an unverified mechanic can never produce a wrong ranking.
- Programmes whose mechanic is published without a number are stored **unquantified** (`value: null`)
  and listed as `catalogued_discounts` rather than guessed.
- If D1 is unavailable the price tools keep working and set `discounts_unavailable`.

### Verified partner programmes

| Programme | Supplier × partner | Value stored | Source |
|---|---|---|---|
| COMBINA (3 tiers) | Galp × Continente, NOS | 8–10 c/L app + 12–20 c/L coupon | Galp |
| Plano Motor (3 tiers) | Repsol | 8 / 13 / 18 c/L by energy contracts held | Repsol |
| Lidl Plus × Repsol | Repsol × Lidl | 6 c/L with the app; **10 c/L** when linked to My Repsol (6 immediate + 4 balance) | campaign regulation |
| Poupa Mais | BP × Pingo Doce | €2 per €40 of groceries (≈4 c/L on a 50 L fill) | Pingo Doce |
| Primeira quarta-feira | Intermarché | €10 Cartão Poupança on €50+ fuel, first Wednesday (`medium`) | third-party guide |

The Lidl Plus × Repsol campaign runs **1 Jan – 31 Dec 2026** in mainland Portugal and Madeira, and also
grants a €3 Lidl coupon for every €30 of fuel (max 3 per day, 15-day validity). That coupon is a Lidl
store coupon, so it is described in the discount notes but deliberately **not** priced into the fuel
effective price.

### Keeping it honest

- `npm run discounts:check` — offline gate in CI: schema validation, unique ids, ordered validity
  windows, and no still-applicable programme whose source is more than 90 days old.
- `npm run discounts:verify` — weekly, network: hashes each official source and reports
  `UNCHANGED / CHANGED / BLOCKED / ERROR`. **Change detection only — it never rewrites a promotion.**
- `.github/workflows/discounts-watch.yml` opens or updates an issue when a source moves.

To change a discount: edit `data/discounts.seed.json`, then

```bash
npm run discounts:migration -- --name refresh-discounts   # generate the next migration
npm run db:migrate:remote                                  # apply it to D1
```

> Discounts are **advisory**. Terms belong to the operators, campaigns end, caps apply, and DGEG's list
> price may already include some fleet-card discount. Always confirm at the pump.

## How it works

```
DGEG JSON API
   └─ daily national snapshot (~14,300 station×fuel rows, paged, compacted) … cached 24 h
        ├─ place index   → concelhos, localities, postal codes mapped to median coordinates
        ├─ geo           → haversine, radius widening, concelho grouping
        └─ MCP tools     → find_stations · get_market_overview · get_station_details
   PMD (daily averages) → get_price_history
   GetDadosPosto        → get_station_details (by id)
   D1 `discounts` table → effective prices, list_discount_programs
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
npm run db:migrate:local   # create + seed the local D1 discounts table
npm run web:build          # build the dashboard into web/dist (needed by wrangler dev)
npm run dev                # wrangler dev on http://127.0.0.1:8787

node test/smoke.mjs        # end-to-end checks (MCP + REST + PWA shell)
npm run typecheck          # worker + Vue app
npm test
npm run discounts:check
```

For fast UI iteration run the Vite dev server instead, which proxies the API to the worker:

```bash
# terminal 1
npx wrangler dev --port 8787
# terminal 2
npm run dev:web            # http://127.0.0.1:5173
```

`node test/smoke.mjs https://cheaper-fuel.jorgon.workers.dev/mcp` runs the same checks against a
deployment.

## Deploy

```bash
npm run deploy   # builds the dashboard, then wrangler deploy
```

The Worker serves the SPA from `web/dist` via Cloudflare static assets; `/api/*`, `/mcp`, `/health`
and `/docs` are routed to the Worker (`run_worker_first`), everything else falls back to the SPA shell.

Configuration lives in [`wrangler.jsonc`](wrangler.jsonc):

| Variable | Default | Purpose |
|---|---|---|
| `DGEG_BASE_URL` | `https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb` | Upstream API |
| `CACHE_TTL_SECONDS` | `86400` | Cache lifetime for every upstream call |
| `USER_AGENT` | `cheaper-fuel-mcp/<version> (+repo)` | Identifying agent sent to DGEG |
| `DB` (binding) | `cheaper-fuel-discounts` | D1 database holding the standardized discount objects |

Dashboard-only build-time variables: `VITE_TILE_URL` and `VITE_TILE_ATTRIBUTION` override the basemap.

To auto-deploy on push, connect the repository in the Cloudflare dashboard (Workers → Git
integration) or add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Data source, attribution and disclaimer

DGEG publishes this information **free of charge for reuse**, provided that:

1. DGEG is clearly identified as the source, and
2. the date and time of the last price update are shown.

Both requirements are met in every tool response (`source`, `last_updated`) and on the landing page.

Prices are **reported by station operators**, not measured by DGEG. This project re-publishes them
as-is and guarantees nothing about their accuracy. Not affiliated with or endorsed by DGEG.

Discount programmes are compiled from the operators' own public pages. They are third-party terms that
change without notice, and the catalogue records the source URL and retrieval date for each one. It is
**not** an official DGEG dataset and carries no endorsement from any supplier or retailer.

## Limitations and roadmap

- **Discounts are curated, not scraped.** Promotions have no machine-readable source, the mechanics are
  tiered and capped, and third-party summaries are demonstrably wrong; the registry trades freshness
  automation for correctness. Automation covers validation and change detection only.
- **Guaranteed figures, not headlines.** Repsol advertises "up to 10/15/20 c/L" but its benefits table
  states **8 / 13 / 18 c/L**, so the table values are stored and the headline is only echoed in the
  notes. Time-boxed, fuel-grade-specific campaigns (e.g. bp Ultimate vouchers) are catalogued but not
  applied, because DGEG does not distinguish those grades.
- **No per-station price history.** DGEG publishes daily averages nationally only; per-station
  tracking would need our own D1 + cron snapshots.
- **No route/corridor search** ("cheapest on the way to Porto").
- **No island coverage** — upstream limitation.
- **Free-plan CPU**: the cold parse of the daily snapshot is the heaviest request; a Workers Paid plan
  gives comfortable headroom.

## Project layout

```
shared/
  contracts.ts       response interfaces shared by the worker and the dashboard
src/
  index.ts           HTTP surface: /mcp, /api/*, /health, /docs (SPA served from assets)
  api.ts             read-only JSON API used by the dashboard
  service.ts         the single implementation both surfaces call
  tool-inputs.ts     zod schemas shared by MCP and REST validation
  mcp.ts             MCP server: instructions + the seven tools (thin wrappers)
  discounts.ts       D1 repository, profile resolution and effective pricing
  discount-schema.ts the standardized Discount object, zod schema, derived status and schedules
  snapshot.ts        paged national snapshot, cached and memoised
  places.ts          place index and name/postal-code/coordinate resolution
  geo.ts             haversine, radius widening, concelho grouping
  dgeg.ts            cache helpers, upstream client, typed errors
  domain.ts          pure parsing, matching and statistics
  landing.ts         HTML documentation page served at /docs
web/
  index.html         SPA entry
  vite.config.ts     Vite + Vue + PWA (Workbox) + dev proxy
  public/            generated PWA icons
  src/
    api.ts           typed client for /api
    views/           Explore (map + list), Overview, History, Discounts, About
    components/      MapPanel (Leaflet), charts (Chart.js), StationCard, ChipGroup, StatCard
    composables/     geolocation, profile persistence, Leaflet lifecycle
    lib/             formatting, price colour ramp, geo maths, storage
data/
  discounts.seed.json  authoring source for the discount registry (not bundled)
migrations/
  0001_discounts.sql   D1 schema (no status column)
  0002..0006_*.sql     generated seed and follow-up migrations
scripts/
  build-seed-migration.mjs     seed -> migration
  verify-discount-sources.mjs  source change detection
  generate-icons.py            PWA icons
test/
  *.test.ts          unit tests (vitest): service, api, discounts, domain
  smoke.mjs          end-to-end checks: MCP client, REST API and PWA shell
```

## License

MIT — see [LICENSE](LICENSE).
