import { describe, expect, it } from "vitest";

import { buildPlaceIndex, parseCoordinates, resolveLocation } from "../src/places";
import type { Snapshot, SnapshotRow } from "../src/snapshot";

function row(overrides: Partial<SnapshotRow> & { id: number }): SnapshotRow {
  return {
    name: `Station ${overrides.id}`,
    brand: "GALP",
    fuel: "Gasóleo simples",
    price: 2,
    lat: 39.74,
    lon: -8.81,
    postalCode: "2400-193",
    locality: "Leiria",
    municipality: "Leiria",
    district: "Leiria",
    stationType: "Outro",
    address: "Rua A",
    updated: "2026-10-20 08:00",
    ...overrides,
  };
}

const snapshot: Snapshot = {
  fetchedAt: "2026-10-23T00:00:00.000Z",
  count: 5,
  rows: [
    row({ id: 1, lat: 39.747562, lon: -8.805167 }),
    row({ id: 2, locality: "Carvide", postalCode: "2425-345", lat: 39.85741, lon: -8.88404 }),
    row({ id: 3, municipality: "Marinha Grande", locality: "Marinha Grande", postalCode: "2430-001", lat: 39.75, lon: -8.93 }),
    row({ id: 4, municipality: "Caldas da Rainha", locality: "Santa Catarina", postalCode: "2500-001", lat: 39.4, lon: -9.13 }),
    row({ id: 5, municipality: "Viseu", district: "Viseu", locality: "Santa Catarina", postalCode: "3500-001", lat: 40.66, lon: -7.91 }),
  ],
};

const index = buildPlaceIndex(snapshot);

describe("buildPlaceIndex", () => {
  it("indexes concelhos, localities and postal codes", () => {
    expect(index.municipalities.map((place) => place.value).sort()).toEqual([
      "Caldas da Rainha",
      "Leiria",
      "Marinha Grande",
      "Viseu",
    ]);
    expect(index.localities.some((place) => place.value === "Carvide")).toBe(true);
    expect(index.postcodes.some((place) => place.value === "2400-193")).toBe(true);
    expect(index.postcodePrefixes.some((place) => place.value === "2400")).toBe(true);
  });

  it("uses a median coordinate for a locality", () => {
    const carvide = index.localities.find((place) => place.value === "Carvide");
    expect(carvide?.lat).toBeCloseTo(39.85741, 4);
  });
});

describe("parseCoordinates", () => {
  it("accepts lat,lon pairs", () => {
    expect(parseCoordinates("39.74,-8.81")).toEqual({ lat: 39.74, lon: -8.81 });
    expect(parseCoordinates("39.74, -8.81")).toEqual({ lat: 39.74, lon: -8.81 });
  });

  it("rejects out-of-range and non-coordinate input", () => {
    expect(parseCoordinates("139.74,-8.81")).toBeNull();
    expect(parseCoordinates("Leiria")).toBeNull();
  });
});

describe("resolveLocation", () => {
  it("resolves a concelho by name, case and accent insensitive", () => {
    const result = resolveLocation(index, "leiria");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location.kind).toBe("municipality");
      expect(result.location.label).toBe("Leiria");
      expect(result.location.district).toBe("Leiria");
    }
  });

  it("resolves a locality", () => {
    const result = resolveLocation(index, "Carvide");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location.kind).toBe("locality");
      expect(result.location.municipality).toBe("Leiria");
    }
  });

  it("resolves an exact postal code", () => {
    const result = resolveLocation(index, "2400-193");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location.kind).toBe("postcode");
      expect(result.location.municipality).toBe("Leiria");
    }
  });

  it("resolves a 4-digit postal prefix", () => {
    const result = resolveLocation(index, "2430");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.location.kind).toBe("postcode_prefix");
  });

  it("accepts explicit coordinates", () => {
    const result = resolveLocation(index, "39.74,-8.81");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location.kind).toBe("coordinates");
      expect(result.location.lat).toBeCloseTo(39.74, 4);
    }
  });

  it("disambiguates with a comma-separated concelho", () => {
    const result = resolveLocation(index, "Santa Catarina, Viseu");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.location.municipality).toBe("Viseu");
  });

  it("reports ambiguity rather than guessing", () => {
    const result = resolveLocation(index, "Santa Catarina");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous");
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("explains that islands are not covered", () => {
    const result = resolveLocation(index, "Ponta Delgada");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
      expect(result.hint).toMatch(/mainland/i);
    }
  });
});
