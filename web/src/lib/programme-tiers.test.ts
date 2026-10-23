import type { DiscountInfo, DiscountLevelInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import {
  formatTierValue,
  tiersForDiscount,
  tierEffectivePrice,
  type ProgrammeTier,
} from "./programme-tiers";

function level(overrides: Partial<DiscountLevelInfo> = {}): DiscountLevelInfo {
  return {
    tier: "combina-3",
    label: "3+ serviços",
    min_services: 3,
    value_type: "cents_per_litre",
    value: 30,
    cents_per_litre: 30,
    effective_price_eur: 1.82,
    effective_price_display: "1,820 €/litro",
    ...overrides,
  };
}

function discount(overrides: Partial<DiscountInfo> = {}): DiscountInfo {
  return {
    program_id: "galp-combina",
    program_title: "COMBINA",
    description: "",
    tier: "combina-3",
    label: "3+ serviços",
    guaranteed_cents: 10,
    max_cents: 30,
    applied_cents: 30,
    effective_price_eur: 1.82,
    effective_price_display: "1,820 €/litro",
    saves_eur_per_fill: 15,
    conditions: [],
    confidence: "high",
    schedule: { kind: "always", weekdays: [], daysOfMonth: [], nth: null, weekday: null },
    schedule_label: "Sempre",
    applies_today: true,
    stale: false,
    ...overrides,
  };
}

describe("tiersForDiscount", () => {
  it("uses the levels resolved by the server for the station", () => {
    const tiers = tiersForDiscount(
      discount({
        levels: [
          level({ tier: "combina-1", label: "1 serviço", min_services: 1, value: 20 }),
          level({ tier: "combina-2", label: "2 serviços", min_services: 2, value: 25 }),
          level({ tier: "combina-3", label: "3+ serviços", min_services: 3, value: 30 }),
        ],
      }),
    );

    expect(tiers.map((tier) => [tier.id, tier.label, tier.value])).toEqual([
      ["combina-1", "1 serviço", 20],
      ["combina-2", "2 serviços", 25],
      ["combina-3", "3+ serviços", 30],
    ]);
  });

  it("keeps flat levels, skips unquantified ones and names empty tiers", () => {
    const tiers = tiersForDiscount(
      discount({
        levels: [
          level({ tier: null, label: "Base", min_services: 0, value: 8 }),
          level({ tier: "flat", label: "Flat", value_type: null }),
        ],
      }),
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ id: "level-0", label: "Base", value: 8 });
  });

  it("falls back to the applied level for older payloads without levels", () => {
    const tiers = tiersForDiscount(discount());
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({
      id: "combina-3",
      label: "3+ serviços",
      valueType: "cents_per_litre",
      value: 30,
    });
  });

  it("returns nothing without a discount", () => {
    expect(tiersForDiscount(undefined)).toEqual([]);
  });
});

describe("formatTierValue", () => {
  it("formats each unit", () => {
    const cents: ProgrammeTier = {
      id: "a",
      label: "A",
      minServices: 0,
      valueType: "cents_per_litre",
      value: 20,
    };
    const euros: ProgrammeTier = { ...cents, valueType: "eur_per_fill", value: 2 };
    const percent: ProgrammeTier = { ...cents, valueType: "percent", value: 10 };

    expect(formatTierValue(cents)).toBe("20 cênt./L");
    expect(formatTierValue(euros).replace(/\s/g, " ")).toBe("2,00 € por abastecimento");
    expect(formatTierValue(percent)).toBe("10%");
  });
});

describe("tierEffectivePrice", () => {
  it("turns each service level into the price you would pay", () => {
    const base = 2.304;
    expect(tierEffectivePrice(base, { valueType: "cents_per_litre", value: 8 }, 50)).toBe(2.224);
    expect(tierEffectivePrice(base, { valueType: "cents_per_litre", value: 13 }, 50)).toBe(2.174);
    expect(tierEffectivePrice(base, { valueType: "cents_per_litre", value: 18 }, 50)).toBe(2.124);
  });

  it("handles COMBINA levels on a 2,120 €/L station", () => {
    expect(tierEffectivePrice(2.12, { valueType: "cents_per_litre", value: 20 }, 50)).toBe(1.92);
    expect(tierEffectivePrice(2.12, { valueType: "cents_per_litre", value: 30 }, 50)).toBe(1.82);
  });

  it("supports percent and per-fill couples", () => {
    expect(tierEffectivePrice(2.12, { valueType: "percent", value: 10 }, 50)).toBe(1.908);
    expect(tierEffectivePrice(2.12, { valueType: "eur_per_fill", value: 2 }, 50)).toBe(2.08);
    expect(tierEffectivePrice(2.12, { valueType: "eur_per_fill", value: 2 }, 100)).toBe(2.1);
  });

  it("never goes below zero and needs a base price", () => {
    expect(tierEffectivePrice(2, { valueType: "eur_per_fill", value: 200 }, 50)).toBe(0);
    expect(tierEffectivePrice(null, { valueType: "cents_per_litre", value: 10 }, 50)).toBeNull();
    expect(tierEffectivePrice(2.12, { valueType: "cents_per_litre", value: 10 }, 0)).toBeNull();
  });
});
