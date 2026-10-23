import type { DiscountInfo, StationInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import { bestPriceDisplay, remainingPriceOptions } from "./price-options";

function discount(overrides: Partial<DiscountInfo> = {}): DiscountInfo {
  return {
    program_id: "continente-card",
    program_title: "Cartão Continente",
    description: "5 cênt./L em postos aderentes.",
    tier: null,
    label: null,
    guaranteed_cents: 5,
    max_cents: 5,
    applied_cents: 5,
    effective_price_eur: 2.049,
    effective_price_display: "2,049 €/litro",
    saves_eur_per_fill: 2.5,
    conditions: [],
    confidence: "high",
    schedule: { kind: "always", weekdays: [], daysOfMonth: [], nth: null, weekday: null },
    schedule_label: "Sempre",
    applies_today: true,
    stale: false,
    ...overrides,
  };
}

function station(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    id: 1,
    name: "GALP Leiria",
    brand: "GALP",
    price_eur: 2.099,
    price_display: "2,099 €/litro",
    unit: "litro",
    address: {
      street: "Rua A",
      locality: "Leiria",
      postal_code: "2400-193",
      municipality: "Leiria",
      district: "Leiria",
    },
    coordinates: { latitude: 39.74, longitude: -8.81 },
    station_type: "Outro",
    last_updated: "2026-10-20 08:00",
    maps_url: "https://maps.google.com/?q=39.74,-8.81",
    ...overrides,
  };
}

describe("bestPriceDisplay", () => {
  it("shows the effective price when a discount applies", () => {
    expect(bestPriceDisplay(station({ discount: discount() }))).toBe("2,049 €/litro");
  });

  it("shows the list price when no discount applies", () => {
    expect(bestPriceDisplay(station())).toBe("2,099 €/litro");
  });

  it("handles an unpriced station", () => {
    expect(bestPriceDisplay(station({ price_eur: null, price_display: null }))).toBe("—");
  });
});

describe("remainingPriceOptions", () => {
  it("lists the other programme, the guaranteed slice and the base price, cheapest first", () => {
    const options = remainingPriceOptions(
      station({
        discount: discount({ guaranteed_cents: 3, applied_cents: 5 }),
        possible_discounts: [
          discount({
            program_id: "mundo-galp",
            program_title: "Mundo Galp",
            applied_cents: 2,
            guaranteed_cents: 2,
            effective_price_eur: 2.079,
            effective_price_display: "2,079 €/litro",
          }),
        ],
      }),
    );

    expect(options.map((option) => option.label)).toEqual([
      "Garantido · 3 cênt./L",
      "Mundo Galp",
      "Sem desconto",
    ]);
    expect(options.map((option) => option.priceDisplay)).toEqual([
      "2,069 €/litro",
      "2,079 €/litro",
      "2,099 €/litro",
    ]);
    expect(options.every((option) => !option.unconfirmed)).toBe(true);
  });

  it("marks catalogue values that still need confirming", () => {
    const options = remainingPriceOptions(
      station({
        possible_discounts: [discount({ confidence: "low", program_title: "Campanha" })],
      }),
    );

    expect(options).toHaveLength(1);
    expect(options[0].unconfirmed).toBe(true);
  });

  it("omits the guaranteed line when the best case is already guaranteed", () => {
    const options = remainingPriceOptions(
      station({ discount: discount({ applied_cents: 5, guaranteed_cents: 5 }) }),
    );

    expect(options.map((option) => option.label)).toEqual(["Sem desconto"]);
  });

  it("has nothing to list without a discount", () => {
    expect(remainingPriceOptions(station())).toEqual([]);
  });
});
