import { matchByName, normalizeText, roundTo } from "./domain";
import type { Snapshot, SnapshotRow } from "./snapshot";

export type PlaceKind = "municipality" | "locality" | "postcode" | "postcode_prefix";

export interface Place {
  kind: PlaceKind;
  value: string;
  lat: number;
  lon: number;
  municipality: string;
  district: string;
}

export interface PlaceIndex {
  municipalities: Place[];
  localities: Place[];
  postcodes: Place[];
  postcodePrefixes: Place[];
}

export interface ResolvedLocation {
  label: string;
  kind: PlaceKind | "coordinates";
  lat: number;
  lon: number;
  municipality: string | null;
  district: string | null;
}

export type ResolveResult =
  | { ok: true; location: ResolvedLocation }
  | { ok: false; reason: "not_found" | "ambiguous"; candidates: Place[]; hint: string };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

interface Grouped {
  value: string;
  municipality: string;
  district: string;
  lats: number[];
  lons: number[];
}

export function buildPlaceIndex(snapshot: Snapshot): PlaceIndex {
  const municipalityGroups = new Map<string, Grouped>();
  const localityGroups = new Map<string, Grouped>();
  const postcodeGroups = new Map<string, { value: string; rows: SnapshotRow[] }>();
  const prefixGroups = new Map<string, { value: string; rows: SnapshotRow[] }>();

  for (const row of snapshot.rows) {
    if (row.municipality) {
      const key = normalizeText(row.municipality);
      const entry =
        municipalityGroups.get(key) ??
        { value: row.municipality, municipality: row.municipality, district: row.district, lats: [], lons: [] };
      entry.lats.push(row.lat);
      entry.lons.push(row.lon);
      municipalityGroups.set(key, entry);
    }

    if (row.municipality && row.locality) {
      const key = `${normalizeText(row.locality)}|${normalizeText(row.municipality)}`;
      const entry =
        localityGroups.get(key) ??
        { value: row.locality, municipality: row.municipality, district: row.district, lats: [], lons: [] };
      entry.lats.push(row.lat);
      entry.lons.push(row.lon);
      localityGroups.set(key, entry);
    }

    if (row.postalCode && /^\d{4}-\d{3}$/.test(row.postalCode)) {
      const entry = postcodeGroups.get(row.postalCode) ?? { value: row.postalCode, rows: [] };
      entry.rows.push(row);
      postcodeGroups.set(row.postalCode, entry);

      const prefix = row.postalCode.slice(0, 4);
      const prefixEntry = prefixGroups.get(prefix) ?? { value: prefix, rows: [] };
      prefixEntry.rows.push(row);
      prefixGroups.set(prefix, prefixEntry);
    }
  }

  const municipalities: Place[] = [...municipalityGroups.values()].map((entry) => ({
    kind: "municipality",
    value: entry.value,
    lat: roundTo(median(entry.lats), 5),
    lon: roundTo(median(entry.lons), 5),
    municipality: entry.municipality,
    district: entry.district,
  }));

  const localities: Place[] = [...localityGroups.values()].map((entry) => ({
    kind: "locality",
    value: entry.value,
    lat: roundTo(median(entry.lats), 5),
    lon: roundTo(median(entry.lons), 5),
    municipality: entry.municipality,
    district: entry.district,
  }));

  const postcodes: Place[] = [...postcodeGroups.values()].map((entry) => ({
    kind: "postcode",
    value: entry.value,
    lat: roundTo(median(entry.rows.map((row) => row.lat)), 5),
    lon: roundTo(median(entry.rows.map((row) => row.lon)), 5),
    municipality: mostCommon(entry.rows.map((row) => row.municipality)),
    district: mostCommon(entry.rows.map((row) => row.district)),
  }));

  const postcodePrefixes: Place[] = [...prefixGroups.values()].map((entry) => ({
    kind: "postcode_prefix",
    value: entry.value,
    lat: roundTo(median(entry.rows.map((row) => row.lat)), 5),
    lon: roundTo(median(entry.rows.map((row) => row.lon)), 5),
    municipality: mostCommon(entry.rows.map((row) => row.municipality)),
    district: mostCommon(entry.rows.map((row) => row.district)),
  }));

  return { municipalities, localities, postcodes, postcodePrefixes };
}

