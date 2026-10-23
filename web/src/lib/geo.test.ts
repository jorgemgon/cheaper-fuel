import { describe, expect, it } from "vitest";

import { boundsOf, GEO_CACHE_TTL_MS, isFresh } from "./geo";

describe("boundsOf", () => {
  it("wraps every point", () => {
    const bounds = boundsOf([
      { lat: 39.7, lon: -8.8 },
      { lat: 41.1, lon: -8.6 },
      { lat: 38.7, lon: -9.1 },
    ]);
    expect(bounds).toEqual({ south: 38.7, west: -9.1, north: 41.1, east: -8.6 });
  });

  it("returns null for an empty set", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("ignores non-finite coordinates", () => {
    expect(boundsOf([{ lat: Number.NaN, lon: -8 }])).toBeNull();
  });
});

describe("isFresh", () => {
  const now = 1_000_000;

  it("accepts a timestamp inside the window", () => {
    expect(isFresh(now - 1_000, GEO_CACHE_TTL_MS, now)).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    expect(isFresh(now - GEO_CACHE_TTL_MS - 1, GEO_CACHE_TTL_MS, now)).toBe(false);
  });

  it("rejects a timestamp from the future", () => {
    expect(isFresh(now + 5_000, GEO_CACHE_TTL_MS, now)).toBe(false);
  });
});
