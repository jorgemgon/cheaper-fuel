import type { FuelStationList, StationInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import { buildFuelGroups, fuelGroupCount } from "./fuel-groups";

function station(id: number): StationInfo {
  return {
    id,
    name: `Station ${id}`,
    brand: "GALP",
    price_eur: 2,
    price_display: "2,000 €/litro",
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
  };
}

function fuel(name: string, stations: StationInfo[], found = stations.length): FuelStationList {
  return { fuel: name, unit: "litro", stations_found: found, stations };
}

describe("buildFuelGroups", () => {
  it("keeps one section per fuel with its stations in API order", () => {
    const groups = buildFuelGroups([
      fuel("Gasóleo simples", [station(1), station(2)]),
      fuel("Gasolina simples 95", [station(3)]),
    ]);

    expect(groups.map((group) => group.fuel)).toEqual([
      "Gasóleo simples",
      "Gasolina simples 95",
    ]);
    expect(groups[0].rows.map((row) => row.station.id)).toEqual([1, 2]);
    expect(groups[1].rows).toHaveLength(1);
    expect(groups[0].rows[0].fuel).toBe("Gasóleo simples");
  });

  it("keeps an empty fuel section so the gap is visible", () => {
    const groups = buildFuelGroups([fuel("GPL Auto", [], 0)]);

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toEqual([]);
  });
});

describe("fuelGroupCount", () => {
  it("reports the returned count", () => {
    const [group] = buildFuelGroups([fuel("Gasóleo simples", [station(1), station(2)])]);
    expect(fuelGroupCount(group)).toBe("2 postos");
  });

  it("reports truncation per fuel", () => {
    const [group] = buildFuelGroups([fuel("Gasóleo simples", [station(1)], 84)]);
    expect(fuelGroupCount(group)).toBe("1 de 84 postos");
  });
});
