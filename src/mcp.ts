import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { SERVER_NAME, SERVER_VERSION, type Env } from "./env";
import {
  buildDateRange,
  formatPrice,
  fuelAlias,
  isWithinHours,
  lisbonToday,
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
import {
  groupProgrammes,
  loadDiscounts,
  resolveForStation,
  sanitizeProfile,
  type DiscountOutcome,
  type DiscountProfile,
  type DiscountProfileInput,
  type DiscountRegistry,
  type DiscountResolution,
} from "./discounts";

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
      // A brand filter must never match stations with an unknown brand.
      if (!rowBrand) return false;
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

function stationPayload(
  row: SnapshotRow & { distanceKm?: number },
  unit: string | null,
  extras: Record<string, unknown> = {},
) {
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
    ...extras,
  };
}

interface DiscountContext {
  discounts: DiscountRegistry["discounts"];
  registryUpdatedAt: string | null;
  profile: DiscountProfile;
  today: string;
  unavailable: string | null;
}

async function loadDiscountContext(env: Env, input: DiscountProfileInput): Promise<DiscountContext> {
  const today = lisbonToday();
  const profile = sanitizeProfile(input);
  const loaded = await loadDiscounts(env);

  if (!loaded.ok) {
    return { discounts: [], registryUpdatedAt: null, profile, today, unavailable: loaded.reason };
  }
  return {
    discounts: loaded.discounts,
    registryUpdatedAt: loaded.updatedAt,
    profile,
    today,
    unavailable: null,
  };
}

function resolutionPayload(resolution: DiscountResolution, unit: string | null) {
  return {
    program_id: resolution.programId,
    program_title: resolution.programTitle,
    description: resolution.description,
    tier: resolution.tierId,
    label: resolution.tierLabel,
    guaranteed_cents: resolution.guaranteedCents,
    max_cents: resolution.maxCents,
    applied_cents: resolution.appliedCents,
    effective_price_eur: resolution.effectivePriceEur,
    effective_price_display: formatPrice(resolution.effectivePriceEur, unit),
    saves_eur_per_fill: resolution.savesEurPerFill,
    conditions: resolution.conditions,
    confidence: resolution.confidence,
    schedule: resolution.schedule,
    schedule_label: resolution.scheduleLabel,
    applies_today: true,
    stale: resolution.stale,
  };
}

function discountExtras(outcome: DiscountOutcome, unit: string | null): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (outcome.applied) extras.discount = resolutionPayload(outcome.applied, unit);
  if (outcome.possible.length > 0) {
    extras.possible_discounts = outcome.possible.slice(0, 2).map((entry) => resolutionPayload(entry, unit));
  }
  if (outcome.scheduled.length > 0) {
    extras.scheduled_discounts = outcome.scheduled.slice(0, 2).map((entry) => ({
      program_id: entry.programId,
      program_title: entry.programTitle,
      description: entry.description,
      schedule_label: entry.scheduleLabel,
      next_date: entry.nextDate,
      confidence: entry.confidence,
      applies_today: false,
    }));
  }
  if (outcome.catalogued.length > 0) {
    extras.catalogued_discounts = outcome.catalogued.slice(0, 2).map((entry) => resolutionPayload(entry, unit));
  }
  if (outcome.locked.length > 0) {
    extras.locked_discounts = outcome.locked.slice(0, 2);
  }
  return extras;
}

function stationEntry(
  context: DiscountContext,
  row: SnapshotRow & { distanceKm?: number },
  unit: string | null,
) {
  const outcome = resolveForStation(
    context.discounts,
    { brand: row.brand, name: row.name, price: row.price },
    unit,
    context.profile,
    context.today,
  );

  return {
    payload: stationPayload(row, unit, discountExtras(outcome, unit)),
    effectivePrice: outcome.applied?.effectivePriceEur ?? row.price ?? Number.POSITIVE_INFINITY,
  };
}

