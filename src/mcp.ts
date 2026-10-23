import { McpServer } from "@modelcontextprotocol/server";

import { AppError } from "./dgeg";
import { SERVER_NAME, SERVER_VERSION, type Env } from "./env";
import {
  findStations,
  getMarketOverview,
  getPriceHistory,
  getStationDetails,
  listDiscountPrograms,
  listFuelTypes,
  listLocations,
  ToolError,
} from "./service";
import {
  discountProgramsInput,
  findStationsInput,
  listFuelTypesInput,
  listLocationsInput,
  marketOverviewInput,
  priceHistoryInput,
  stationDetailsInput,
} from "./tool-inputs";

const SERVER_INSTRUCTIONS = [
  "cheaper-fuel answers questions about fuel prices at stations in mainland Portugal,",
  "using data published by DGEG (the Portuguese energy authority).",
  "",
  "Routing — pick the tool that matches the intent and call it once:",
  "- cheapest fuel near a place, a postal code or \"near me\" → find_stations (pass `location`)",
  "- cheapest fuel in a concelho/district, or from a specific brand → find_stations (`municipality`/`district`/`brand`)",
  "- discounts, loyalty cards, or \"cheapest with my Continente card\" → find_stations (pass `cards`/`services`)",
  "- which discount programmes exist → list_discount_programs",
  "- national or regional averages, min/max/median → get_market_overview",
  "- how prices changed over time → get_price_history (national daily averages only)",
  "- opening hours, services or payment methods of one station → get_station_details",
  "",
  "Rules:",
  "- Never call list_fuel_types or list_locations before find_stations. Every tool accepts fuel,",
  "  concelho and brand names and resolves them internally; numeric ids are optional.",
  "- If you have no location and the user did not give one, ask once for a city or postal code,",
  "  then make a single find_stations call. Do not ask for latitude/longitude.",
  "- find_stations already returns prices, addresses, coordinates, distances, map links and",
  "  freshness. Do not follow up with get_station_details unless hours/services/payments are asked for.",
  "- Prices are cached for up to 24 hours. Every response carries `data_fetched_at` (our fetch time)",
  "  and each station's `last_updated` (when the operator published it). Say the prices are",
  "  \"as published by DGEG\", never \"real-time\".",
  "- Coverage is mainland Portugal only: the Azores and Madeira are not included.",
  "- Discounts are conditional and advisory. Ask once which cards/services the user holds and pass them",
  "  as `cards`/`services` to find_stations. Only high-confidence programmes affect effective_price;",
  "  anything else is returned as possible_discounts to verify. Never add catalogue discounts to the",
  "  DGEG observed average — they are different measures.",
  "- Report prices using `price_display` (e.g. \"1,929 €/litro\").",
].join("\n");

function errorResponse(code: string, message: string, details?: Record<string, unknown>, hint?: string) {
  const payload: Record<string, unknown> = {
    error: { code, message, ...(hint ? { hint } : {}), ...(details ?? {}) },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

async function runTool(fn: () => Promise<unknown>) {
  try {
    const payload = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof ToolError) {
      return errorResponse(error.code, error.message, error.details);
    }
    if (error instanceof AppError) {
      return errorResponse(error.code, error.message, undefined, error.hint);
    }
    return errorResponse(
      "internal_error",
      error instanceof Error ? error.message : String(error),
      undefined,
      "Retry the call; if it keeps failing the DGEG upstream may be unavailable.",
    );
  }
}

export function createServer(env: Env): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: "cheaper-fuel — Portugal fuel prices" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "find_stations",
    {
      title: "Find fuel stations and prices",
      description:
        "Find the cheapest fuel stations by proximity (near a city, postal code, coordinates or \"near me\") " +
        "or within a concelho/district. Proximity searches automatically widen the radius to cover the " +
        "neighbouring concelhos and report which concelhos were included. Accepts friendly fuel names " +
        "(diesel, 95, 98, gpl) and defaults to Gasóleo simples + Gasolina simples 95. " +
        "Returns prices, addresses, coordinates, distances, map links and timestamps in one call. " +
        "No prerequisite lookup is needed.",
      inputSchema: findStationsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => findStations(env, args)),
  );

  server.registerTool(
    "get_station_details",
    {
      title: "Get one station's full details",
      description:
        "Full detail for a single station: every fuel it sells with prices, opening hours, services, " +
        "payment methods and address. Pass station_id, or station_name to look it up by name. " +
        "Only needed for hours/services/payments — find_stations already returns prices and locations.",
      inputSchema: stationDetailsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => getStationDetails(env, args)),
  );

  server.registerTool(
    "get_market_overview",
    {
      title: "Market overview: prices and spread",
      description:
        "Per-fuel statistics (count, min, average, median, max) nationally or for a concelho/district, " +
        "plus the three cheapest stations for each fuel. Use for \"how much is diesel in Portugal?\" or " +
        "\"what's the spread in Porto?\".",
      inputSchema: marketOverviewInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => getMarketOverview(env, args)),
  );

  server.registerTool(
    "get_price_history",
    {
      title: "Fuel price history",
      description:
        "Daily national average prices for one or more fuels, with min/max range, number of stations and " +
        "the change over the period. Also reports the observed discount (the gap between DGEG's undiscounted " +
        "and discounted averages). Use for trends (\"how has diesel changed this month?\"). " +
        "DGEG publishes this series nationally only — there is no per-concelho or per-station history.",
      inputSchema: priceHistoryInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => getPriceHistory(env, args)),
  );

  server.registerTool(
    "list_discount_programs",
    {
      title: "List discount programmes",
      description:
        "The standardized discount catalogue stored in D1: supplier, retail partners, mechanics, caps, " +
        "requirements, validity window and provenance. Activeness is always derived from validFrom/validUntil, " +
        "never stored. Use this to explain how a deal works; find_stations already applies the programmes the " +
        "user qualifies for.",
      inputSchema: discountProgramsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => listDiscountPrograms(env, args)),
  );

  server.registerTool(
    "list_fuel_types",
    {
      title: "List fuel types",
      description:
        "The fuel catalogue: DGEG id, display name, unit of measure and whether it is a road fuel. " +
        "Optional — find_stations, get_market_overview and get_price_history already accept fuel names.",
      inputSchema: listFuelTypesInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => listFuelTypes(env, args)),
  );

  server.registerTool(
    "list_locations",
    {
      title: "Resolve place names",
      description:
        "Look up concelhos, localities and postal codes so you can pass an exact place to find_stations. " +
        "Only needed to disambiguate an unclear name — find_stations resolves place names by itself.",
      inputSchema: listLocationsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => runTool(() => listLocations(env, args)),
  );

  return server;
}