export function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const match = /^(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(input.trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function toResolved(place: Place): ResolvedLocation {
  return {
    label: place.kind === "municipality" ? place.value : `${place.value} (${place.municipality})`,
    kind: place.kind,
    lat: place.lat,
    lon: place.lon,
    municipality: place.municipality || null,
    district: place.district || null,
  };
}

function ambiguous(candidates: Place[], hint: string): ResolveResult {
  return { ok: false, reason: "ambiguous", candidates: candidates.slice(0, 10), hint };
}

function notFound(input: string): ResolveResult {
  return {
    ok: false,
    reason: "not_found",
    candidates: [],
    hint:
      `No Portuguese mainland place matched "${input}". Pass a concelho name (e.g. "Leiria"), ` +
      `a locality, a postal code (e.g. "2400-193" or "2400"), or coordinates "lat,lon". ` +
      `Note: DGEG only covers mainland Portugal (no Azores or Madeira).`,
  };
}

/**
 * Resolve a free-form place into coordinates. Order: explicit coordinates,
 * exact postal code, 4-digit postal prefix, concelho, locality.
 */
export function resolveLocation(index: PlaceIndex, input: string): ResolveResult {
  const trimmed = input.trim();
  if (!trimmed) return notFound(input);

  const coordinates = parseCoordinates(trimmed);
  if (coordinates) {
    return {
      ok: true,
      location: {
        label: `${coordinates.lat}, ${coordinates.lon}`,
        kind: "coordinates",
        lat: coordinates.lat,
        lon: coordinates.lon,
        municipality: null,
        district: null,
      },
    };
  }

  if (/^\d{4}-\d{3}$/.test(trimmed)) {
    const hit = index.postcodes.find((place) => place.value === trimmed);
    if (hit) return { ok: true, location: toResolved(hit) };
    return notFound(trimmed);
  }

  if (/^\d{4}$/.test(trimmed)) {
    const hit = index.postcodePrefixes.find((place) => place.value === trimmed);
    if (hit) return { ok: true, location: toResolved(hit) };
    return notFound(trimmed);
  }

  // "locality, concelho/district" disambiguation.
  if (trimmed.includes(",")) {
    const [firstPart, secondPart] = trimmed.split(",").map((part) => part.trim());
    if (firstPart && secondPart) {
      const firstKey = normalizeText(firstPart);
      const secondKey = normalizeText(secondPart);
      const matches = [...index.municipalities, ...index.localities].filter(
        (place) =>
          normalizeText(place.value) === firstKey &&
          (normalizeText(place.municipality) === secondKey ||
            normalizeText(place.district) === secondKey),
      );
      if (matches.length === 1) return { ok: true, location: toResolved(matches[0]) };
      if (matches.length > 1) {
        return ambiguous(
          matches,
          `"${firstPart}" matches several places; pick one and pass just its concelho.`,
        );
      }
    }
  }

  const municipality = matchPlace(index.municipalities, trimmed);
  if (municipality) return municipality;

  const locality = matchPlace(index.localities, trimmed);
  if (locality) return locality;

  return notFound(trimmed);
}

function matchPlace(places: Place[], input: string): ResolveResult | null {
  const result = matchByName(places, input, (place) => place.value);
  if (result.match) return { ok: true, location: toResolved(result.match) };
  if (result.candidates.length > 0) {
    return ambiguous(
      result.candidates,
      `"${input}" matches several places. Use one of the candidates, or add the concelho ` +
        `(e.g. "Santa Catarina, Caldas da Rainha").`,
    );
  }
  return null;
}
