#!/usr/bin/env node
/**
 * End-to-end smoke test: connects to a running cheaper-fuel worker as a real
 * MCP client and exercises the tool surface against live DGEG data.
 *
 *   node test/smoke.mjs                      # http://127.0.0.1:8787/mcp
 *   node test/smoke.mjs https://host/mcp     # deployed worker
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://127.0.0.1:8787/mcp";
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`Connecting to ${url}`);
  const client = new Client({ name: "cheaper-fuel-smoke", version: "0.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);

  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    const text = (response.content ?? []).find((part) => part.type === "text")?.text ?? "{}";
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { parseError: text.slice(0, 200) };
    }
    return { response, json };
  };

  const { tools } = await client.listTools();
  const expected = [
    "find_stations",
    "get_station_details",
    "get_market_overview",
    "get_price_history",
    "list_discount_programs",
    "list_fuel_types",
    "list_locations",
  ];
  check(
    `tools/list returns ${expected.length} tools`,
    tools.length === expected.length && expected.every((name) => tools.some((tool) => tool.name === name)),
    tools.map((tool) => tool.name).join(", "),
  );

  const near = await call("find_stations", { location: "Leiria", fuels: ["diesel"], limit: 3 });
  const covered = near.json.result?.municipalities_covered ?? [];
  check("find_stations(Leiria) succeeds", !near.response.isError);
  check(
    "results are in the searched concelho",
    covered.some((entry) => entry.municipality === "Leiria"),
    covered.map((entry) => entry.municipality).join(", "),
  );
  check(
    "neighbouring concelhos are included",
    covered.some((entry) => entry.municipality !== "Leiria"),
    `${covered.length} concelho(s) covered`,
  );
  check(
    "stations carry prices and distances",
    (near.json.result?.fuels?.[0]?.stations ?? []).every(
      (station) => typeof station.price_display === "string" && typeof station.distance_km === "number",
    ),
  );
  check("response reports cache age", typeof near.json.data_fetched_at === "string", near.json.data_fetched_at);

  const postcode = await call("find_stations", { location: "2400-193", limit: 1 });
  check(
    "postal code resolves without coordinates",
    !postcode.response.isError && postcode.json.query?.resolved?.kind === "postcode",
    postcode.json.query?.resolved?.label,
  );

  const missing = await call("find_stations", {});
  check(
    "missing search area returns validation_error",
    missing.response.isError === true && missing.json.error?.code === "validation_error",
  );

  const island = await call("find_stations", { latitude: 37.74, longitude: -25.67 });
  check(
    "island coordinates return unsupported_region",
    island.response.isError === true && island.json.error?.code === "unsupported_region",
  );

  const overview = await call("get_market_overview", { municipality: "Leiria", fuels: ["diesel"] });
  check(
    "market overview computes statistics",
    !overview.response.isError && typeof overview.json.result?.fuels?.[0]?.price_avg === "number",
    `avg ${overview.json.result?.fuels?.[0]?.price_avg}`,
  );

  const detail = await call("get_station_details", { station_name: "Intermarché Leiria" });
  const resolvedDetail = detail.json.result?.station ?? null;
  const candidateList = detail.json.result?.candidates ?? [];
  check(
    "station details resolve by name",
    !detail.response.isError && (resolvedDetail !== null || candidateList.length > 0),
    resolvedDetail ? resolvedDetail.name : `${candidateList.length} candidate(s)`,
  );

  const locations = await call("list_locations", { query: "Leiria" });
  check(
    "place lookup finds Leiria",
    !locations.response.isError &&
      (locations.json.result?.municipalities ?? []).some((entry) => entry.name === "Leiria"),
  );

  const history = await call("get_price_history", { fuels: ["diesel"], days: 7 });
  check(
    "price history returns daily points",
    !history.response.isError && (history.json.result?.fuels?.[0]?.points?.length ?? 0) > 0,
    `${history.json.result?.fuels?.[0]?.points?.length ?? 0} day(s)`,
  );

  const catalogue = await call("list_fuel_types", {});
  check("fuel catalogue is served", (catalogue.json.result?.fuels?.length ?? 0) >= 10);

  const programs = await call("list_discount_programs", {});
  const programList = programs.json.result?.programs ?? [];
  check(
    "discount catalogue is served from D1",
    !programs.response.isError && programList.length > 0,
    `${programList.length} programme(s)`,
  );
  check(
    "COMBINA is catalogued",
    programList.some((program) => program.program_id === "galp-combina"),
  );
  check(
    "programme status is derived, not stored",
    programList.every((program) => program.status === "active"),
    programList.map((program) => program.status).join(", "),
  );
  check(
    "every discount carries a description",
    programList.every((program) =>
      program.discounts.every((discount) => typeof discount.description === "string" && discount.description.length > 20),
    ),
  );
  check(
    "day-restricted programme carries its schedule",
    programList.some((program) =>
      program.discounts.some((discount) => discount.schedule?.kind === "nth_weekday_of_month"),
    ),
  );

  const expired = await call("list_discount_programs", { status: "expired" });
  check(
    "ended campaign derives expired status",
    (expired.json.result?.programs ?? []).some((program) => program.program_id === "bp-voltar-e-poupar"),
  );

  const discounted = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "galp",
    cards: ["continente_card", "mundo_galp_app"],
    services: ["galp_energy"],
    limit: 5,
  });
  const discountedStations = discounted.json.result?.fuels?.[0]?.stations ?? [];
  const withDiscount = discountedStations.filter((station) => station.discount);
  check(
    "declared cards unlock an effective price",
    withDiscount.length > 0,
    `${withDiscount.length}/${discountedStations.length} station(s)`,
  );
  check(
    "effective price never exceeds the list price",
    withDiscount.every((station) => station.discount.effective_price_eur <= station.price_eur),
  );

  const withoutCards = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "galp",
    limit: 3,
  });
  const noCardStations = withoutCards.json.result?.fuels?.[0]?.stations ?? [];
  check(
    "without cards the app discount is not applied",
    noCardStations.every((station) => !station.discount),
  );

  const repsol = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "repsol",
    cards: ["repsol_partner_card"],
    services: ["repsol_electricity"],
    limit: 3,
  });
  const repsolStations = repsol.json.result?.fuels?.[0]?.stations ?? [];
  check(
    "Repsol tier applies with card + electricity contract",
    repsolStations.some((station) => station.discount?.applied_cents === 13),
    repsolStations.map((station) => station.discount?.applied_cents ?? 0).join(", "),
  );

  const bp = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "bp",
    cards: ["poupa_mais_card"],
    limit: 3,
  });
  const bpStations = bp.json.result?.fuels?.[0]?.stations ?? [];
  check(
    "BP Poupa Mais applies with the Pingo Doce card",
    bpStations.some((station) => station.discount?.applied_cents === 4),
    bpStations.map((station) => station.discount?.applied_cents ?? 0).join(", "),
  );

  const intermarche = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "intermarche",
    cards: ["intermarche_card"],
    limit: 3,
  });
  const imStations = intermarche.json.result?.fuels?.[0]?.stations ?? [];
  const scheduled = imStations.filter((station) => (station.scheduled_discounts ?? []).length > 0);
  check(
    "day-restricted offer is surfaced with its schedule and next date",
    scheduled.length > 0 || imStations.some((station) => station.discount?.applies_today === true),
    scheduled
      .map((station) => station.scheduled_discounts[0].next_date)
      .join(", "),
  );

  const lidlLinked = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "repsol",
    cards: ["lidl_plus", "my_repsol"],
    limit: 3,
  });
  const linkedStations = lidlLinked.json.result?.fuels?.[0]?.stations ?? [];
  check(
    "Lidl Plus × Repsol yields 10 c/L when My Repsol is linked",
    linkedStations.some(
      (station) => station.discount?.program_id === "repsol-lidl-plus" && station.discount.applied_cents === 10,
    ),
    linkedStations.map((station) => station.discount?.applied_cents ?? 0).join(", "),
  );

  const lidlAppOnly = await call("find_stations", {
    location: "Leiria",
    fuels: ["diesel"],
    brand: "repsol",
    cards: ["lidl_plus"],
    limit: 3,
  });
  const appOnlyStations = lidlAppOnly.json.result?.fuels?.[0]?.stations ?? [];
  check(
    "Lidl Plus on its own yields 6 c/L",
    appOnlyStations.some(
      (station) => station.discount?.program_id === "repsol-lidl-plus" && station.discount.applied_cents === 6,
    ),
    appOnlyStations.map((station) => station.discount?.applied_cents ?? 0).join(", "),
  );

  await client.close();

  // ---- REST API and dashboard shell -------------------------------------
  const origin = new URL(url).origin;

  const getJson = async (path) => {
    const response = await fetch(origin + path);
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  };

  const meta = await getJson("/api/meta");
  check(
    "REST /api/meta returns the fuel catalogue",
    meta.status === 200 && (meta.body?.fuels?.length ?? 0) >= 10,
    `${meta.body?.fuels?.length ?? 0} fuels, v${meta.body?.version ?? "?"}`,
  );

  const stationsApi = await getJson("/api/stations?location=Leiria&fuels=diesel&limit=2");
  check(
    "REST /api/stations returns priced stations",
    stationsApi.status === 200 && (stationsApi.body?.result?.fuels?.[0]?.stations?.length ?? 0) > 0,
  );

  const discountsApi = await getJson("/api/discounts");
  check(
    "REST /api/discounts returns programmes",
    discountsApi.status === 200 && (discountsApi.body?.result?.programs?.length ?? 0) > 0,
    `${discountsApi.body?.result?.programs?.length ?? 0} programmes`,
  );

  const historyApi = await getJson("/api/history?fuels=diesel&days=7");
  check(
    "REST /api/history returns history points",
    historyApi.status === 200 && (historyApi.body?.result?.fuels?.[0]?.points?.length ?? 0) > 0,
  );

  const badApi = await fetch(origin + "/api/stations?limit=abc");
  check("REST validation errors are 400", badApi.status === 400, `HTTP ${badApi.status}`);

  const shell = await fetch(origin + "/");
  const shellHtml = await shell.text();
  check(
    "dashboard shell is served at /",
    shell.status === 200 && shellHtml.includes('<div id="app">'),
  );

  const deepLink = await fetch(origin + "/discounts");
  check(
    "SPA deep link falls back to the shell",
    deepLink.status === 200 && (await deepLink.text()).includes('<div id="app">'),
  );

  const manifest = await fetch(origin + "/manifest.webmanifest");
  check("PWA manifest is served", manifest.status === 200);

  const serviceWorker = await fetch(origin + "/sw.js");
  check("service worker is served", serviceWorker.status === 200);

  const docs = await fetch(origin + "/docs");
  check(
    "/docs serves the MCP documentation",
    docs.status === 200 && (await docs.text()).includes("cheaper-fuel"),
  );

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nSmoke test crashed: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
