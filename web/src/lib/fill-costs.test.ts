import type { DiscountInfo, StationInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import { fillEstimate, unitSymbol } from "./fill-costs";

function discount(effective: number): DiscountInfo {
  return {
    program_id: "galp-combina",
    program_title: "COMBINA",
    description: "",
    tier: "combina-3",
    label: "3+ serviços",
    guaranteed_cents: 10,
    max_cents: 30,
    applied_cents: 30,
    effective_price_eur: effective,
    effective_price_display: `${effective} €/litro`,
    saves_eur_per_fill: 15,
    conditions: [],
    confidence: "high",
    schedule: { kind: "always", weekdays: [], daysOfMonth: [], nth: null, weekday: null },
    schedule_label: "Sempre",
    applies_today: true,
    stale: false,
  };
}

function station(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    id: 1,
    name: "GALP Leiria",
    brand: "GALP",
    price_eur: 2.12,
    price_display: "2,120 €/litro",
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
    ...overrides,
  };
}

function plain(estimate: ReturnType<typeof fillEstimate>) {
  if (!estimate) return null;
  const normalize = (value: string) => value.replace(/\s/g, " ");
  return {
    quantityLabel: normalize(estimate.quantityLabel),
    spendLabel: normalize(estimate.spendLabel),
    litresLabel: normalize(estimate.litresLabel),
    savingsLabel: estimate.savingsLabel === null ? null : normalize(estimate.savingsLabel),
  };
}

describe("unitSymbol", () => {
  it("maps fuel units to short labels", () => {
    expect(unitSymbol("litro")).toBe("L");
    expect(unitSymbol("kg")).toBe("kg");
    expect(unitSymbol("m3")).toBe("m³");
    expect(unitSymbol(null)).toBe("L");
  });
});

describe("fillEstimate", () => {
  it("prices a litre quantity and its saving", () => {
    const estimate = fillEstimate(station({ discount: discount(1.82) }), 50, "litres");

    expect(plain(estimate)).toEqual({
      quantityLabel: "50 L",
      spendLabel: "91,00 €",
      litresLabel: "50 L",
      savingsLabel: "poupas 15,00 €",
    });
  });

  it("turns a euro budget into litres and a saving", () => {
    const estimate = fillEstimate(station({ discount: discount(1.82) }), 50, "euros");

    expect(plain(estimate)).toEqual({
      quantityLabel: "50,00 €",
      spendLabel: "50,00 €",
      litresLabel: "27,5 L",
      savingsLabel: "poupas 8,24 €",
    });
  });

  it("has no saving without a discount", () => {
    const estimate = plain(fillEstimate(station(), 50, "litres"));

    expect(estimate?.spendLabel).toBe("106,00 €");
    expect(estimate?.savingsLabel).toBeNull();
  });

  it("uses the station unit", () => {
    const estimate = plain(fillEstimate(station({ unit: "kg", price_eur: 0.9, price_display: "0,900 €/kg" }), 20, "litres"));

    expect(estimate?.quantityLabel).toBe("20 kg");
    expect(estimate?.spendLabel).toBe("18,00 €");
  });

  it("returns nothing for an unpriced station", () => {
    expect(fillEstimate(station({ price_eur: null, price_display: null }), 50, "litres")).toBeNull();
  });
});
