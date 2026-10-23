import type { StationDetail, StationInfo } from "@contracts";

export interface FavoriteStation {
  station: StationInfo;
  /** The fuel the user was looking at when saving, shown on the favourite card. */
  fuel: string;
  savedAt: string;
}

function withoutDistance(station: StationInfo): StationInfo {
  const { distance_km: _distance, ...rest } = station;
  return rest;
}

/** Validates whatever localStorage held before rendering it. */
export function normalizeFavorites(value: unknown): FavoriteStation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const favorites: FavoriteStation[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<FavoriteStation>;
    const station = item.station;
    if (!station || typeof station.id !== "number" || typeof station.name !== "string") continue;
    if (!station.address || !station.coordinates) continue;
    if (typeof item.fuel !== "string" || item.fuel.trim() === "") continue;
    if (typeof item.savedAt !== "string") continue;
    if (seen.has(station.id)) continue;
    seen.add(station.id);
    favorites.push({ station, fuel: item.fuel, savedAt: item.savedAt });
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
  return [{ station: withoutDistance(station), fuel, savedAt }, ...favorites];
}

/** Replaces a saved snapshot with fresh prices, keeping the original save date. */
export function updateFavoriteStation(
  favorites: readonly FavoriteStation[],
  station: StationInfo,
  fuel: string,
): FavoriteStation[] {
  return favorites.map((favorite) =>
    favorite.station.id === station.id
      ? { ...favorite, station: withoutDistance(station), fuel }
      : favorite,
  );
}

/**
 * Rebuilds a search-style station row from the station-details endpoint, so a
 * favourite can show current prices even when it is outside the current search.
 */
export function favoriteFromDetail(
  detail: StationDetail,
  fuelName: string,
): { station: StationInfo; fuel: string } | null {
  const { latitude, longitude } = detail.address;
  if (latitude === null || longitude === null) return null;

  const fuel = detail.fuels.find((entry) => entry.name === fuelName) ?? detail.fuels[0];
  if (!fuel) return null;

  const station: StationInfo = {
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

  return { station, fuel: fuel.name };
}
