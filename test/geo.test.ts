import { describe, expect, it } from "vitest";

import { attachDistance, haversineKm, municipalitiesCovered, searchProximity, sortByPrice } from "../src/geo";
import type { SnapshotRow } from "../src/snapshot";

function row(overrides: Partial<SnapshotRow> & { id: number; lat: number; lon: number }): SnapshotRow {
  return {
    name: `Station ${overrides.id}`,
    brand: "GALP",
    fuel: "Gasóleo simples",
    price: 2,
    postalCode: "2400-000",
    locality: "Leiria",
    municipality: "Leiria",
    district: "Leiria",
    stationType: "Outro",
    address: "Rua A",
    updated: "2026-10-20 08:00",
    ...overrides,
  };
}

describe("haversineKm", () => {
  it("matches known distances", () => {
    const lisbon = { lat: 38.7223, lon: -9.1393 };
    const porto = { lat: 41.1579, lon: -8.6291 };
    expect(haversineKm(lisbon, porto)).toBeGreaterThan(270);
    expect(haversineKm(lisbon, porto)).toBeLessThan(280);
    expect(haversineKm(lisbon, lisbon)).toBe(0);
  });
});

describe("attachDistance", () => {
  it("adds a distance to every row", () => {
    const point = { lat: 39.74, lon: -8.81 };
    const [first] = attachDistance([row({ id: 1, lat: 39.75, lon: -8.81 })], point);
    expect(first.distanceKm).toBeGreaterThan(1);
    expect(first.distanceKm).toBeLessThan(2);
  });
});

describe("municipalitiesCovered", () => {
  it("groups by concelho and counts distinct stations", () => {
    const rows = attachDistance(
      [
        row({ id: 1, lat: 39.74, lon: -8.81 }),
        row({ id: 1, fuel: "Gasolina simples 95", lat: 39.74, lon: -8.81 }),
        row({ id: 2, municipality: "Marinha Grande", district: "Leiria", lat: 39.75, lon: -8.93 }),
      ],
      { lat: 39.74, lon: -8.81 },
    );

    const covered = municipalitiesCovered(rows);
    expect(covered).toHaveLength(2);
    expect(covered[0].municipality).toBe("Leiria");
    expect(covered[0].station_count).toBe(1);
    expect(covered[1].municipality).toBe("Marinha Grande");
  });
});

describe("searchProximity", () => {
  const near = row({ id: 1, lat: 39.75, lon: -8.81, price: 2.2 });
  const far = row({ id: 2, lat: 39.9, lon: -8.81, price: 1.9, municipality: "Marinha Grande" });

  it("keeps the initial radius when there is enough data", () => {
    const result = searchProximity({
      rows: [near, far],
      fuelNames: ["Gasóleo simples"],
      point: { lat: 39.74, lon: -8.81 },
      radiusKm: 5,
      maxRadiusKm: 40,
      limitPerFuel: 1,
      sort: "distance",
    });

    expect(result.effectiveRadiusKm).toBe(5);
    expect(result.byFuel.get("Gasóleo simples")).toHaveLength(1);
    expect(result.byFuel.get("Gasóleo simples")?.[0].id).toBe(1);
  });

  it("widens the radius until every fuel has enough results", () => {
    const result = searchProximity({
      rows: [near, far],
      fuelNames: ["Gasóleo simples"],
      point: { lat: 39.74, lon: -8.81 },
      radiusKm: 2,
      maxRadiusKm: 40,
      limitPerFuel: 2,
      sort: "distance",
    });

    expect(result.effectiveRadiusKm).toBeGreaterThan(2);
    expect(result.byFuel.get("Gasóleo simples")).toHaveLength(2);
  });

  it("sorts by price when asked", () => {
    const result = searchProximity({
      rows: [near, far],
      fuelNames: ["Gasóleo simples"],
      point: { lat: 39.74, lon: -8.81 },
      radiusKm: 40,
      maxRadiusKm: 40,
      limitPerFuel: 2,
      sort: "price",
    });

    const stations = result.byFuel.get("Gasóleo simples") ?? [];
    expect(stations[0].price).toBeLessThanOrEqual(stations[1].price ?? 0);
  });

  it("never exceeds the configured ceiling", () => {
    const result = searchProximity({
      rows: [near],
      fuelNames: ["Gasóleo simples", "Gasolina 98"],
      point: { lat: 39.74, lon: -8.81 },
      radiusKm: 5,
      maxRadiusKm: 20,
      limitPerFuel: 5,
      sort: "distance",
    });

    expect(result.effectiveRadiusKm).toBeLessThanOrEqual(20);
  });
});

describe("sortByPrice", () => {
  it("sorts nulls last and respects the limit", () => {
    const sorted = sortByPrice(
      [{ price: null }, { price: 2.2 }, { price: 1.9 }],
      2,
    );
    expect(sorted.map((entry) => entry.price)).toEqual([1.9, 2.2]);
  });
});
