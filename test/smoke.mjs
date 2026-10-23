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

  const history = await call("get_price_history", { fuels: ["diesel"], days: 7 });
  check(
    "price history returns daily points",
    !history.response.isError && (history.json.result?.fuels?.[0]?.points?.length ?? 0) > 0,
    `${history.json.result?.fuels?.[0]?.points?.length ?? 0} day(s)`,
  );

  const catalogue = await call("list_fuel_types", {});
  check("fuel catalogue is served", (catalogue.json.result?.fuels?.length ?? 0) >= 10);

  await client.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nSmoke test crashed: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
