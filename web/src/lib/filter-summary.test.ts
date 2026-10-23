import { describe, expect, it } from "vitest";

import { describeFilters } from "./filter-summary";

describe("describeFilters", () => {
  it("summarises an empty fuel filter as every fuel", () => {
    expect(describeFilters({ fuels: [], cards: [], services: [], radiusKm: 5 })).toBe(
      "todos os combustíveis · raio 5 km",
    );
  });

  it("names a single fuel and counts the rest", () => {
    expect(
      describeFilters({
        fuels: ["Gasóleo simples"],
        cards: [],
        services: [],
        radiusKm: 5,
      }),
    ).toBe("Gasóleo simples · raio 5 km");

    expect(
      describeFilters({
        fuels: ["Gasóleo simples", "Gasolina simples 95"],
        cards: ["a", "b", "c", "d", "e", "f", "g"],
        services: ["galp_energy"],
        radiusKm: 12,
      }),
    ).toBe("2 combustíveis · 7 cartões · 1 serviço · raio 12 km");
  });
});
