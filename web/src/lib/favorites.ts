import type { StationDetail, StationInfo } from "@contracts";

export interface FavoriteFuelRow {
  fuel: string;
  station: StationInfo;
}

export interface FavoriteStation {
  /** The station whose catalogue is saved; `fuel` is the card the user starred. */
  station: StationInfo;
  fuel: string;
  /** Every fuel the station sells, so the favourite shows its full catalogue. */
  rows: FavoriteFuelRow[];
  savedAt: string;
}

export interface FavoriteUpdate {
  station: StationInfo;
  fuel: string;
  rows: FavoriteFuelRow[];
}

function withoutDistance(station: StationInfo): StationInfo {
  const { distance_km: _distance, ...rest } = station;
  return rest;
}

function isStation(value: unknown): value is StationInfo {
  if (!value || typeof value !== "object") return false;
  const station = value as Partial<StationInfo>;
  return (
    typeof station.id === "number" &&
    typeof station.name === "string" &&
    Boolean(station.address) &&
    Boolean(station.coordinates)
  );
}

function rowsFrom(value: unknown, fallbackStation: StationInfo, fallbackFuel: string): FavoriteFuelRow[] {
  if (!Array.isArray(value)) {
    return [{ fuel: fallbackFuel, station: withoutDistance(fallbackStation) }];
  }

  const rows: FavoriteFuelRow[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<FavoriteFuelRow>;
    if (typeof item.fuel !== "string" || item.fuel.trim() === "" || !isStation(item.station)) continue;
    if (item.station.id !== fallbackStation.id || seen.has(item.fuel)) continue;
    seen.add(item.fuel);
    rows.push({ fuel: item.fuel, station: withoutDistance(item.station) });
  }

  return rows.length > 0 ? rows : [{ fuel: fallbackFuel, station: withoutDistance(fallbackStation) }];
}

/** Validates whatever localStorage held before rendering it, including old one-fuel saves. */
export function normalizeFavorites(value: unknown): FavoriteStation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const favorites: FavoriteStation[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<FavoriteStation>;
    if (!isStation(item.station)) continue;
    if (typeof item.fuel !== "string" || item.fuel.trim() === "") continue;
    if (typeof item.savedAt !== "string") continue;
    if (seen.has(item.station.id)) continue;

    const rows = rowsFrom(item.rows, item.station, item.fuel);
    const primary = rows.find((row) => row.fuel === item.fuel) ?? rows[0];
    seen.add(item.station.id);
    favorites.push({
      station: primary.station,
      fuel: primary.fuel,
      rows,
      savedAt: item.savedAt,
    });
  }
  return favorites;
}

export function isFavoriteStation(favorites: readonly FavoriteStation[], id: number): boolean {
  return favorites.some((favorite) => favorite.station.id === id);
}

/** Adds or removes a station, always by station id (not by fuel). */
export function toggleFavoriteStation(
  favorites: readonly FavoriteStation[],
  station: StationInfo,
  fuel: string,
  savedAt = new Date().toISOString(),
): FavoriteStation[] {
  if (isFavoriteStation(favorites, station.id)) {
    return favorites.filter((favorite) => favorite.station.id !== station.id);
  }

  const row = { fuel, station: withoutDistance(station) };
  return [{ station: row.station, fuel, rows: [row], savedAt }, ...favorites];
}

/** Replaces saved snapshots with fresh prices, keeping the original save date. */
export function updateFavoriteStation(
  favorites: readonly FavoriteStation[],
  update: FavoriteUpdate,
): FavoriteStation[] {
  const rows = update.rows.map((row) => ({
    fuel: row.fuel,
    station: withoutDistance(row.station),
  }));
  const primary = rows.find((row) => row.fuel === update.fuel) ?? rows[0];
  if (!primary) return [...favorites];

  return favorites.map((favorite) =>
    favorite.station.id === update.station.id
      ? {
          ...favorite,
          station: withoutDistance(primary.station),
          fuel: primary.fuel,
          rows,
        }
      : favorite,
  );
}

function stationForFuel(
  detail: StationDetail,
  fuel: StationDetail["fuels"][number],
  latitude: number,
  longitude: number,
): StationInfo {
  return {
    id: detail.id,
    name: detail.name,
    brand: detail.brand,
    price_eur: fuel.price,
    price_display: fuel.price_display,
    unit: fuel.unit,
    address: {
      street: detail.address.street,
      locality: detail.address.locality,
      postal_code: detail.address.postalCode,
      municipality: detail.address.municipality ?? "",
      district: detail.address.district ?? "",
    },
    coordinates: { latitude, longitude },
    station_type: detail.stationType,
    last_updated: fuel.updated ?? "",
    maps_url:
      detail.maps_url ??
      `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    ...(fuel.discount ? { discount: fuel.discount } : {}),
    ...(fuel.possible_discounts ? { possible_discounts: fuel.possible_discounts } : {}),
    ...(fuel.scheduled_discounts ? { scheduled_discounts: fuel.scheduled_discounts } : {}),
    ...(fuel.catalogued_discounts ? { catalogued_discounts: fuel.catalogued_discounts } : {}),
    ...(fuel.locked_discounts ? { locked_discounts: fuel.locked_discounts } : {}),
  };
}

/**
 * Rebuilds the station's whole fuel catalogue from the details endpoint, so a
 * favourite shows every fuel price even outside the current search.
 */
export function favoriteFromDetail(detail: StationDetail, fuelName: string): FavoriteUpdate | null {
  const { latitude, longitude } = detail.address;
  if (latitude === null || longitude === null || detail.fuels.length === 0) return null;

  const rows = detail.fuels.map((fuel) => ({
    fuel: fuel.name,
    station: stationForFuel(detail, fuel, latitude, longitude),
  }));
  const primary = rows.find((row) => row.fuel === fuelName) ?? rows[0];

  return { station: primary.station, fuel: primary.fuel, rows };
}
