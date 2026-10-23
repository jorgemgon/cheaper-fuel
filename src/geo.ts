import { normalizeText, roundTo, type LatLon } from "./domain";
import type { SnapshotRow } from "./snapshot";

export interface RowWithDistance extends SnapshotRow {
  distanceKm: number;
}

export interface MunicipalityCoverage {
  municipality: string;
  district: string;
  station_count: number;
  min_distance_km: number | null;
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function attachDistance(rows: readonly SnapshotRow[], point: LatLon): RowWithDistance[] {
  return rows.map((row) => ({
    ...row,
    distanceKm: haversineKm(point, { lat: row.lat, lon: row.lon }),
  }));
}

/** Concelhos represented in a result set, nearest first, with station counts. */
export function municipalitiesCovered(
  rows: ReadonlyArray<SnapshotRow & { distanceKm?: number }>,
): MunicipalityCoverage[] {
  const groups = new Map<
    string,
    { municipality: string; district: string; stations: Set<number>; min: number | null }
  >();

  for (const row of rows) {
    const key = normalizeText(row.municipality || "desconhecido");
    const entry =
      groups.get(key) ??
      { municipality: row.municipality, district: row.district, stations: new Set<number>(), min: null };

    entry.stations.add(row.id);
    if (row.distanceKm !== undefined && (entry.min === null || row.distanceKm < entry.min)) {
      entry.min = row.distanceKm;
    }
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map((entry) => ({
      municipality: entry.municipality,
      district: entry.district,
      station_count: entry.stations.size,
      min_distance_km: entry.min === null ? null : roundTo(entry.min, 2),
    }))
    .sort((a, b) => {
      const distance = (a.min_distance_km ?? Number.POSITIVE_INFINITY) - (b.min_distance_km ?? Number.POSITIVE_INFINITY);
      return distance !== 0 ? distance : a.municipality.localeCompare(b.municipality, "pt");
    });
}

export type SortMode = "distance" | "price";
export type SortOrder = "asc" | "desc";

function compareRows(sort: SortMode, order: SortOrder, a: RowWithDistance, b: RowWithDistance): number {
  const byDistance = a.distanceKm - b.distanceKm;

  if (sort === "distance") {
    if (byDistance !== 0) return order === "desc" ? -byDistance : byDistance;
    return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);
  }

  // Unpriced stations always sink to the bottom, whichever direction is used.
  if (a.price === null && b.price === null) return byDistance;
  if (a.price === null) return 1;
  if (b.price === null) return -1;

  const byPrice = a.price - b.price;
  if (byPrice !== 0) return order === "desc" ? -byPrice : byPrice;
  return byDistance;
}

function groupByFuel(
  rows: readonly RowWithDistance[],
  fuelNames: readonly string[],
  limit: number,
  sort: SortMode,
  order: SortOrder,
): Map<string, RowWithDistance[]> {
  const byKey = new Map<string, string>(fuelNames.map((name) => [normalizeText(name), name]));
  const grouped = new Map<string, RowWithDistance[]>(fuelNames.map((name) => [name, []]));

  for (const row of rows) {
    const display = byKey.get(normalizeText(row.fuel));
    if (!display) continue;
    grouped.get(display)?.push(row);
  }

  for (const [name, list] of grouped) {
    grouped.set(name, list.sort((a, b) => compareRows(sort, order, a, b)).slice(0, limit));
  }

  return grouped;
}

export interface ProximityOptions {
  rows: readonly SnapshotRow[];
  fuelNames: readonly string[];
  point: LatLon;
  radiusKm: number;
  maxRadiusKm: number;
  limitPerFuel: number;
  sort: SortMode;
  order?: SortOrder;
}

export interface ProximityResult {
  effectiveRadiusKm: number;
  byFuel: Map<string, RowWithDistance[]>;
  withinRadius: RowWithDistance[];
}

/**
 * Search around a point, growing the radius until every requested fuel has
 * enough results (or the ceiling is reached). This is what makes a small
 * concelho automatically include its neighbours.
 */
export function searchProximity(options: ProximityOptions): ProximityResult {
  const { rows, fuelNames, point, radiusKm, maxRadiusKm, limitPerFuel, sort, order = "asc" } = options;
  const withDistance = attachDistance(rows, point);
  const ceiling = Math.max(radiusKm, maxRadiusKm);

  const radii: number[] = [];
  let current = radiusKm;
  while (true) {
    radii.push(roundTo(current, 2));
    if (current >= ceiling) break;
    current = Math.min(ceiling, current * 1.5);
  }

  let lastResult: ProximityResult | null = null;

  for (const radius of radii) {
    const withinRadius = withDistance.filter((row) => row.distanceKm <= radius);
    const byFuel = groupByFuel(withinRadius, fuelNames, limitPerFuel, sort, order);
    lastResult = { effectiveRadiusKm: radius, byFuel, withinRadius };

    const satisfied = fuelNames.every((name) => (byFuel.get(name)?.length ?? 0) >= limitPerFuel);
    if (satisfied) return lastResult;
  }

  return lastResult ?? {
    effectiveRadiusKm: radiusKm,
    byFuel: groupByFuel([], fuelNames, limitPerFuel, sort, order),
    withinRadius: [],
  };
}

export function sortByPrice<T extends { price: number | null }>(
  rows: readonly T[],
  limit: number,
  order: SortOrder = "asc",
): T[] {
  const sign = order === "desc" ? -1 : 1;
  return [...rows]
    .sort((a, b) => {
      // Unpriced entries stay last in both directions.
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return sign * (a.price - b.price);
    })
    .slice(0, limit);
}

export function countStations(rows: readonly SnapshotRow[]): number {
  return new Set(rows.map((row) => row.id)).size;
}
