import type { StationDetail, StationInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import {
  favoriteFromDetail,
  normalizeFavorites,
  toggleFavoriteStation,
  updateFavoriteStation,
  type FavoriteStation,
} from "./favorites";

function station(id = 1, distance?: number): StationInfo {
  return {
    id,
    name: `Station ${id}`,
    brand: "GALP",
    price_eur: 1.9,
    price_display: "1,900 €/litro",
    unit: "litro",
    ...(distance === undefined ? {} : { distance_km: distance }),
    address: {
      street: null,
      locality: "Leiria",
      postal_code: "2400-193",
      municipality: "Leiria",
      district: "Leiria",
    },
    coordinates: { latitude: 39.74, longitude: -8.81 },
    station_type: "Outro",
    last_updated: "2026-10-23 08:00",
    maps_url: "https://maps.google.com/?q=39.74,-8.81",
  };
}

function favorite(stationId = 1): FavoriteStation {
  return { station: station(stationId), fuel: "Gasóleo simples", savedAt: "2026-10-23T08:00:00.000Z" };
}

function detail(overrides: Partial<StationDetail> = {}): StationDetail {
  return {
    id: 7,
    name: "Galp Leiria",
    brand: "GALP",
    stationType: "Outro",
    usage: null,
    observations: null,
    address: {
      street: "Rua A",
      locality: "Leiria",
      postalCode: "2400-193",
      municipality: "Leiria",
      district: "Leiria",
      latitude: 39.74,
      longitude: -8.81,
    },
    hours: null,
    services: [],
    paymentMethods: [],
    fuels: [
      {
        name: "Gasóleo simples",
        price: 1.9,
        unit: "litro",
        updated: "2026-10-23 08:00",
        price_display: "1,900 €/litro",
      },
      {
        name: "Gasolina simples 95",
        price: 2.0,
        unit: "litro",
        updated: "2026-10-23 08:00",
        price_display: "2,000 €/litro",
      },
    ],
    ...overrides,
  };
}

describe("normalizeFavorites", () => {
  it("drops malformed and duplicate entries", () => {
    const value = [
      favorite(1),
      favorite(1),
      { station: { id: 2, name: "No address" } },
      { station: station(3), fuel: "", savedAt: "x" },
      null,
    ];

    expect(normalizeFavorites(value).map((entry) => entry.station.id)).toEqual([1]);
  });

  it("returns an empty list for corrupted storage", () => {
    expect(normalizeFavorites("nope")).toEqual([]);
    expect(normalizeFavorites(null)).toEqual([]);
  });
});

describe("toggleFavoriteStation", () => {
  it("adds a station without the search distance and removes it by id", () => {
    const added = toggleFavoriteStation([], station(1, 4.2), "Gasóleo simples", "2026-10-23T09:00:00.000Z");
    expect(added).toHaveLength(1);
    expect(added[0].station.distance_km).toBeUndefined();
    expect(added[0].savedAt).toBe("2026-10-23T09:00:00.000Z");

    const removed = toggleFavoriteStation(added, station(1), "Gasolina simples 95");
    expect(removed).toEqual([]);
  });
});

describe("updateFavoriteStation", () => {
  it("refreshes the snapshot and fuel but keeps the save date", () => {
    const current = favorite(1);
    const updated = updateFavoriteStation(
      [current],
      { ...station(1, 9), price_eur: 1.8 },
      "Gasolina simples 95",
    );

    expect(updated[0].fuel).toBe("Gasolina simples 95");
    expect(updated[0].station.price_eur).toBe(1.8);
    expect(updated[0].station.distance_km).toBeUndefined();
    expect(updated[0].savedAt).toBe(current.savedAt);
  });
});

describe("favoriteFromDetail", () => {
  it("turns a station detail into a search-style row", () => {
    const row = favoriteFromDetail(detail(), "Gasolina simples 95");

    expect(row).not.toBeNull();
    expect(row?.fuel).toBe("Gasolina simples 95");
    expect(row?.station).toMatchObject({
      id: 7,
      name: "Galp Leiria",
      price_eur: 2,
      price_display: "2,000 €/litro",
      address: { municipality: "Leiria", postal_code: "2400-193" },
      coordinates: { latitude: 39.74, longitude: -8.81 },
    });
  });

  it("falls back to the first fuel and refuses a station without coordinates", () => {
    expect(favoriteFromDetail(detail(), "Gasóleo 98")?.fuel).toBe("Gasóleo simples");

    const noCoords = detail({
      address: { ...detail().address, latitude: null, longitude: null },
    });
    expect(favoriteFromDetail(noCoords, "Gasóleo simples")).toBeNull();
  });
});
