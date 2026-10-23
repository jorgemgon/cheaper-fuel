import { readJson, removeKey, writeJson } from "./storage";

export type SearchMode = "geo" | "place" | "picked";

export interface SearchContext {
  mode: SearchMode;
  /** Free-text place, for mode "place". */
  location?: string;
  /** Coordinates, for modes "geo" and "picked". */
  latitude?: number;
  longitude?: number;
  at?: string;
}

const KEY = "last-search";

function isMode(value: unknown): value is SearchMode {
  return value === "geo" || value === "place" || value === "picked";
}

/** Validates a stored context; malformed entries are ignored on load. */
export function parseSearchContext(value: unknown): SearchContext | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<SearchContext>;
  if (!isMode(candidate.mode)) return null;

  if (candidate.mode === "place") {
    const location = typeof candidate.location === "string" ? candidate.location.trim() : "";
    if (!location) return null;
    return { mode: "place", location, at: candidate.at };
  }

  if (typeof candidate.latitude !== "number" || typeof candidate.longitude !== "number") return null;
  if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return null;
  return {
    mode: candidate.mode,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    at: candidate.at,
  };
}

export function readSearchContext(): SearchContext | null {
  return parseSearchContext(readJson<unknown>(KEY, null));
}

export function saveSearchContext(context: Omit<SearchContext, "at">): void {
  writeJson(KEY, { ...context, at: new Date().toISOString() });
}

export function clearSearchContext(): void {
  removeKey(KEY);
}
