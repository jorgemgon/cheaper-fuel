export interface LatLon {
  lat: number;
  lon: number;
}

export interface LatLonBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Bounding box for a set of stations, used to fit the map. */
export function boundsOf(points: readonly LatLon[]): LatLonBounds | null {
  const valid = points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  );
  if (valid.length === 0) return null;

  let south = valid[0].lat;
  let north = valid[0].lat;
  let west = valid[0].lon;
  let east = valid[0].lon;

  for (const point of valid) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
  }

  return { south, west, north, east };
}

/** A cached position is usable for a short while; older than that, re-ask. */
export function isFresh(timestamp: number, ttlMs: number, now: number = Date.now()): boolean {
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= ttlMs;
}

export const GEO_CACHE_TTL_MS = 5 * 60_000;
