/**
 * Read-only JSON API used by the dashboard. Every route delegates to the same
 * service functions the MCP tools call, so the two surfaces cannot drift.
 */
import { ZodError } from "zod";

import { AppError } from "./dgeg";
import type { Env } from "./env";
import {
  findStations,
  getMarketOverview,
  getMeta,
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

const CACHE_HEADER = "public, max-age=300";

const STATUS_BY_CODE: Record<string, number> = {
  validation_error: 400,
  unknown_fuel: 400,
  unknown_brand: 400,
  unknown_district: 400,
  unknown_municipality: 400,
  unknown_location: 400,
  ambiguous_location: 400,
  station_not_found: 404,
  unsupported_region: 422,
  upstream_error: 502,
  timeout: 502,
  discounts_unavailable: 503,
};

function jsonResponse(body: unknown, status = 200, cache = CACHE_HEADER): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      "access-control-allow-origin": "*",
    },
  });
}

function errorResponse(status: number, body: Record<string, unknown>): Response {
  return jsonResponse({ error: body }, status, "no-store");
}

function textParam(search: URLSearchParams, key: string): string | undefined {
  const value = search.get(key);
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function listParam(search: URLSearchParams, key: string): string[] | undefined {
  const values = search
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

export function numberParam(search: URLSearchParams, key: string): number | undefined {
  const value = textParam(search, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  // NaN is passed through on purpose so the shared schema reports it.
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/** Station requests accept a count, or "all" for everything inside the radius. */
export function stationLimitParam(search: URLSearchParams): number | "all" | undefined {
  const value = textParam(search, "limit");
  if (value === undefined) return undefined;
  if (value.toLowerCase() === "all") return "all";
  const parsed = Number(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export function booleanParam(search: URLSearchParams, key: string): boolean | undefined {
  const value = textParam(search, key)?.toLowerCase();
  if (value === undefined) return undefined;
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  return undefined;
}

function discountParams(search: URLSearchParams) {
  return {
    cards: listParam(search, "cards"),
    services: listParam(search, "services"),
    discount_mode: textParam(search, "discount_mode"),
    fill_litres: numberParam(search, "fill_litres"),
    lang: textParam(search, "lang"),
  };
}

export function stationsQuery(search: URLSearchParams) {
  return {
    location: textParam(search, "location"),
    latitude: numberParam(search, "latitude"),
    longitude: numberParam(search, "longitude"),
    municipality: textParam(search, "municipality"),
    district: textParam(search, "district"),
    fuels: listParam(search, "fuels"),
    brand: textParam(search, "brand"),
    station_type: textParam(search, "station_type"),
    radius_km: numberParam(search, "radius_km"),
    max_radius_km: numberParam(search, "max_radius_km"),
    limit: stationLimitParam(search),
    min_price: numberParam(search, "min_price"),
    max_price: numberParam(search, "max_price"),
    updated_within_hours: numberParam(search, "updated_within_hours"),
    sort: textParam(search, "sort"),
    sort_order: textParam(search, "sort_order"),
    ...discountParams(search),
  };
}

function marketQuery(search: URLSearchParams) {
  return {
    fuels: listParam(search, "fuels"),
    district: textParam(search, "district"),
    municipality: textParam(search, "municipality"),
  };
}

export function historyQuery(search: URLSearchParams) {
  return {
    fuels: listParam(search, "fuels"),
    days: numberParam(search, "days"),
    from: textParam(search, "from"),
    to: textParam(search, "to"),
  };
}

function discountQuery(search: URLSearchParams) {
  return {
    supplier: textParam(search, "supplier"),
    partner: textParam(search, "partner"),
    kind: textParam(search, "kind"),
    status: textParam(search, "status"),
    quantified_only: booleanParam(search, "quantified_only"),
    lang: textParam(search, "lang"),
  };
}

function locationsQuery(search: URLSearchParams) {
  return {
    query: textParam(search, "query"),
    district: textParam(search, "district"),
    limit: numberParam(search, "limit"),
  };
}

function zodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return errorResponse(405, {
      code: "method_not_allowed",
      message: "This API is read-only; only GET is supported.",
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/api";
  const search = url.searchParams;

  try {
    if (path === "/api" || path === "/api/") {
      return jsonResponse({
        name: "cheaper-fuel",
        endpoints: [
          "/api/meta",
          "/api/stations",
          "/api/stations/:id",
          "/api/market",
          "/api/history",
          "/api/discounts",
          "/api/fuels",
          "/api/locations",
        ],
      });
    }

    if (path === "/api/meta") return jsonResponse(await getMeta(env));

    if (path === "/api/stations") {
      return jsonResponse(await findStations(env, findStationsInput.parse(stationsQuery(search))));
    }

    const stationMatch = /^\/api\/stations\/(\d+)$/.exec(path);
    if (stationMatch) {
      const input = stationDetailsInput.parse({
        ...discountParams(search),
        station_id: Number(stationMatch[1]),
      });
      return jsonResponse(await getStationDetails(env, input));
    }

    if (path === "/api/market") {
      return jsonResponse(await getMarketOverview(env, marketOverviewInput.parse(marketQuery(search))));
    }

    if (path === "/api/history") {
      return jsonResponse(await getPriceHistory(env, priceHistoryInput.parse(historyQuery(search))));
    }

    if (path === "/api/discounts") {
      return jsonResponse(await listDiscountPrograms(env, discountProgramsInput.parse(discountQuery(search))));
    }

    if (path === "/api/fuels") {
      return jsonResponse(await listFuelTypes(env, listFuelTypesInput.parse({ road_only: booleanParam(search, "road_only") })));
    }

    if (path === "/api/locations") {
      return jsonResponse(await listLocations(env, listLocationsInput.parse(locationsQuery(search))));
    }

    return errorResponse(404, {
      code: "not_found",
      message: `Unknown API route: ${path}`,
      hint: "GET /api lists the available endpoints.",
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, {
        code: "validation_error",
        message: "The query parameters are invalid.",
        issues: zodIssues(error),
      });
    }
    if (error instanceof ToolError) {
      return errorResponse(STATUS_BY_CODE[error.code] ?? 400, {
        code: error.code,
        message: error.message,
        ...(error.details ?? {}),
      });
    }
    if (error instanceof AppError) {
      return errorResponse(STATUS_BY_CODE[error.code] ?? 500, {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      });
    }
    return errorResponse(500, {
      code: "internal_error",
      message: error instanceof Error ? error.message : String(error),
      hint: "Retry the request; if it keeps failing the DGEG upstream may be unavailable.",
    });
  }
}