function discountRegistryFields(context: DiscountContext): Record<string, unknown> {
  return {
    registry_updated_at: context.registryUpdatedAt,
    ...(context.unavailable ? { discounts_unavailable: context.unavailable } : {}),
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

interface ObservedDiscount {
  date: string;
  avg_discount_eur: number;
  avg_discount_percent: number | null;
  stations: number;
}

/**
 * DGEG's daily series carries both the discounted and the undiscounted average;
 * the gap is the observed discount. It is a national weighted average, so it is
 * reported separately and never mixed with catalogue discounts.
 */
async function recentObservedDiscounts(
  ctx: DgegContext,
  fuels: readonly FuelType[],
): Promise<Map<string, ObservedDiscount | null>> {
  const result = new Map<string, ObservedDiscount | null>();
  try {
    const { from, to } = buildDateRange({ days: 7 });
    const rows = await getDailyHistory(ctx, { fuelIds: fuels.map((fuel) => fuel.id), from, to });

    const latest = new Map<string, HistoryRow>();
    for (const row of rows) {
      if (row.avg === null || row.avgNoDiscount === null) continue;
      const key = normalizeText(row.fuel);
      const current = latest.get(key);
      if (!current || row.date > current.date) latest.set(key, row);
    }

    for (const fuel of fuels) {
      const key = normalizeText(fuel.name);
      const row = latest.get(key);
      if (!row || row.avg === null || row.avgNoDiscount === null) {
        result.set(key, null);
        continue;
      }
      const discount = roundTo(row.avgNoDiscount - row.avg, 4);
      result.set(key, {
        date: row.date,
        avg_discount_eur: discount,
        avg_discount_percent:
          row.avgNoDiscount > 0 ? roundTo((discount / row.avgNoDiscount) * 100, 2) : null,
        stations: row.stationCount,
      });
    }
  } catch {
    for (const fuel of fuels) result.set(normalizeText(fuel.name), null);
  }
  return result;
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
        sort: z
          .enum(["distance", "price", "effective_price"])
          .optional()
          .describe(
            "Rank by distance (proximity searches), price, or effective price after discounts. " +
              "Region rankings default to price.",
          ),
        cards: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            'Cards or apps the user holds, e.g. ["continente_card", "mundo_galp_app", ' +
              '"repsol_partner_card", "poupa_mais_card"]. Programmes whose requirements are not all ' +
              "declared are reported as locked_discounts instead of applied.",
          ),
        services: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            'Services or contracts held, e.g. ["galp_energy", "nos_package"], or for Repsol tiers ' +
              '["repsol_electricity", "repsol_gas"]. They satisfy requirements and set the tier.',
          ),
        discount_mode: z
          .enum(["best_case", "guaranteed"])
          .optional()
          .describe(
            "best_case includes spend-triggered coupons; guaranteed counts only permanent app/instant benefits.",
          ),
        fill_litres: z
          .number()
          .min(5)
          .max(120)
          .optional()
          .describe("Fill size used for per-fill caps and savings, in litres. Default 50."),
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
          const wantsEffectiveSort = sort === "effective_price";

          const discountContext = await loadDiscountContext(env, {
            cards: args.cards,
            services: args.services,
            fillLitres: args.fill_litres,
            mode: args.discount_mode,
          });

          const proximity = searchProximity({
            rows: filtered,
            fuelNames,
            point,
            radiusKm,
            maxRadiusKm,
            // Sorting by effective price needs a wider pool to sort through.
            limitPerFuel: wantsEffectiveSort ? Math.min(25, limit * 3) : limit,
            sort: wantsEffectiveSort ? "distance" : sort,
          });

          const fuelResults = fuels.map((fuel) => {
            const unit = fuel.unit;
            const matched = countForFuel(proximity.withinRadius, fuel.name);
            const entries = (proximity.byFuel.get(fuel.name) ?? []).map((row) =>
              stationEntry(discountContext, row, unit),
            );
            const stations = (
              wantsEffectiveSort
                ? [...entries].sort((a, b) => a.effectivePrice - b.effectivePrice).slice(0, limit)
                : entries
            ).map((entry) => entry.payload);

            return { fuel: fuel.name, unit, stations_found: matched, stations };
          });

          const covered = municipalitiesCovered(proximity.withinRadius);
          const totalStations = countStations(proximity.withinRadius);

          const payload: Record<string, unknown> = {
            source: SOURCE,
            data_fetched_at: snapshot.fetchedAt,
            ...discountRegistryFields(discountContext),
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
              discounts: {
                cards: discountContext.profile.cards,
                services: discountContext.profile.services,
                mode: discountContext.profile.mode,
                fill_litres: discountContext.profile.fillLitres,
              },
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
        const wantsEffectiveSort = sort === "effective_price";

        const discountContext = await loadDiscountContext(env, {
          cards: args.cards,
          services: args.services,
          fillLitres: args.fill_litres,
          mode: args.discount_mode,
        });

        const fuelResults = fuels.map((fuel) => {
          const unit = fuel.unit;
          const rowsForFuel = regionRows.filter((row) => normalizeText(row.fuel) === normalizeText(fuel.name));
          // Without a reference point, distance ranking is meaningless.
          const pool = sortByPrice(rowsForFuel, wantsEffectiveSort ? Math.min(25, limit * 3) : limit);
          const entries = pool.map((row) => stationEntry(discountContext, row, unit));
          const stations = (
            wantsEffectiveSort
              ? [...entries].sort((a, b) => a.effectivePrice - b.effectivePrice).slice(0, limit)
              : entries
          ).map((entry) => entry.payload);

          return { fuel: fuel.name, unit, stations_found: rowsForFuel.length, stations };
        });

        return {
          source: SOURCE,
          data_fetched_at: snapshot.fetchedAt,
          ...discountRegistryFields(discountContext),
          query: {
            mode: "region",
            district: region.district?.name ?? null,
            municipality: region.municipality?.name ?? null,
            fuels: fuelNames,
            limit_per_fuel: limit,
            sort,
            brand: brandName,
            station_type: args.station_type ?? null,
            discounts: {
              cards: discountContext.profile.cards,
              services: discountContext.profile.services,
              mode: discountContext.profile.mode,
              fill_litres: discountContext.profile.fillLitres,
            },
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
        cards: z
          .array(z.string())
          .max(10)
          .optional()
          .describe('Loyalty cards or apps the user holds, e.g. ["continente_card", "mundo_galp_app"].'),
        services: z
          .array(z.string())
          .max(10)
          .optional()
          .describe('Services held for tiered programmes, e.g. ["galp_energy", "nos_package"].'),
        discount_mode: z.enum(["best_case", "guaranteed"]).optional(),
        fill_litres: z.number().min(5).max(120).optional(),
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

        const discountContext = await loadDiscountContext(env, {
          cards: args.cards,
          services: args.services,
          fillLitres: args.fill_litres,
          mode: args.discount_mode,
        });

        return {
          source: SOURCE,
          data_fetched_at: snapshot.fetchedAt,
          ...discountRegistryFields(discountContext),
          query: {
            station_id: stationId,
            discounts: {
              cards: discountContext.profile.cards,
              services: discountContext.profile.services,
              mode: discountContext.profile.mode,
              fill_litres: discountContext.profile.fillLitres,
            },
          },
          result: {
            station: {
              ...detail,
              fuels: detail.fuels.map((fuel) => {
                const outcome = resolveForStation(
                  discountContext.discounts,
                  { brand: detail.brand, name: detail.name, price: fuel.price },
                  fuel.unit,
                  discountContext.profile,
                  discountContext.today,
                );
                return {
                  ...fuel,
                  price_display: formatPrice(fuel.price, fuel.unit),
                  ...discountExtras(outcome, fuel.unit),
                };
              }),
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

        const observed = await recentObservedDiscounts(ctx, fuels);

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
            observed_discount_national: observed.get(normalizeText(fuel.name)) ?? null,
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
            note:
              `${MAINLAND_NOTE} observed_discount_national is DGEG's national weighted average gap between the ` +
              `undiscounted and discounted price; it is not regional and must not be added to catalogue discounts.`,
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
        "the change over the period. Also reports the observed discount (the gap between DGEG's undiscounted " +
        "and discounted averages). Use for trends (\"how has diesel changed this month?\"). " +
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

          const pointsPayload = points.map((point) => {
            const discount =
              point.avg !== null && point.avgNoDiscount !== null
                ? roundTo(point.avgNoDiscount - point.avg, 4)
                : null;
            return {
              date: point.date,
              avg: point.avg,
              avg_without_discount: point.avgNoDiscount,
              avg_discount_eur: discount,
              avg_discount_percent:
                discount !== null && point.avgNoDiscount !== null && point.avgNoDiscount > 0
                  ? roundTo((discount / point.avgNoDiscount) * 100, 2)
                  : null,
              min: point.min,
              max: point.max,
              stations: point.stationCount,
            };
          });

          const discountValues = pointsPayload
            .map((point) => point.avg_discount_eur)
            .filter((value): value is number => value !== null);
          const discountStats = summarize(discountValues);
          const discountedDays = discountValues.filter((value) => value > 0).length;

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
            discount_summary: discountStats
              ? {
                  avg_discount_eur: discountStats.avg,
                  max_discount_eur: discountStats.max,
                  days_with_discount: discountedDays,
                  discount_share_percent:
                    discountValues.length > 0
                      ? roundTo((discountedDays / discountValues.length) * 100, 1)
                      : null,
                }
              : null,
            points: pointsPayload,
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
              "DGEG publishes this historical series nationally only. avg_discount_eur is the observed gap " +
              "between the undiscounted and discounted national averages (fleet cards and similar); it is not " +
              "attributable to a supplier or station and must not be added to catalogue discounts. " +
              "For current per-station prices and discounts use find_stations.",
          },
        };
      }),
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
      inputSchema: z.object({
        supplier: z.string().optional().describe('Filter by supplier, e.g. "galp".'),
        partner: z.string().optional().describe('Filter by retail partner, e.g. "continente".'),
        kind: z.enum(["loyalty_tier", "card_partner", "campaign", "app"]).optional(),
        status: z
          .enum(["active", "scheduled", "expired", "all"])
          .optional()
          .describe("Derived status filter. Default active."),
        quantified_only: z
          .boolean()
          .optional()
          .describe("Only programmes with a numeric value (some deals are catalogued before being quantified)."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => {
        const loaded = await loadDiscounts(env);
        if (!loaded.ok) {
          throw new ToolError("discounts_unavailable", "The discount registry is not available.", {
            reason: loaded.reason,
            hint: "Apply the D1 migrations (npm run db:migrate:remote) to create and seed the discounts table.",
          });
        }

        const today = lisbonToday();
        const statusFilter = args.status ?? "active";
        const supplierKey = args.supplier ? normalizeText(args.supplier) : null;
        const partnerKey = args.partner ? normalizeText(args.partner) : null;

        const groups = groupProgrammes(loaded.discounts, today)
          .filter((group) => (statusFilter === "all" ? true : group.status === statusFilter))
          .filter((group) => (args.kind ? group.kind === args.kind : true))
          .filter((group) =>
            supplierKey ? normalizeText(group.supplier).includes(supplierKey) : true,
          )
          .filter((group) =>
            partnerKey
              ? group.partners.some((partner) => normalizeText(partner).includes(partnerKey))
              : true,
          )
          .filter((group) => (args.quantified_only ? group.quantified : true));

        return {
          source: SOURCE,
          registry_updated_at: loaded.updatedAt,
          query: {
            supplier: args.supplier ?? null,
            partner: args.partner ?? null,
            kind: args.kind ?? null,
            status: statusFilter,
          },
          result: {
            status_note:
              "Status is derived from validFrom/validUntil against today in Europe/Lisbon; it is not stored.",
            programs: groups.map((group) => ({
              program_id: group.programId,
              program_title: group.programTitle,
              supplier: group.supplier,
              partners: group.partners,
              kind: group.kind,
              confidence: group.confidence,
              status: group.status,
              quantified: group.quantified,
              stale: group.stale,
              discounts: group.discounts.map((discount) => ({
                id: discount.id,
                description: discount.description,
                tier: discount.tierId,
                tier_label: discount.tierLabel,
                min_services: discount.minServices,
                channel: discount.channel,
                value_type: discount.valueType,
                value: discount.value,
                combine: discount.combine,
                caps: discount.caps,
                requires: discount.requires,
                schedule: discount.schedule,
                valid_from: discount.validFrom,
                valid_until: discount.validUntil,
                status: discount.status,
                stale: discount.stale,
                source: discount.source,
              })),
            })),
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
