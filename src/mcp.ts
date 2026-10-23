import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { SERVER_NAME, SERVER_VERSION, type Env } from "./env";
import {
  buildDateRange,
  formatPrice,
  fuelAlias,
  isWithinHours,
  MAINLAND_NOTE,
  mapsUrl,
  matchByName,
  normalizeText,
  roundTo,
  SOURCE,
  summarize,
} from "./domain";
import {
  AppError,
  createDgegContext,
  getBrands,
  getDailyHistory,
  getDistricts,
  getFuelTypes,
  getMunicipalities,
  getStationDetail,
  type DgegContext,
  type District,
  type FuelType,
  type HistoryRow,
  type Municipality,
} from "./dgeg";
import { loadSnapshot, type Snapshot, type SnapshotRow } from "./snapshot";
import { buildPlaceIndex, resolveLocation, type PlaceIndex, type ResolvedLocation } from "./places";
import {
  countStations,
  municipalitiesCovered,
  searchProximity,
  sortByPrice,
  type RowWithDistance,
} from "./geo";

const DEFAULT_FUELS = ["Gasóleo simples", "Gasolina simples 95"];
const OVERVIEW_FUELS = ["Gasóleo simples", "Gasolina simples 95", "Gasolina 98"];
const MAINLAND_BOUNDS = { minLat: 36.8, maxLat: 42.2, minLon: -9.7, maxLon: -6.1 };

const SERVER_INSTRUCTIONS = [
  "cheaper-fuel answers questions about fuel prices at stations in mainland Portugal,",
  "using data published by DGEG (the Portuguese energy authority).",
  "",
  "Routing — pick the tool that matches the intent and call it once:",
  "- cheapest fuel near a place, a postal code or \"near me\" → find_stations (pass `location`)",
  "- cheapest fuel in a concelho/district, or from a specific brand → find_stations (`municipality`/`district`/`brand`)",
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
  "- Report prices using `price_display` (e.g. \"1,929 €/litro\").",
].join("\n");

class ToolError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

