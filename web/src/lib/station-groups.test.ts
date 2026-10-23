import type { StationInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import { groupRowsByStation, hasMixedUnits, markerPrice } from "./station-groups";

function station(id: number, price: number | null, effective: number | null = null): StationInfo {
  return {
    id,
    name: `Station ${id}`,
    brand: "GALP",
    price_eur: price,
    price_display: price === null ? null : `${price} €/litro`,
    unit: "litro",
    address: {
      street: null,
      locality: "Leiria",
      postal_code: "2400-193",
      municipality: "Leiria",
      district: "Leiria",
    },
    coordinates: { latitude: 39.74, longitude: -8.81 },
    station_type: "Outro",
    last_updated: "2026-10-20 08:00",
    maps_url: "https://maps.google.com/?q=39.74,-8.81",
    ...(effective === null
      ? {}
      : {
          discount: {
            program_id: "continente-card",
            program_title: "Cartão Continente",
            description: "",
            tier: null,
            label: null,
            guaranteed_cents: 5,
            max_cents: 5,
            applied_cents: 5,
            effective_price_eur: effective,
            effective_price_display: `${effective} €/litro`,
            saves_eur_per_fill: 2.5,
            conditions: [],
            confidence: "high" as const,
            schedule: { kind: "always" as const, weekdays: [], daysOfMonth: [], nth: null, weekday: null },
            schedule_label: "Sempre",
            applies_today: true,
            stale: false,
          },
        }),
  };
}

describe("markerPrice", () => {
  it("prefers the effective price and falls back to the list price", () => {
    expect(markerPrice(station(1, 2.1, 2.05))).toBe(2.05);
    expect(markerPrice(station(1, 2.1))).toBe(2.1);
    expect(markerPrice(station(1, null))).toBeNull();
  });
});

describe("groupRowsByStation", () => {
  it("collapses one station selected with two fuels into a single marker", () => {
    const groups = groupRowsByStation([
      { station: station(7, 2.1), fuel: "Gasóleo simples" },
      { station: station(7, 1.95), fuel: "Gasolina simples 95" },
      { station: station(8, 2.2), fuel: "Gasóleo simples" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].fuels.map((entry) => entry.fuel)).toEqual([
      "Gasóleo simples",
      "Gasolina simples 95",
    ]);
    // The marker takes the colour of the cheapest selected fuel.
    expect(groups[0].station.price_eur).toBe(1.95);
    expect(groups[1].station.id).toBe(8);
  });

  it("ignores an unpriced fuel when choosing the marker price", () => {
    const groups = groupRowsByStation([
      { station: station(3, null), fuel: "Gasóleo simples" },
      { station: station(3, 1.9), fuel: "Gasolina simples 95" },
    ]);

    expect(groups[0].station.price_eur).toBe(1.9);
    expect(groups[0].fuels).toHaveLength(2);
  });

  it("uses the effective price when a discount applies", () => {
    const groups = groupRowsByStation([
      { station: station(4, 2.1), fuel: "Gasóleo simples" },
      { station: station(4, 2.2, 2.05), fuel: "Gasolina simples 95" },
    ]);

    expect(markerPrice(groups[0].station)).toBe(2.05);
  });
});

describe("hasMixedUnits", () => {
  it("detects when prices cannot share one ramp", () => {
    const diesel = { station: station(1, 1.9), fuel: "Gasóleo simples" };
    const petrol = { station: station(2, 2.0), fuel: "Gasolina simples 95" };
    const gnc = { station: { ...station(3, 0.9), unit: "kg" }, fuel: "GNC" };

    expect(hasMixedUnits([diesel, petrol])).toBe(false);
    expect(hasMixedUnits([diesel, gnc])).toBe(true);
    expect(hasMixedUnits([])).toBe(false);
  });
});