function errorResponse(code: string, message: string, details?: Record<string, unknown>, hint?: string) {
  const payload: Record<string, unknown> = { error: { code, message, ...(hint ? { hint } : {}), ...(details ?? {}) } };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

async function runTool(fn: () => Promise<Record<string, unknown>>) {
  try {
    const payload = await fn();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
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

let placeIndexMemo: { fetchedAt: string; index: PlaceIndex } | null = null;

function getPlaceIndex(snapshot: Snapshot): PlaceIndex {
  if (!placeIndexMemo || placeIndexMemo.fetchedAt !== snapshot.fetchedAt) {
    placeIndexMemo = { fetchedAt: snapshot.fetchedAt, index: buildPlaceIndex(snapshot) };
  }
  return placeIndexMemo.index;
}

interface Base {
  snapshot: Snapshot;
  fuels: FuelType[];
  places: PlaceIndex;
}

async function loadBase(ctx: DgegContext): Promise<Base> {
  const [snapshot, fuels] = await Promise.all([loadSnapshot(ctx), getFuelTypes(ctx)]);
  return { snapshot, fuels, places: getPlaceIndex(snapshot) };
}

function resolveFuels(fuels: FuelType[], requested: string[] | undefined, fallback: string[]): FuelType[] {
  const wanted = requested && requested.length > 0 ? requested : fallback;
  const resolved: FuelType[] = [];
  const unknown: string[] = [];

  for (const item of wanted) {
    const trimmed = item.trim();
    let fuel: FuelType | undefined;

    if (/^\d+$/.test(trimmed)) {
      fuel = fuels.find((candidate) => candidate.id === Number(trimmed));
    } else {
      const result = matchByName(fuels, trimmed, (candidate) => candidate.name, { alias: fuelAlias });
      fuel = result.match ?? result.candidates[0];
    }

    if (!fuel) unknown.push(item);
    else if (!resolved.some((existing) => existing.id === fuel!.id)) resolved.push(fuel);
  }

  if (unknown.length > 0) {
    throw new ToolError("unknown_fuel", `Unknown fuel: ${unknown.join(", ")}.`, {
      valid_fuels: fuels.map((fuel) => ({ id: fuel.id, name: fuel.name, unit: fuel.unit })),
      hint: "Fuels are matched by name; you can also pass friendly names like \"diesel\", \"95\", \"98\" or \"gpl\".",
    });
  }

  return resolved;
}

async function resolveRegion(
  ctx: DgegContext,
  args: { district?: string; municipality?: string },
): Promise<{ district: District | null; municipality: Municipality | null }> {
  let district: District | null = null;
  let municipality: Municipality | null = null;

  if (args.district) {
    const districts = await getDistricts(ctx);
    const result = matchByName(districts, args.district, (entry) => entry.name);
    if (!result.match) {
      throw new ToolError("unknown_district", `Unknown district "${args.district}".`, {
        valid_districts: districts.map((entry) => entry.name),
      });
    }
    district = result.match;
  }

  if (args.municipality) {
    const all = await getMunicipalities(ctx);
    const pool = district ? all.filter((entry) => entry.districtId === district!.id) : all;
    const result = matchByName(pool, args.municipality, (entry) => entry.name);
    if (!result.match) {
      throw new ToolError(
        "unknown_municipality",
        district
          ? `Unknown concelho "${args.municipality}" in ${district.name}.`
          : `Unknown concelho "${args.municipality}".`,
        {
          candidates: result.candidates.map((entry) => entry.name).slice(0, 10),
          hint: "Use list_locations with a search term if you need the exact spelling.",
        },
      );
    }
    municipality = result.match;
    if (!district) district = { id: municipality.districtId, name: municipality.districtName };
  }

  return { district, municipality };
}

async function resolveBrandName(ctx: DgegContext, input: string): Promise<string> {
  const brands = await getBrands(ctx);
  const result = matchByName(brands, input, (entry) => entry.name);
  if (result.match) return result.match.name;

  throw new ToolError("unknown_brand", `Unknown brand "${input}".`, {
    candidates: result.candidates.map((entry) => entry.name).slice(0, 10),
    hint: "Brands are matched by name; try a shorter fragment such as \"galp\" or \"bp\".",
  });
}

interface RowFilters {
  fuelNames: string[];
  brandName?: string | null;
  stationType?: "autoestrada" | "supermercado" | "outro";
  minPrice?: number;
  maxPrice?: number;
  updatedWithinHours?: number;
}

function matchesStationType(row: SnapshotRow, wanted: NonNullable<RowFilters["stationType"]>): boolean {
  const value = normalizeText(row.stationType ?? "");
  const isHighway = value.includes("auto estrada") || value.includes("autoestrada");
  const isRetail = value.includes("comercial") || value.includes("hipermercado");
  if (wanted === "autoestrada") return isHighway;
  if (wanted === "supermercado") return isRetail;
  return !isHighway && !isRetail;
}

function filterRows(rows: readonly SnapshotRow[], filters: RowFilters): SnapshotRow[] {
  const fuelKeys = new Set(filters.fuelNames.map((name) => normalizeText(name)));
  const brandKey = filters.brandName ? normalizeText(filters.brandName) : null;
  const now = new Date();

  return rows.filter((row) => {
    if (!fuelKeys.has(normalizeText(row.fuel))) return false;
    if (brandKey) {
      const rowBrand = normalizeText(row.brand ?? "");
      if (!rowBrand.includes(brandKey) && !brandKey.includes(rowBrand)) return false;
    }
    if (filters.stationType && !matchesStationType(row, filters.stationType)) return false;
    if (filters.minPrice !== undefined && (row.price ?? Number.POSITIVE_INFINITY) < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && (row.price ?? Number.POSITIVE_INFINITY) > filters.maxPrice) return false;
    if (filters.updatedWithinHours !== undefined && !isWithinHours(row.updated, filters.updatedWithinHours, now)) return false;
    return true;
  });
}

function isOutsideMainland(lat: number, lon: number): boolean {
  return (
    lat < MAINLAND_BOUNDS.minLat ||
    lat > MAINLAND_BOUNDS.maxLat ||
    lon < MAINLAND_BOUNDS.minLon ||
    lon > MAINLAND_BOUNDS.maxLon
  );
}

function stationPayload(row: SnapshotRow & { distanceKm?: number }, unit: string | null) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    price_eur: row.price,
    price_display: formatPrice(row.price, unit),
    unit,
    ...(row.distanceKm !== undefined ? { distance_km: roundTo(row.distanceKm, 2) } : {}),
    address: {
      street: row.address,
      locality: row.locality,
      postal_code: row.postalCode,
      municipality: row.municipality,
      district: row.district,
    },
    coordinates: { latitude: row.lat, longitude: row.lon },
    station_type: row.stationType,
    last_updated: row.updated,
    maps_url: mapsUrl(row.lat, row.lon),
  };
}

function resolveLocationOrThrow(places: PlaceIndex, input: string): ResolvedLocation {
  const result = resolveLocation(places, input);
  if (result.ok) return result.location;

  throw new ToolError(
    result.reason === "ambiguous" ? "ambiguous_location" : "unknown_location",
    result.hint,
    {
      candidates: result.candidates.map((candidate) => ({
        place: candidate.value,
        municipality: candidate.municipality,
        district: candidate.district,
        kind: candidate.kind,
      })),
    },
  );
}

function countForFuel(rows: readonly RowWithDistance[], fuelName: string): number {
  const key = normalizeText(fuelName);
  return rows.filter((row) => normalizeText(row.fuel) === key).length;
}

export function createServer(env: Env): McpServer {
  const ctx = createDgegContext(env);
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
      inputSchema: z.object({
        location: z
          .string()
          .min(1)
          .optional()
          .describe('Where to search: city/concelho ("Leiria"), locality, postal code ("2400-193" or "2400"), or "lat,lon".'),
        latitude: z.number().min(-90).max(90).optional().describe("Latitude, when the client already knows the position."),
        longitude: z.number().min(-180).max(180).optional().describe("Longitude, paired with latitude."),
        municipality: z.string().optional().describe('Restrict to one concelho, e.g. "Leiria". Region mode.'),
        district: z.string().optional().describe('Restrict to one district, e.g. "Lisboa". Region mode.'),
        fuels: z
          .array(z.string())
          .min(1)
          .max(5)
          .optional()
          .describe('Fuel names or ids, e.g. ["diesel"], ["gasolina 95", "98"]. Defaults to diesel + petrol 95.'),
        brand: z.string().optional().describe('Brand name fragment, e.g. "galp", "bp", "pingo doce".'),
        station_type: z
          .enum(["autoestrada", "supermercado", "outro"])
          .optional()
          .describe("highway, supermarket/retail park, or other."),
        radius_km: z.number().min(1).max(60).optional().describe("Initial search radius. Default 15."),
        max_radius_km: z.number().min(1).max(80).optional().describe("Upper bound for automatic widening. Default 40."),
        limit: z.number().int().min(1).max(25).optional().describe("Results per fuel. Default 5."),
        min_price: z.number().min(0).optional().describe("Only stations at or above this price (€)."),
        max_price: z.number().min(0).optional().describe("Only stations at or below this price (€)."),
        updated_within_hours: z
          .number()
          .min(1)
          .max(8760)
          .optional()
          .describe("Only prices updated within this many hours, e.g. 24."),
        sort: z.enum(["distance", "price"]).optional().describe("Rank by distance (default in proximity) or price."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const { snapshot, fuels: allFuels, places } = await loadBase(ctx);
        const fuels = resolveFuels(allFuels, args.fuels, DEFAULT_FUELS);
        const fuelNames = fuels.map((fuel) => fuel.name);

        const hasLatLon = args.latitude !== undefined && args.longitude !== undefined;
        const hasPartialCoords = (args.latitude === undefined) !== (args.longitude === undefined);
        const hasLocation = typeof args.location === "string" && args.location.trim().length > 0;
        const hasRegion = args.municipality !== undefined || args.district !== undefined;

        if (hasPartialCoords) {
          throw new ToolError("validation_error", "latitude and longitude must be provided together.", {
            example: { location: "Leiria", fuels: ["diesel"] },
          });
        }
        if (hasLatLon && hasLocation) {
          throw new ToolError("validation_error", "Use either location or latitude+longitude, not both.", {
            example: { location: "Leiria" },
          });
        }
        if ((hasLatLon || hasLocation) && hasRegion) {
          throw new ToolError(
            "validation_error",
            "Do not combine a proximity location with municipality/district.",
            {
              hint: 'For "near Leiria" pass location; for "cheapest in Leiria" pass municipality.',
              example: { municipality: "Leiria", fuels: ["diesel"] },
            },
          );
        }
        if (!hasLatLon && !hasLocation && !hasRegion) {
          throw new ToolError("validation_error", "No search area provided.", {
            hint: "Pass location for a proximity search, or municipality/district for a regional ranking.",
            examples: [
              { location: "Leiria", fuels: ["diesel"] },
              { location: "2400-193" },
              { municipality: "Leiria", fuels: ["gasolina 95"], sort: "price" },
            ],
          });
        }

        let brandName: string | null = null;
        if (args.brand) brandName = await resolveBrandName(ctx, args.brand);

        const filtered = filterRows(snapshot.rows, {
          fuelNames,
          brandName,
          stationType: args.station_type,
          minPrice: args.min_price,
          maxPrice: args.max_price,
          updatedWithinHours: args.updated_within_hours,
        });

        const limit = args.limit ?? 5;

        if (hasLatLon || hasLocation) {
          let point: ResolvedLocation;
          if (hasLatLon) {
            const lat = args.latitude as number;
            const lon = args.longitude as number;
            if (isOutsideMainland(lat, lon)) {
              throw new ToolError(
                "unsupported_region",
                "Those coordinates are outside mainland Portugal, which is the only area DGEG covers.",
                { mainland_note: MAINLAND_NOTE, hint: "Pass a mainland city or postal code instead." },
              );
            }
            point = {
              label: `${lat}, ${lon}`,
              kind: "coordinates",
              lat,
              lon,
              municipality: null,
              district: null,
            };
          } else {
            point = resolveLocationOrThrow(places, args.location as string);
          }

          if (isOutsideMainland(point.lat, point.lon)) {
            throw new ToolError(
              "unsupported_region",
              `"${point.label}" is outside mainland Portugal, which is the only area DGEG covers.`,
              { mainland_note: MAINLAND_NOTE },
            );
          }

          const radiusKm = args.radius_km ?? 15;
          const maxRadiusKm = Math.max(radiusKm, args.max_radius_km ?? 40);
          const sort = args.sort ?? "distance";

          const proximity = searchProximity({
            rows: filtered,
            fuelNames,
            point,
            radiusKm,
            maxRadiusKm,
            limitPerFuel: limit,
            sort,
          });

          const fuelResults = fuels.map((fuel) => {
            const unit = fuel.unit;
            const matched = countForFuel(proximity.withinRadius, fuel.name);
            return {
              fuel: fuel.name,
              unit,
              stations_found: matched,
              stations: (proximity.byFuel.get(fuel.name) ?? []).map((row) => stationPayload(row, unit)),
            };
          });

          const covered = municipalitiesCovered(proximity.withinRadius);
          const totalStations = countStations(proximity.withinRadius);

          const payload: Record<string, unknown> = {
            source: SOURCE,
            data_fetched_at: snapshot.fetchedAt,
            query: {
              mode: "proximity",
              location: point.label,
              resolved: {
                kind: point.kind,
                latitude: point.lat,
                longitude: point.lon,
                municipality: point.municipality,
                district: point.district,
              },
              fuels: fuelNames,
              radius_km: radiusKm,
              max_radius_km: maxRadiusKm,
              limit_per_fuel: limit,
              sort,
              brand: brandName,
              station_type: args.station_type ?? null,
            },
            result: {
              mode: "proximity",
              effective_radius_km: proximity.effectiveRadiusKm,
              fuels: fuelResults,
              municipalities_covered: covered,
              stations_in_radius: totalStations,
            },
          };

          if (totalStations === 0) {
            payload.result = {
              ...(payload.result as Record<string, unknown>),
              note:
                `No prices found within ${proximity.effectiveRadiusKm} km. Widen max_radius_km, ` +
                `drop the brand/price filters, or check the place name. ${MAINLAND_NOTE}`,
            };
          }

          return payload;
        }

        const region = await resolveRegion(ctx, { district: args.district, municipality: args.municipality });
        const municipalityKey = region.municipality ? normalizeText(region.municipality.name) : null;
        const districtKey = region.district ? normalizeText(region.district.name) : null;

        const regionRows = filtered.filter((row) => {
          if (municipalityKey && normalizeText(row.municipality) !== municipalityKey) return false;
          if (districtKey && normalizeText(row.district) !== districtKey) return false;
          return true;
        });

        const sort = args.sort ?? "price";
        const fuelResults = fuels.map((fuel) => {
          const unit = fuel.unit;
          const rowsForFuel = regionRows.filter((row) => normalizeText(row.fuel) === normalizeText(fuel.name));
          const cheapest =
            sort === "price"
              ? sortByPrice(rowsForFuel, limit)
              : [...rowsForFuel].sort((a, b) => a.name.localeCompare(b.name, "pt")).slice(0, limit);

          return {
            fuel: fuel.name,
            unit,
            stations_found: rowsForFuel.length,
            stations: cheapest.map((row) => stationPayload(row, unit)),
          };
        });

        return {
          source: SOURCE,
          data_fetched_at: snapshot.fetchedAt,
          query: {
            mode: "region",
            district: region.district?.name ?? null,
            municipality: region.municipality?.name ?? null,
            fuels: fuelNames,
            limit_per_fuel: limit,
            sort,
            brand: brandName,
            station_type: args.station_type ?? null,
          },
          result: {
            mode: "region",
            fuels: fuelResults,
            municipalities_covered: municipalitiesCovered(regionRows),
            stations_matched: countStations(regionRows),
          },
        };
      }),
  );

  server.registerTool(
    "get_station_details",
    {
      title: "Get one station's full details",
      description:
        "Full detail for a single station: every fuel it sells with prices, opening hours, services, " +
        "payment methods and address. Pass station_id, or station_name to look it up by name. " +
        "Only needed for hours/services/payments — find_stations already returns prices and locations.",
      inputSchema: z.object({
        station_id: z.number().int().positive().optional().describe("DGEG station id, as returned by find_stations."),
        station_name: z.string().min(2).optional().describe("Station name or fragment, e.g. \"Repsol Leiria\"."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const hasId = args.station_id !== undefined;
        const hasName = typeof args.station_name === "string" && args.station_name.trim().length > 0;
        if (hasId === hasName) {
          throw new ToolError("validation_error", "Provide exactly one of station_id or station_name.", {
            examples: [{ station_id: 65053 }, { station_name: "Intermarché Leiria" }],
          });
        }

        const snapshot = await loadSnapshot(ctx);
        let stationId: number;

        if (hasId) {
          stationId = args.station_id as number;
        } else {
          const key = normalizeText(args.station_name as string);
          const matches = snapshot.rows.filter((row) => normalizeText(row.name).includes(key));
          const unique = [...new Map(matches.map((row) => [row.id, row])).values()];

          if (unique.length === 0) {
            throw new ToolError("station_not_found", `No station matched "${args.station_name}".`, {
              hint: "Use find_stations to see station names near a place.",
            });
          }
          if (unique.length > 1) {
            return {
              source: SOURCE,
              data_fetched_at: snapshot.fetchedAt,
              query: { station_name: args.station_name },
              result: {
                ambiguous: true,
                candidates: unique.slice(0, 10).map((row) => ({
                  station_id: row.id,
                  name: row.name,
                  brand: row.brand,
                  municipality: row.municipality,
                  district: row.district,
                })),
                hint: "Call get_station_details again with the station_id you want.",
              },
            };
          }
          stationId = unique[0].id;
        }

        const detail = await getStationDetail(ctx, stationId);
        if (!detail) {
          throw new ToolError("station_not_found", `Station ${stationId} was not found on DGEG.`, {
            hint: "Ids come from find_stations results.",
          });
        }

        return {
          source: SOURCE,
          data_fetched_at: snapshot.fetchedAt,
          query: { station_id: stationId },
          result: {
            station: {
              ...detail,
              fuels: detail.fuels.map((fuel) => ({
                ...fuel,
                price_display: formatPrice(fuel.price, fuel.unit),
              })),
              maps_url:
                detail.address.latitude !== null && detail.address.longitude !== null
                  ? mapsUrl(detail.address.latitude, detail.address.longitude)
                  : null,
            },
          },
        };
      }),
  );

  server.registerTool(
    "get_market_overview",
    {
      title: "Market overview: prices and spread",
      description:
        "Per-fuel statistics (count, min, average, median, max) nationally or for a concelho/district, " +
        "plus the three cheapest stations for each fuel. Use for \"how much is diesel in Portugal?\" or " +
        "\"what's the spread in Porto?\".",
      inputSchema: z.object({
        fuels: z
          .array(z.string())
          .min(1)
          .max(6)
          .optional()
          .describe("Fuel names or ids. Defaults to Gasóleo simples, Gasolina simples 95 and Gasolina 98."),
        district: z.string().optional().describe('District name, e.g. "Porto".'),
        municipality: z.string().optional().describe('Concelho name, e.g. "Porto".'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const { snapshot, fuels: allFuels } = await loadBase(ctx);
        const fuels = resolveFuels(allFuels, args.fuels, OVERVIEW_FUELS);
        const fuelNames = fuels.map((fuel) => fuel.name);

        const region = await resolveRegion(ctx, { district: args.district, municipality: args.municipality });
        const municipalityKey = region.municipality ? normalizeText(region.municipality.name) : null;
        const districtKey = region.district ? normalizeText(region.district.name) : null;

        const scopeRows = snapshot.rows.filter((row) => {
          if (municipalityKey && normalizeText(row.municipality) !== municipalityKey) return false;
          if (districtKey && normalizeText(row.district) !== districtKey) return false;
          return true;
        });

        const results = fuels.map((fuel) => {
          const rowsForFuel = scopeRows.filter((row) => normalizeText(row.fuel) === normalizeText(fuel.name));
          const prices = rowsForFuel.map((row) => row.price).filter((price): price is number => price !== null);
          const stats = summarize(prices);
          const cheapest = sortByPrice(rowsForFuel, 3);

          return {
            fuel: fuel.name,
            unit: fuel.unit,
            stations: new Set(rowsForFuel.map((row) => row.id)).size,
            price_min: stats?.min ?? null,
            price_avg: stats?.avg ?? null,
            price_median: stats?.median ?? null,
            price_max: stats?.max ?? null,
            price_spread: stats ? roundTo(stats.max - stats.min, 3) : null,
            cheapest: cheapest.map((row) => stationPayload(row, fuel.unit)),
          };
        });

        return {
          source: SOURCE,
          data_fetched_at: snapshot.fetchedAt,
          query: {
            district: region.district?.name ?? null,
            municipality: region.municipality?.name ?? null,
            fuels: fuelNames,
          },
          result: {
            scope:
              region.municipality?.name ?? region.district?.name
                ? [region.municipality?.name, region.district?.name].filter(Boolean).join(", ")
                : "Portugal (mainland)",
            fuels: results,
            note: MAINLAND_NOTE,
          },
        };
      }),
  );

  server.registerTool(
    "get_price_history",
    {
      title: "Fuel price history",
      description:
        "Daily national average prices for one or more fuels, with min/max range, number of stations and " +
        "the change over the period. Use for trends (\"how has diesel changed this month?\"). " +
        "DGEG publishes this series nationally only — there is no per-concelho or per-station history.",
      inputSchema: z.object({
        fuels: z
          .array(z.string())
          .min(1)
          .max(5)
          .optional()
          .describe("Fuel names or ids. Defaults to Gasóleo simples and Gasolina simples 95."),
        days: z.number().int().min(7).max(365).optional().describe("Trailing window in days. Default 30."),
        from: z.string().optional().describe("Start date YYYY-MM-DD (overrides days)."),
        to: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const fuels = await getFuelTypes(ctx);
        const resolved = resolveFuels(fuels, args.fuels, DEFAULT_FUELS);
        const { from, to } = buildDateRange({ days: args.days, from: args.from, to: args.to });

        const rows = await getDailyHistory(ctx, {
          fuelIds: resolved.map((fuel) => fuel.id),
          from,
          to,
        });

        const byFuel = new Map<string, HistoryRow[]>();
        for (const row of rows) {
          const key = normalizeText(row.fuel);
          const bucket = byFuel.get(key) ?? [];
          bucket.push(row);
          byFuel.set(key, bucket);
        }

        const results = resolved.map((fuel) => {
          const points = (byFuel.get(normalizeText(fuel.name)) ?? [])
            .filter((row) => row.date.length > 0)
            .sort((a, b) => a.date.localeCompare(b.date));

          const averages = points
            .map((point) => point.avg)
            .filter((value): value is number => value !== null);

          const first = points.find((point) => point.avg !== null)?.avg ?? null;
          const last = [...points].reverse().find((point) => point.avg !== null)?.avg ?? null;
          const change = first !== null && last !== null ? roundTo(last - first, 3) : null;
          const changePercent =
            first !== null && last !== null && first !== 0
              ? roundTo(((last - first) / first) * 100, 2)
              : null;
          const stats = summarize(averages);

          return {
            fuel: fuel.name,
            unit: fuel.unit,
            days: points.length,
            first_date: points[0]?.date ?? null,
            last_date: points[points.length - 1]?.date ?? null,
            first_avg: first,
            last_avg: last,
            change_eur: change,
            change_percent: changePercent,
            period_min_avg: stats?.min ?? null,
            period_max_avg: stats?.max ?? null,
            period_avg: stats?.avg ?? null,
            points: points.map((point) => ({
              date: point.date,
              avg: point.avg,
              avg_without_discount: point.avgNoDiscount,
              min: point.min,
              max: point.max,
              stations: point.stationCount,
            })),
          };
        });

        return {
          source: SOURCE,
          data_fetched_at: new Date().toISOString(),
          query: { fuels: resolved.map((fuel) => fuel.name), from, to },
          result: {
            scope: "Portugal (mainland), national daily average — not per station",
            fuels: results,
            note:
              "DGEG publishes this historical series nationally only. " +
              "For current per-station prices use find_stations.",
          },
        };
      }),
  );

  server.registerTool(
    "list_fuel_types",
    {
      title: "List fuel types",
      description:
        "The fuel catalogue: DGEG id, display name, unit of measure and whether it is a road fuel. " +
        "Optional — find_stations, get_market_overview and get_price_history already accept fuel names.",
      inputSchema: z.object({
        road_only: z.boolean().optional().describe("Only road fuels (excludes heating oil). Default true."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const fuels = await getFuelTypes(ctx);
        const roadOnly = args.road_only ?? true;
        const selected = roadOnly ? fuels.filter((fuel) => fuel.roadFuel) : fuels;

        return {
          source: SOURCE,
          result: {
            fuels: selected.map((fuel) => ({
              id: fuel.id,
              name: fuel.name,
              unit: fuel.unit,
              road_fuel: fuel.roadFuel,
            })),
            note: "Fuels can be referenced by name in every other tool.",
          },
        };
      }),
  );

  server.registerTool(
    "list_locations",
    {
      title: "Resolve place names",
      description:
        "Look up concelhos, localities and postal codes so you can pass an exact place to find_stations. " +
        "Only needed to disambiguate an unclear name — find_stations resolves place names by itself.",
      inputSchema: z.object({
        query: z.string().optional().describe('Search text, e.g. "Leiria", "Marinha" or a postal code.'),
        district: z.string().optional().describe("Restrict to a district."),
        limit: z.number().int().min(1).max(100).optional().describe("Max entries per kind. Default 20."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const { snapshot, places } = await loadBase(ctx);
        const limit = args.limit ?? 20;
        const queryKey = args.query ? normalizeText(args.query) : null;
        const districtKey = args.district ? normalizeText(args.district) : null;

        const matches = (place: { value: string; municipality: string; district: string }) => {
          if (districtKey && normalizeText(place.district) !== districtKey) return false;
          if (!queryKey) return true;
          return (
            normalizeText(place.value).includes(queryKey) ||
            normalizeText(place.municipality).includes(queryKey)
          );
        };

        const municipalities = places.municipalities.filter(matches).slice(0, limit);
        const localities = places.localities.filter(matches).slice(0, limit);
        const postcodes = queryKey
          ? places.postcodes.filter((place) => place.value.includes(args.query!.trim())).slice(0, limit)
          : [];

        return {
          source: SOURCE,
          data_fetched_at: snapshot.fetchedAt,
          result: {
            municipalities: municipalities.map((place) => ({
              name: place.value,
              district: place.district,
            })),
            localities: localities.map((place) => ({
              name: place.value,
              municipality: place.municipality,
              district: place.district,
            })),
            postal_codes: postcodes.map((place) => ({
              postal_code: place.value,
              municipality: place.municipality,
            })),
            note: MAINLAND_NOTE,
          },
        };
      }),
  );

  return server;
}
